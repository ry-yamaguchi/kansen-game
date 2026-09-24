import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createSim, placeIsolation, placeVaccine, step, triggerLockdown } from '../engine';
import type { Agent, SimState } from '../types';

const DT = 1 / 60;
const WORLD = { w: 1000, h: 600 };

/**
 * 新商品モードの盤面を、動きを止めた状態で作る。
 * 全員を未体験・特性なし・外周の通りの隅に寄せ、試したい人だけを広場に並べて確かめる。
 * product.test.ts の frozenProduct と同じ考え方（このファイル専用に複製している）。
 */
function frozenProduct(seed: number): SimState {
  const sim = createSim(WORLD, 30, 'product', seed);
  sim.nextWave = Number.MAX_SAFE_INTEGER;
  sim.inflowTimer = 1e9; // 駅からの流入を止める
  for (const a of sim.agents) {
    a.state = 'susceptible';
    a.trait = null;
    a.recommendedBy = [];
    a.recommendProgress = [];
    park(a, 20, 20);
  }
  return sim;
}

/** その場に留める（速さ0・留まる範囲をその点に） */
function park(a: Agent, x: number, y: number): void {
  a.x = x;
  a.y = y;
  a.speed = 0;
  a.path = [];
  a.pathIndex = 0;
  a.arrived = true;
  a.stay = { x: x - 1, y: y - 1, w: 2, h: 2 };
}

function adopt(a: Agent): void {
  a.state = 'infected';
  a.everInfected = true;
  a.infectionTimer = 1000; // 試合のあいだ飽きない
}

function runFor(sim: SimState, seconds: number): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i += 1) step(sim, DT);
}

function plazaCenter(sim: SimState) {
  const p = sim.city.plaza;
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
}

describe('新商品 道具: 試供品（placeVaccine）', () => {
  it('範囲内の未体験の人だけをその場で愛用中にし、飽きた人・愛用中の人には効かない', () => {
    const sim = frozenProduct(101);
    const c = plazaCenter(sim);
    const [untried, adopter, churned] = sim.agents;
    untried.adoptThreshold = 1; // 新しもの好き
    park(untried, c.x, c.y);
    adopt(adopter);
    park(adopter, c.x + 5, c.y);
    churned.state = 'recovered'; // 飽きた人
    churned.infectionTimer = 0;
    park(churned, c.x - 5, c.y);
    sim.points = CONFIG.maxPoints;

    expect(placeVaccine(sim, c.x, c.y)).toBe(true);

    expect(untried.state).toBe('infected'); // その場で試した（愛用中になった）
    expect(untried.everInfected).toBe(true);
    expect(adopter.state).toBe('infected');
    expect(adopter.infectionTimer).toBe(1000); // 愛用中の人には何もしない（治療されない）
    expect(churned.state).toBe('recovered'); // 飽きた人には何もしない
  });
});

describe('新商品 道具: 試供品は慎重な人を動かさない', () => {
  it('勧められる人数が多い慎重な人は試さず、「1人に勧められた」ぶんとして残る。何度配っても1人分', () => {
    const sim = frozenProduct(102);
    const c = plazaCenter(sim);
    const [cautious] = sim.agents;
    cautious.adoptThreshold = CONFIG.sampleAdoptMaxThreshold + 1;
    park(cautious, c.x, c.y);
    sim.points = CONFIG.maxPoints;
    placeVaccine(sim, c.x, c.y);
    expect(cautious.state).toBe('susceptible');
    expect(cautious.recommendedBy.length).toBe(1);
    sim.points = CONFIG.maxPoints;
    placeVaccine(sim, c.x, c.y);
    expect(cautious.recommendedBy.length).toBe(1);
  });
});

describe('新商品 道具: 広告（triggerLockdown）', () => {
  it('広告中は、見ている（従う）人だけ試すのに要る人数が1人少ない', () => {
    const sim = frozenProduct(102);
    const c = plazaCenter(sim);
    const [sawAd, ignoredAd, advocate] = sim.agents;
    sawAd.adoptThreshold = 2;
    ignoredAd.adoptThreshold = 2;
    adopt(advocate);
    // advocateから見て、sawAd・ignoredAdの両方が接触半径内に入るよう近くに置く
    park(advocate, c.x, c.y);
    park(sawAd, c.x + 6, c.y);
    park(ignoredAd, c.x - 6, c.y);

    sim.points = CONFIG.maxPoints;
    expect(triggerLockdown(sim)).toBe(true);
    // 広告を見た(従う)かどうかを、このテストで確かめたい2人だけ固定する
    sawAd.compliesLockdown = true;
    ignoredAd.compliesLockdown = false;

    runFor(sim, 3); // recommendTime(1.5秒)を超えるまで

    // sawAdは試した(infected)時点でrecommendedByがinfect()によりクリアされるため、状態だけを見る
    expect(sawAd.state, '広告を見た人は1人少ない人数(1人)で試す').toBe('infected');
    expect(ignoredAd.recommendedBy).toEqual([advocate.id]);
    expect(ignoredAd.state, '広告を見ていない人は通常どおり2人要る').toBe('susceptible');
  });

  it('広告中でも人の動きは遅くならない', () => {
    const withAd = frozenProduct(103);
    const without = frozenProduct(103); // 同シード。比較のため広告なしで同じ操作をする
    const a1 = withAd.agents[0];
    const a2 = without.agents[0];
    park(a1, 500, 300);
    park(a2, 500, 300);
    a1.speed = 90;
    a2.speed = 90;

    withAd.points = CONFIG.maxPoints;
    expect(triggerLockdown(withAd)).toBe(true);
    a1.compliesLockdown = true; // 広告に従う人でも、である

    const p1 = { x: a1.x, y: a1.y };
    const p2 = { x: a2.x, y: a2.y };
    step(withAd, DT);
    step(without, DT);
    const d1 = Math.hypot(a1.x - p1.x, a1.y - p1.y);
    const d2 = Math.hypot(a2.x - p2.x, a2.y - p2.y);
    expect(d1).toBeCloseTo(d2, 5);
    expect(d1).toBeGreaterThan(0);
  });

  it('2回目の広告は、1回目より好感度(社会活動度)の下がり方が大きい', () => {
    const sim = frozenProduct(104);
    sim.points = CONFIG.maxPoints;
    expect(triggerLockdown(sim)).toBe(true);
    const social0 = sim.social;
    runFor(sim, CONFIG.lockdownDuration);
    const drop1 = social0 - sim.social;
    expect(drop1).toBeGreaterThan(0);

    runFor(sim, CONFIG.lockdownCooldown + 0.5); // クールダウン明けを待つ
    sim.points = CONFIG.maxPoints;
    const social1 = sim.social;
    expect(triggerLockdown(sim)).toBe(true);
    runFor(sim, CONFIG.lockdownDuration);
    const drop2 = social1 - sim.social;

    expect(drop2).toBeGreaterThan(drop1);
  });
});

describe('新商品: 好感度の効き目', () => {
  it('好感度が低いほど、愛用中の人の残り時間が早く減る', () => {
    const low = frozenProduct(105);
    const high = frozenProduct(105); // 同シードで比較する
    const aLow = low.agents[0];
    const aHigh = high.agents[0];
    adopt(aLow);
    adopt(aHigh);
    park(aLow, 20, 20);
    park(aHigh, 20, 20);
    low.social = 0; // 好感度0
    high.social = CONFIG.socialMax; // 好感度満点
    const before = aLow.infectionTimer;

    step(low, DT);
    step(high, DT);

    const decLow = before - aLow.infectionTimer;
    const decHigh = before - aHigh.infectionTimer;
    expect(decLow).toBeGreaterThan(decHigh);
  });

  it('好感度が goodwillResistBelow 未満のあいだは、試すのに要る人数が1人多くなる', () => {
    const sim = frozenProduct(106);
    const c = plazaCenter(sim);
    const [target, advocate] = sim.agents;
    target.adoptThreshold = 1; // 通常なら1人で試す
    park(target, c.x, c.y);
    adopt(advocate);
    park(advocate, c.x + 5, c.y);
    sim.social = 0; // 好感度を大きく下げる（自然回復はあるが、短時間なら閾値を超えない）

    runFor(sim, 2); // recommendTime(1.5秒)を超えるまで
    expect(target.recommendedBy).toEqual([advocate.id]); // 1人には勧められている
    expect(target.state, '好感度が低いので1人では試さない').toBe('susceptible');

    sim.social = CONFIG.socialMax; // 好感度を戻す
    step(sim, DT);
    expect(target.state, '好感度が戻れば、同じ1人の推薦で試す').toBe('infected');
  });
});

describe('新商品 道具: イベント（placeIsolation）', () => {
  it('周りの人を集め、寿命が切れると予定に戻す', () => {
    const sim = frozenProduct(107);
    const c = plazaCenter(sim);
    const target = sim.agents[0];
    // 円の外、引き寄せ半径の内側に置く
    park(target, c.x + CONFIG.zoneRadius + 40, c.y);
    target.speed = 100;

    sim.points = CONFIG.maxPoints;
    expect(placeIsolation(sim, c.x, c.y)).toBe(true);
    const zone = sim.zones[0];
    expect(zone.kind).toBe('event');
    const distBefore = Math.hypot(target.x - zone.x, target.y - zone.y);

    runFor(sim, 12); // 出発の個人差(最大6秒)を超えて、円の中まで歩けるだけの時間
    expect(target.purpose).toBe('event');
    const distAfter = Math.hypot(target.x - zone.x, target.y - zone.y);
    expect(distAfter, '円の中心へ寄っている').toBeLessThan(distBefore);
    expect(distAfter, '円の中まで入れている（閉じ込めなら入れない）').toBeLessThan(zone.r);

    runFor(sim, CONFIG.zoneLife); // 寿命切れまで
    expect(sim.zones.length).toBe(0);
    expect(target.purpose, '寿命が切れたら予定に戻る').not.toBe('event');
  });

  it('イベントの円は通り抜けできる（閉じ込めない・接触を分けない）', () => {
    const sim = frozenProduct(108);
    const c = plazaCenter(sim);
    sim.points = CONFIG.maxPoints;
    expect(placeIsolation(sim, c.x, c.y)).toBe(true);
    const zone = sim.zones[0];

    const [advocate, target] = sim.agents;
    adopt(advocate);
    park(advocate, zone.x + zone.r - 5, zone.y); // 円の内側
    park(target, zone.x + zone.r + 10, zone.y); // 円のすぐ外側

    runFor(sim, 3); // recommendTime(1.5秒)を超えるまで
    expect(target.zone).toBe(-1); // 閉じ込められていない
    expect(target.recommendedBy, '円をまたいでも接触・勧めが届く').toEqual([advocate.id]);
  });
});

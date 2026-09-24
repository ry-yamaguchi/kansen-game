import { describe, expect, it } from 'vitest';
import { breakdownOf, buildResult, createSim, scoreOf, step } from '../engine';
import type { Agent, SimState } from '../types';

const DT = 1 / 60;
const WORLD = { w: 1000, h: 600 };

/**
 * 新商品モードの盤面を、動きを止めた状態で作る。
 * 全員を未体験・特性なし・外周の通りの隅に寄せ、試したい人だけを広場に並べて確かめる
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

describe('新商品: 複数の人に勧められて初めて試す（複合的な伝染）', () => {
  it('2人に勧められないと試さない人は、1人に勧められただけでは試さず、別の2人目で試す', () => {
    const sim = frozenProduct(1);
    const c = plazaCenter(sim);
    const [target, first, second] = sim.agents;
    target.adoptThreshold = 2;
    park(target, c.x, c.y);
    adopt(first);
    park(first, c.x + 8, c.y);

    runFor(sim, 3);
    expect(target.recommendedBy).toEqual([first.id]);
    expect(target.state).toBe('susceptible');

    adopt(second);
    park(second, c.x - 8, c.y);
    runFor(sim, 3);
    expect(target.state).toBe('infected');
  });

  it('同じ人に何度勧められても1人と数える', () => {
    const sim = frozenProduct(2);
    const c = plazaCenter(sim);
    const [target, first] = sim.agents;
    target.adoptThreshold = 2;
    park(target, c.x, c.y);
    adopt(first);
    park(first, c.x + 8, c.y);
    runFor(sim, 12);
    expect(target.recommendedBy).toEqual([first.id]);
    expect(target.state).toBe('susceptible');
  });

  it('インフルエンサー（人気者）に勧められると2人分と数える', () => {
    const sim = frozenProduct(3);
    const c = plazaCenter(sim);
    const [target, influencer] = sim.agents;
    target.adoptThreshold = 2;
    park(target, c.x, c.y);
    adopt(influencer);
    influencer.trait = 'popular';
    park(influencer, c.x + 8, c.y);
    runFor(sim, 3);
    expect(target.state).toBe('infected');
  });
});

describe('新商品: 顔の広い人', () => {
  it('普通の人の届かない距離でも、顔の広い人なら勧められる', () => {
    const reachOf = (trait: 'social' | null) => {
      const sim = frozenProduct(7);
      const c = plazaCenter(sim);
      const [target, adopter] = sim.agents;
      target.adoptThreshold = 1;
      park(target, c.x, c.y);
      adopt(adopter);
      adopter.trait = trait;
      // 接触半径の1.15倍の距離（普通は届かず、1.3倍の顔の広い人なら届く）
      park(adopter, c.x + sim.tuning.contactRadius * 1.15, c.y);
      runFor(sim, 3);
      return target.state;
    };
    expect(reachOf(null)).toBe('susceptible');
    expect(reachOf('social')).toBe('infected');
  });
});

describe('新商品: インフルエンサーとイベント', () => {
  it('インフルエンサーは必ず新しもの好き（1人に勧められれば試す）', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = createSim(WORLD, 30, 'product', seed);
      const influencers = sim.agents.filter((a) => a.trait === 'popular');
      expect(influencers.length).toBe(1);
      expect(influencers[0].adoptThreshold).toBe(1);
    }
  });

  it('イベントの円の中では、勧められたと数えるまでが早い', () => {
    const inEvent = (withEvent: boolean) => {
      const sim = frozenProduct(9);
      const c = plazaCenter(sim);
      const [target, adopter] = sim.agents;
      target.adoptThreshold = 4;
      park(target, c.x, c.y);
      adopt(adopter);
      park(adopter, c.x + 8, c.y);
      if (withEvent) sim.zones.push({ id: 99, x: c.x, y: c.y, r: 105, life: 30, maxLife: 30, kind: 'event' });
      runFor(sim, 1);
      return target.recommendedBy.length;
    };
    // 1秒では、普段は勧められたことにならない（1.5秒要る）が、イベントの中では数える
    expect(inEvent(false)).toBe(0);
    expect(inEvent(true)).toBe(1);
  });
});

describe('新商品: 勝ち負けの裏返し', () => {
  it('同時の愛用率がブームの線を超えるとブーム到来で終わる', () => {
    const sim = frozenProduct(4);
    for (const a of sim.agents.slice(0, 20)) adopt(a); // 30人中20人 ≒ 67%
    step(sim, DT);
    expect(sim.outcome).toBe('boom');
    expect(buildResult(sim).outcome).toBe('boom');
  });

  it('ブーム到来で終わったら、もった時間の割合で点を減らさない（早いブームを罰しない）', () => {
    const sim = frozenProduct(8);
    for (const a of sim.agents.slice(0, 20)) adopt(a);
    step(sim, DT);
    expect(sim.outcome).toBe('boom');
    const b = breakdownOf(sim);
    const core = b.base * b.protectionFactor * b.socialFactor * b.peakFactor;
    expect(scoreOf(sim)).toBe(Math.max(0, Math.round(core + b.pointsBonus)));
  });

  it('愛用中が0人になると定着せずで終わる', () => {
    const sim = frozenProduct(5);
    step(sim, DT);
    expect(sim.outcome).toBe('fizzle');
  });
});

describe('新商品: 決定論', () => {
  it('同じシードなら最後まで同じ結果になる', () => {
    const run = () => {
      const sim = createSim(WORLD, 30, 'product', 42);
      for (let i = 0; i < 75 * 60 && sim.outcome === 'playing'; i += 1) step(sim, DT);
      return buildResult(sim);
    };
    expect(run()).toEqual(run());
  });
});

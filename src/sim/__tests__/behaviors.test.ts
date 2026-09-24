import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createSim, placeVaccine, step, triggerLockdown } from '../engine';
import { MODES } from '../modes';
import type { Agent, ModeId, Purpose, SimState } from '../types';

const DT = 1 / 60;
const WORLD = { w: 1000, h: 600 };
const POPULATION = 30;

/** ウェーブ（大型イベント等）を止めた盤面。時間帯だけの予定を確かめるため */
function quietSim(mode: ModeId, seed: number): SimState {
  const sim = createSim(WORLD, POPULATION, mode, seed);
  sim.nextWave = Number.MAX_SAFE_INTEGER;
  return sim;
}

function runFor(sim: SimState, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) step(sim, DT);
}

/**
 * 接触判定用に人を直接置く。stay も置いた点を囲むように合わせておかないと、
 * その場歩き（wanderInPlace）が古い stay（家や通う先の周り）へ引き戻してしまう。
 */
function place(a: Agent, x: number, y: number): void {
  a.x = x;
  a.y = y;
  a.stay = { x: x - 20, y: y - 20, w: 40, h: 40 };
}

/** 住宅ではない区画（広場）の中心。house に重ならない安全な置き場として使う */
function openSpot(sim: SimState): { x: number; y: number } {
  const p = sim.city.plaza;
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
}

/** 今の時間帯の予定と purpose を合わせ、beginTrip（経路の作り直し）が割り込まないようにする */
function freeze(a: Agent, purpose: Purpose): void {
  a.purpose = purpose;
  a.pendingPurpose = null;
  a.path = [];
  a.pathIndex = 0;
  a.zone = -1;
  a.sickStaysHome = false;
}

describe('B2/D1: どこで広がるか（モード別の接触の重み）', () => {
  it('悪感情では歩いている人どうしの接触が重く、感染症では軽い', () => {
    const angerSim = createSim(WORLD, 2, 'anger', 1);
    const epiSim = createSim(WORLD, 2, 'epidemic', 1);
    for (const sim of [angerSim, epiSim]) {
      const [a, b] = sim.agents;
      a.state = 'infected';
      a.infectionTimer = 999;
      b.state = 'susceptible';
      freeze(a, 'commute');
      freeze(b, 'commute');
      const o = openSpot(sim);
      place(a, o.x, o.y);
      place(b, o.x + 5, o.y);
      a.arrived = false;
      b.arrived = false; // 「歩いている」を固定する
    }
    step(angerSim, DT);
    step(epiSim, DT);
    const angerLoad = angerSim.agents[1].load;
    const epiLoad = epiSim.agents[1].load;
    expect(angerLoad).toBe(MODES.anger.tuning.moveContact);
    expect(epiLoad).toBe(MODES.epidemic.tuning.moveContact);
    expect(angerLoad).toBeGreaterThan(epiLoad);
  });
});

describe('B3: 体調が悪くても出勤する', () => {
  it('sickStaysHome の感染者は家へ向かい、そうでない感染者は予定どおり通う先へ向かう', () => {
    const sim = quietSim('epidemic', 5);
    runFor(sim, 10); // 朝の通勤が始まり、全員が通う先へ向かっている状態にする
    const stayer = sim.agents[0];
    const goer = sim.agents[1];
    expect(stayer.purpose, '前提: まだ元気なので通う先へ向かっている').toBe('commute');

    stayer.state = 'infected';
    stayer.infectionTimer = 999;
    stayer.sickStaysHome = true;
    goer.state = 'infected';
    goer.infectionTimer = 999;
    goer.sickStaysHome = false;

    runFor(sim, 8); // 出発時刻のばらつき（最大6秒）を越えて切り替わるまで進める

    expect(stayer.purpose).toBe('home');
    expect(goer.purpose).toBe('commute');
  });
});

describe('B4: 感染が目に見えると広場を避ける', () => {
  it('感染の割合が avoidThreshold を超えた人は昼に広場へ向かわない', () => {
    const sim = quietSim('epidemic', 21);
    runFor(sim, 20); // 朝のうち、通う先へ向かっている途中まで進める

    const avoider = sim.agents[0];
    const stayer = sim.agents[1]; // 対照: しきい値が高く、自粛しない
    avoider.avoidThreshold = 0.2;
    avoider.sickStaysHome = false;
    stayer.avoidThreshold = 0.95;
    stayer.sickStaysHome = false;

    // 街の6割を感染中にし、割合を両者のしきい値の間にする
    const infectTarget = Math.round(sim.agents.length * 0.6);
    let infected = 0;
    for (const a of sim.agents) {
      if (infected >= infectTarget) break;
      if (a === avoider || a === stayer) continue;
      a.state = 'infected';
      a.sickStaysHome = false;
      a.infectionTimer = 999;
      infected += 1;
    }

    runFor(sim, 20); // 昼に入り、出発のばらつきを越えて落ち着くまで進める

    expect(avoider.purpose, '割合がしきい値を超えたら広場・駅を避ける').toBe('commute');
    expect(stayer.purpose, 'しきい値以下なら昼はいつも通り広場・駅へ向かう').toBe('noon');
  });
});

describe('B5: ロックダウンは使うたびに従う人が減る', () => {
  it('2回目のロックダウンでは従わない人が出て、その人は遅くならない', () => {
    const sim = quietSim('epidemic', 9);
    sim.points = CONFIG.maxPoints;
    expect(triggerLockdown(sim)).toBe(true); // 1回目: 全員従う
    expect(sim.agents.every((a) => a.compliesLockdown)).toBe(true);

    runFor(sim, CONFIG.lockdownDuration + CONFIG.lockdownCooldown + 0.5); // クールダウンが明けるまで進める

    sim.points = CONFIG.maxPoints;
    expect(triggerLockdown(sim)).toBe(true); // 2回目: 一部が従わなくなる
    expect(sim.notice?.title).toBe('2回目のロックダウン');
    expect(sim.notice?.detail).toBe('従う人はおよそ75%です');

    const complier = sim.agents.find((a) => a.compliesLockdown);
    const defier = sim.agents.find((a) => !a.compliesLockdown);
    expect(complier, 'このシードでは従う人が見つからない').toBeDefined();
    expect(defier, 'このシードでは従わない人が見つからない').toBeDefined();

    // 従う人・従わない人を同条件（歩いている最中）に置き、1ティックでの移動量を比べる
    for (const a of [complier!, defier!]) {
      a.state = 'susceptible';
      place(a, 500, 300);
      freeze(a, 'commute');
      a.path = [{ x: 900, y: 300 }];
      a.arrived = false;
    }
    const beforeC = { x: complier!.x, y: complier!.y };
    const beforeD = { x: defier!.x, y: defier!.y };
    step(sim, DT);
    const distC = Math.hypot(complier!.x - beforeC.x, complier!.y - beforeC.y);
    const distD = Math.hypot(defier!.x - beforeD.x, defier!.y - beforeD.y);
    expect(distC).toBeLessThan(distD); // 従う人はロックダウンで遅くなる
    expect(distD).toBeCloseTo(defier!.speed * DT, 5); // 従わない人は通常速度のまま
  });
});

describe('C2: 訂正は効きにくい。先回りの予防のほうが効く', () => {
  it('噂話のワクチン（訂正情報）は、感染症より予防の効きが強く、治療の効きが弱い', () => {
    function exposureAfterVaccine(immunityMul: number): number {
      const sim = createSim(WORLD, 2, 'epidemic', 1);
      sim.tuning.immunityMul = immunityMul;
      const [source, target] = sim.agents;
      source.state = 'infected';
      source.infectionTimer = 999;
      target.state = 'susceptible';
      freeze(source, 'commute');
      freeze(target, 'commute');
      const o = openSpot(sim);
      place(source, o.x, o.y);
      place(target, o.x, o.y);
      source.arrived = true;
      target.arrived = true; // stayContact 側に揃え、B2/D1 の重みを両ケースで同じにする
      placeVaccine(sim, target.x, target.y);
      step(sim, DT);
      return target.exposure;
    }
    const withRumorMul = exposureAfterVaccine(MODES.rumor.tuning.immunityMul);
    const withoutMul = exposureAfterVaccine(1);
    expect(withRumorMul).toBeGreaterThan(0);
    expect(withRumorMul).toBeLessThan(withoutMul); // 噂話は予防（免疫の強さ）がより強く効く

    function infectionTimerAfterVaccine(treatMul: number): number {
      const sim = createSim(WORLD, 1, 'epidemic', 1);
      sim.tuning.treatMul = treatMul;
      const a = sim.agents[0];
      a.state = 'infected';
      a.infectionTimer = 10;
      placeVaccine(sim, a.x, a.y);
      return a.infectionTimer;
    }
    const withRumorTreat = infectionTimerAfterVaccine(MODES.rumor.tuning.treatMul);
    const withoutTreat = infectionTimerAfterVaccine(1);
    expect(withRumorTreat).toBeGreaterThan(withoutTreat); // 噂話は治療が弱く効く（下がりにくい＝倍率が大きい）
  });
});

describe('無効化できること', () => {
  it('stayContact と moveContact を1にすると、重みが掛からない（旧来どおり）接触になる', () => {
    const sim = createSim(WORLD, 2, 'epidemic', 1);
    sim.tuning.stayContact = 1;
    sim.tuning.moveContact = 1;
    const [a, b] = sim.agents;
    a.state = 'infected';
    a.infectionTimer = 999;
    b.state = 'susceptible';
    freeze(a, 'commute');
    freeze(b, 'commute');
    const o = openSpot(sim);
    place(a, o.x, o.y);
    place(b, o.x + 5, o.y);
    a.arrived = false;
    b.arrived = true; // 片方だけ歩いていても、重みが1なら差が出ない
    step(sim, DT);
    expect(b.load).toBe(1);
  });
});

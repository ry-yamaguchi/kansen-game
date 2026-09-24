import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createSim, step } from '../engine';
import type { Agent, Purpose, SimState, TraitId } from '../types';

const DT = 1 / 60;
const WORLD = { w: 1000, h: 600 };
const POPULATION = 30;

/**
 * 接触判定用に人を直接置く。stay も置いた点を囲むように合わせておかないと、
 * その場歩き（wanderInPlace）が古い stay（家や通う先の周り）へ引き戻してしまう。
 * behaviors.test.ts と同じ考え方（座標は広場の中心などの開けた所に置くこと）。
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

describe('特性の割り当て（createSim）', () => {
  it('最初の30人のうちちょうど4人（social2・popular1・medic1）に特性が付き、同じシードなら同じ人に付く', () => {
    const sim = createSim(WORLD, POPULATION, 'epidemic', 100);
    const traits = sim.agents.map((a) => a.trait);

    expect(traits.filter((t) => t === 'social').length).toBe(2);
    expect(traits.filter((t) => t === 'popular').length).toBe(1);
    expect(traits.filter((t) => t === 'medic').length).toBe(1);
    expect(traits.filter((t) => t === null).length).toBe(POPULATION - 4);

    const again = createSim(WORLD, POPULATION, 'epidemic', 100);
    expect(again.agents.map((a) => a.trait)).toEqual(traits);
  });

  it('CONFIG.traitCounts をすべて0にすると、誰も特性を持たない', () => {
    const counts = CONFIG.traitCounts as { social: number; popular: number; medic: number };
    const original = { ...counts };
    counts.social = 0;
    counts.popular = 0;
    counts.medic = 0;
    try {
      const sim = createSim(WORLD, POPULATION, 'epidemic', 100);
      expect(sim.agents.every((a) => a.trait === null)).toBe(true);
    } finally {
      counts.social = original.social;
      counts.popular = original.popular;
      counts.medic = original.medic;
    }
  });
});

describe('social: よく人と会う人は感染圧が大きく溜まる（研究メモB1）', () => {
  it('同じ配置なら、social の感染者からのほうが感染圧が大きく溜まる', () => {
    function loadAfterOneStep(trait: TraitId | null): number {
      const sim = createSim(WORLD, POPULATION, 'epidemic', 200);
      const [a, b] = sim.agents;
      a.trait = trait;
      a.state = 'infected';
      a.infectionTimer = 999;
      b.state = 'susceptible';
      freeze(a, 'commute');
      freeze(b, 'commute');
      const o = openSpot(sim);
      place(a, o.x, o.y);
      place(b, o.x + 5, o.y);
      a.arrived = true;
      b.arrived = true;
      step(sim, DT);
      return b.load;
    }

    const socialLoad = loadAfterOneStep('social');
    const normalLoad = loadAfterOneStep(null);
    expect(socialLoad).toBeGreaterThan(normalLoad);
    expect(socialLoad).toBeCloseTo(normalLoad * CONFIG.traitSocialLoadMul, 9);
  });

  it('接触半径も1.3倍で、通常なら届かない距離でも social なら届く', () => {
    function loadAtDistance(trait: TraitId | null, dist: number): number {
      const sim = createSim(WORLD, POPULATION, 'epidemic', 200);
      const [a, b] = sim.agents;
      a.trait = trait;
      a.state = 'infected';
      a.infectionTimer = 999;
      b.state = 'susceptible';
      freeze(a, 'commute');
      freeze(b, 'commute');
      const o = openSpot(sim);
      place(a, o.x, o.y);
      place(b, o.x + dist, o.y);
      a.arrived = true;
      b.arrived = true;
      step(sim, DT);
      return b.load;
    }

    const ref = createSim(WORLD, 2, 'epidemic', 1); // 人数を4未満にして特性を付けず、素のtuningだけ読む
    const cr = ref.tuning.contactRadius;
    const farDist = (cr + cr * CONFIG.traitSocialRadiusMul) / 2; // 通常の半径と social の半径の中間

    expect(loadAtDistance(null, farDist)).toBe(0); // 通常の感染者には届かない
    expect(loadAtDistance('social', farDist)).toBeGreaterThan(0); // social には届く
  });
});

describe('medic: 近くの感染者は早く回復する', () => {
  it('medic の半径80以内の感染者は、遠くの感染者より infectionTimer の減りが速い', () => {
    const sim = createSim(WORLD, POPULATION, 'epidemic', 300);
    const [medic, near, far] = sim.agents;
    medic.trait = 'medic';
    near.trait = null;
    far.trait = null;
    for (const a of [medic, near, far]) freeze(a, 'commute');
    const o = openSpot(sim);
    place(medic, o.x, o.y);
    place(near, o.x + 40, o.y); // 半径80以内
    place(far, o.x + 300, o.y); // 半径80の外
    medic.arrived = true;
    near.arrived = true;
    far.arrived = true;

    medic.state = 'susceptible'; // 本人の状態は問わない。ここでは非感染者にしておく
    near.state = 'infected';
    near.infectionTimer = 10;
    far.state = 'infected';
    far.infectionTimer = 10;

    step(sim, DT);

    expect(near.infectionTimer).toBeLessThan(far.infectionTimer);
    expect(far.infectionTimer).toBeCloseTo(10 - DT, 9);
    expect(near.infectionTimer).toBeCloseTo(10 - DT * CONFIG.traitMedicRecoverMul, 9);
  });

  it('medic 自身が感染していても、対象として扱う（本人の状態は問わない）', () => {
    const sim = createSim(WORLD, POPULATION, 'epidemic', 301);
    const medic = sim.agents[0];
    medic.trait = 'medic';
    freeze(medic, 'commute');
    const o = openSpot(sim);
    place(medic, o.x, o.y);
    medic.arrived = true;
    medic.state = 'infected';
    medic.infectionTimer = 10;

    step(sim, DT);

    expect(medic.infectionTimer).toBeCloseTo(10 - DT * CONFIG.traitMedicRecoverMul, 9);
  });
});

describe('popular: 同じ場所に留まる人が近くに寄る', () => {
  it('popular と同じ場所に留まる人は、popular がいない場合より近くに寄る（平均距離）', () => {
    function averageDistanceAfter(seconds: number, popular: boolean): number {
      const sim = createSim(WORLD, POPULATION, 'epidemic', 400);
      sim.nextWave = Number.MAX_SAFE_INTEGER;
      const o = openSpot(sim);
      // 広場を模した広めの範囲。confinementだけで寄って見えないよう、人数分の余裕を持たせる
      const stay = { x: o.x - 90, y: o.y - 90, w: 180, h: 180 };
      const hub = sim.agents[0];
      const others = sim.agents.slice(1, 6); // 5人
      const group = [hub, ...others];
      for (const a of group) {
        freeze(a, 'commute');
        a.state = 'susceptible';
        a.trait = null;
        a.stay = stay;
        a.arrived = true;
      }
      hub.trait = popular ? 'popular' : null;
      hub.x = o.x;
      hub.y = o.y;
      others.forEach((a, i) => {
        const ang = (i / others.length) * Math.PI * 2;
        a.x = o.x + Math.cos(ang) * 70;
        a.y = o.y + Math.sin(ang) * 70;
      });

      const steps = Math.round(seconds / DT);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < steps; i += 1) {
        step(sim, DT);
        for (const a of others) {
          sum += Math.hypot(a.x - hub.x, a.y - hub.y);
          n += 1;
        }
      }
      return sum / n;
    }

    const withPopular = averageDistanceAfter(5, true);
    const withoutPopular = averageDistanceAfter(5, false);
    expect(withPopular).toBeLessThan(withoutPopular);
  });
});

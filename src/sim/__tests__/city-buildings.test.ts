import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createSim, step } from '../engine';
import type { SimState } from '../types';

const DT = 1 / 60;

/** 住宅区画の中に入り込んでいる人がいれば、その1人目の情報を返す。いなければ null */
function firstAgentInsideAHouse(sim: SimState): { id: number; x: number; y: number } | null {
  for (const a of sim.agents) {
    // 座標が数でない人は、どの比較も偽になり「建物の外」に見えてしまう。壊れた位置として拾う
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return { id: a.id, x: a.x, y: a.y };
    for (const h of sim.city.houses) {
      if (a.x > h.x && a.x < h.x + h.w && a.y > h.y && a.y < h.y + h.h) {
        return { id: a.id, x: a.x, y: a.y };
      }
    }
  }
  return null;
}

function runAndCheckNoOneEntersAHouse(world: { w: number; h: number }, seed: number): void {
  const sim = createSim(world, 30, 'epidemic', seed);
  const totalSteps = Math.ceil(CONFIG.duration / DT);
  const checkEverySteps = Math.round(0.5 / DT);
  for (let i = 0; i < totalSteps; i += 1) {
    step(sim, DT);
    if (i % checkEverySteps !== 0) continue;
    const hit = firstAgentInsideAHouse(sim);
    expect(hit, `world=${world.w}x${world.h} seed=${seed} t=${sim.time.toFixed(2)}: agent found inside a house`).toBeNull();
  }
}

describe('人は住宅区画（建物）の中に入らない', () => {
  const seeds = [1, 2, 3];

  it.each(seeds)('横長（1000×600・シード%i）で75秒通しても誰も建物に入らない', (seed) => {
    runAndCheckNoOneEntersAHouse({ w: 1000, h: 600 }, seed);
  });

  it.each(seeds)('縦長（600×1000・シード%i）で75秒通しても誰も建物に入らない', (seed) => {
    runAndCheckNoOneEntersAHouse({ w: 600, h: 1000 }, seed);
  });
});

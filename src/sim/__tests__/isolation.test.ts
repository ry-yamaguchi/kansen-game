import { describe, expect, it } from 'vitest';
import { createSim, placeIsolation, step } from '../engine';
import type { SimState } from '../types';

const CX = 400;
const CY = 300;

/** 全員を未感染にして隅へ寄せ、盤面の中央に n 人の感染者を置く */
function stage(n: number): SimState {
  const sim = createSim({ w: 800, h: 600 }, 40, 'epidemic', 1);
  for (const a of sim.agents) {
    a.state = 'susceptible';
    a.x = 20;
    a.y = 20;
  }
  for (let i = 0; i < n; i += 1) {
    sim.agents[i].state = 'infected';
    sim.agents[i].x = CX;
    sim.agents[i].y = CY;
  }
  return sim;
}

describe('隔離の効き目は、置いた瞬間に捕まえた感染者の数で決まる', () => {
  it('4人以上捕まえれば満点で効く', () => {
    for (const n of [4, 6]) {
      const sim = stage(n);
      expect(placeIsolation(sim, CX, CY)).toBe(true);
      expect(sim.zones[0].effectiveness).toBe(1);
    }
  });

  it('4人未満なら人数に応じて弱まる', () => {
    const sim = stage(2);
    placeIsolation(sim, CX, CY);
    expect(sim.zones[0].effectiveness).toBeCloseTo(0.5);
  });

  it('感染者のいない所に置いた隔離は効かない', () => {
    const sim = stage(0);
    placeIsolation(sim, CX, CY);
    expect(sim.zones[0].effectiveness).toBe(0);
  });

  it('あとから感染者が入ってきても、効き目は上がらない', () => {
    const sim = stage(0);
    placeIsolation(sim, CX, CY);
    for (let i = 0; i < 5; i += 1) {
      sim.agents[i].state = 'infected';
      sim.agents[i].x = CX;
      sim.agents[i].y = CY;
    }
    step(sim, 1 / 60);
    expect(sim.zones[0].effectiveness).toBe(0);
  });
});

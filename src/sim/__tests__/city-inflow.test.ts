import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createSim, step } from '../engine';

const DT = 1 / 60;

describe('外からの流入は駅の中から現れる', () => {
  it('新しく増えた人は、現れた瞬間に駅の区画の中にいる', () => {
    const sim = createSim({ w: 1000, h: 600 }, 30, 'epidemic', 5);
    const station = sim.city.station;
    let prevCount = sim.agents.length;
    let sawInflow = 0;
    const totalSteps = Math.ceil(CONFIG.duration / DT);

    for (let i = 0; i < totalSteps; i += 1) {
      step(sim, DT);
      if (sim.agents.length > prevCount) {
        for (let k = prevCount; k < sim.agents.length; k += 1) {
          const a = sim.agents[k];
          expect(a.x, `agent#${a.id} x`).toBeGreaterThanOrEqual(station.x);
          expect(a.x, `agent#${a.id} x`).toBeLessThanOrEqual(station.x + station.w);
          expect(a.y, `agent#${a.id} y`).toBeGreaterThanOrEqual(station.y);
          expect(a.y, `agent#${a.id} y`).toBeLessThanOrEqual(station.y + station.h);
          sawInflow += 1;
        }
        prevCount = sim.agents.length;
      }
      if (sim.outcome !== 'playing') break;
    }

    // 流入が一度も起きていなければ、この確認自体が成立しない
    expect(sawInflow).toBeGreaterThan(0);
  });
});

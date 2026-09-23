import { describe, expect, it } from 'vitest';
import { createSim, placeIsolation } from '../engine';
import { CONFIG } from '../config';

describe('placeIsolation の基本の振る舞い', () => {
  it('設置に成功するとポイントを消費する', () => {
    const sim = createSim({ w: 800, h: 600 }, 40, 'epidemic', 1);
    const before = sim.points;

    const ok = placeIsolation(sim, 100, 100);

    expect(ok).toBe(true);
    expect(sim.points).toBe(before - CONFIG.costs.isolation);
    expect(sim.zones).toHaveLength(1);
    expect(sim.actions.isolation).toBe(1);
  });

  it('ポイントが足りないときは false を返し、状態を変えない', () => {
    const sim = createSim({ w: 800, h: 600 }, 40, 'epidemic', 1);
    sim.points = CONFIG.costs.isolation - 1;
    const pointsBefore = sim.points;
    const zonesBefore = sim.zones.length;
    const actionsBefore = sim.actions.isolation;

    const ok = placeIsolation(sim, 100, 100);

    expect(ok).toBe(false);
    expect(sim.points).toBe(pointsBefore);
    expect(sim.zones.length).toBe(zonesBefore);
    expect(sim.actions.isolation).toBe(actionsBefore);
  });
});

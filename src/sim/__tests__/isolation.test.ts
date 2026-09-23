import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createSim, placeIsolation, step } from '../engine';
import type { Agent, SimState } from '../types';

const DT = 1 / 60;
const WORLD = { w: 1000, h: 600 };

/** ウェーブを止めた盤面（大型イベントが予定を上書きして測定に混ざらないように） */
function quietSim(seed: number): SimState {
  const sim = createSim(WORLD, 30, 'epidemic', seed);
  sim.nextWave = Number.MAX_SAFE_INTEGER;
  return sim;
}

function runFor(sim: SimState, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    step(sim, DT);
    each?.();
  }
}

function centerOf(b: { x: number; y: number; w: number; h: number }) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

const dist = (a: Agent, p: { x: number; y: number }) => Math.hypot(a.x - p.x, a.y - p.y);

describe('隔離は封鎖である（通れなくする）', () => {
  it('外の人は封鎖の中に入らず、閉じ込められた人は外へ出ない', () => {
    const sim = quietSim(3);
    runFor(sim, 26); // 昼に入り、人が広場へ向かい始めたところ
    const c = centerOf(sim.city.plaza);
    // 点数が足りなくても置けるようにする（振る舞いを確かめるのが目的）
    sim.points = CONFIG.maxPoints;
    expect(placeIsolation(sim, c.x, c.y)).toBe(true);
    const zone = sim.zones[0];
    const confined = new Set(sim.agents.filter((a) => a.zone === zone.id).map((a) => a.id));

    let checks = 0;
    runFor(sim, CONFIG.zoneLife - 0.5, () => {
      if (Math.round(sim.time / DT) % 30 !== 0) return;
      checks += 1;
      for (const a of sim.agents) {
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) throw new Error(`#${a.id} の座標が壊れている`);
        const d = dist(a, zone);
        if (confined.has(a.id)) {
          expect(d, `閉じ込められた #${a.id} が外へ出た t=${sim.time.toFixed(2)}`).toBeLessThanOrEqual(zone.r);
        } else if (a.zone === -1) {
          expect(d, `外の #${a.id} が中へ入った t=${sim.time.toFixed(2)}`).toBeGreaterThanOrEqual(zone.r);
        }
      }
    });
    expect(checks).toBeGreaterThan(10);
  });

  it('封鎖の境界をまたいでうつらない', () => {
    const sim = quietSim(4);
    for (const a of sim.agents) {
      a.state = 'susceptible';
      a.x = 20;
      a.y = 20;
      a.path = [];
      a.arrived = true;
      a.stay = { x: 10, y: 10, w: 20, h: 20 };
    }
    const c = centerOf(sim.city.plaza);
    const inside = sim.agents[0];
    inside.state = 'infected';
    inside.infectionTimer = 30;
    inside.x = c.x;
    inside.y = c.y;
    sim.points = CONFIG.maxPoints;
    placeIsolation(sim, c.x, c.y);
    expect(inside.zone).toBeGreaterThanOrEqual(0);

    // 円のすぐ外、接触の届く所に未感染者を置く
    const outside = sim.agents[1];
    outside.x = c.x + sim.zones[0].r + 2;
    outside.y = c.y;
    outside.stay = { x: outside.x - 1, y: outside.y - 1, w: 2, h: 2 };
    inside.x = c.x + sim.zones[0].r - 2;
    inside.y = c.y;
    runFor(sim, 3);
    expect(outside.exposure).toBe(0);
    expect(outside.state).toBe('susceptible');
  });

  it('封鎖の縁に人が溜まらない', () => {
    const sim = quietSim(5);
    runFor(sim, 26);
    const c = centerOf(sim.city.plaza);
    sim.points = CONFIG.maxPoints;
    placeIsolation(sim, c.x, c.y);
    const zone = sim.zones[0];
    const lingering = new Map<number, number>();
    let worst = 0;
    runFor(sim, CONFIG.zoneLife - 0.5, () => {
      for (const a of sim.agents) {
        if (a.zone !== -1) continue;
        const d = dist(a, zone) - zone.r;
        if (d >= 0 && d <= 30) {
          const t = (lingering.get(a.id) ?? 0) + DT;
          lingering.set(a.id, t);
          worst = Math.max(worst, t);
        } else {
          lingering.delete(a.id);
        }
      }
    });
    expect(worst, '封鎖の縁から30以内に続けて留まった最長の秒数').toBeLessThan(4);
  });

  it('封鎖が消えたら、閉じ込められていた人は予定に戻る', () => {
    const sim = quietSim(6);
    runFor(sim, 40); // 昼。人が広場に着いている時刻
    const c = centerOf(sim.city.plaza);
    sim.points = CONFIG.maxPoints;
    placeIsolation(sim, c.x, c.y);
    const zoneId = sim.zones[0].id;
    const confined = sim.agents.filter((a) => a.zone === zoneId);
    expect(confined.length).toBeGreaterThan(0);
    runFor(sim, CONFIG.zoneLife + 0.5);
    expect(sim.zones.length).toBe(0);
    const expected = sim.time < 50 ? 'noon' : 'home';
    for (const a of confined) {
      expect(a.zone).toBe(-1);
      expect(a.purpose, `#${a.id} は時間帯の行き先へ戻る`).toBe(expected);
    }
  });
});

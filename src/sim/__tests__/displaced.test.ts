import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createSim, placeIsolation, step } from '../engine';
import type { ModeId, SimState } from '../types';

const DT = 1 / 60;
const WORLD = { w: 1000, h: 600 };
const SEED = 11;

/** ウェーブを止め、ポイントを満たした盤面（大型イベントが予定を上書きして測定に混ざらないように） */
function quietSim(mode: ModeId, seed: number): SimState {
  const sim = createSim(WORLD, 30, mode, seed);
  sim.nextWave = Number.MAX_SAFE_INTEGER;
  sim.points = CONFIG.maxPoints;
  return sim;
}

/** dt 1/60 で seconds 秒進める。1ステップごとに each を呼び、決着がついたら止める */
function runFor(sim: SimState, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    step(sim, DT);
    each?.();
    if (sim.outcome !== 'playing') break;
  }
}

function centerOf(b: { x: number; y: number; w: number; h: number }) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/**
 * 学校と職場の中心に隔離を置き、途中で消えないよう寿命を延ばす。
 * 隔離がちょうど2つなら、維持費（1.5×2）が回復（3）と釣り合う。
 * だから新しい代償が無ければ、社会活動は下がらず満点のままになる。
 */
function closeSchoolAndWork(sim: SimState): void {
  for (const block of [sim.city.school, sim.city.work]) {
    const c = centerOf(block);
    expect(placeIsolation(sim, c.x, c.y)).toBe(true);
  }
  expect(sim.zones.length).toBe(2);
  for (const z of sim.zones) {
    z.life = 999;
    z.maxLife = 999;
  }
}

describe('封鎖で行き先を変えられた人の数だけ、社会活動が下がる', () => {
  it('朝に学校と職場を閉じると、行けなくなった人が毎秒数えられ、社会活動が下がる', () => {
    const sim = quietSim('epidemic', SEED);
    closeSchoolAndWork(sim);
    // 置いた瞬間には、まだ誰も出発していないので数えるものが無い。数えるのは出発してからである
    expect(sim.displaced).toBe(0);

    let maxDisplaced = 0;
    runFor(sim, 10, () => {
      maxDisplaced = Math.max(maxDisplaced, sim.displaced);
    });

    expect(maxDisplaced).toBeGreaterThanOrEqual(5);
    expect(sim.social).toBeLessThan(CONFIG.socialMax - 5);
  });

  it('封鎖が無ければ、誰も数えられず、社会活動は満点のままである', () => {
    const sim = quietSim('epidemic', SEED);

    let maxDisplaced = 0;
    runFor(sim, 10, () => {
      maxDisplaced = Math.max(maxDisplaced, sim.displaced);
    });

    expect(maxDisplaced).toBe(0);
    expect(sim.social).toBe(CONFIG.socialMax);
  });

  it('封鎖が1つも無ければ、振り替えの印が残っている人がいても数えない', () => {
    const sim = quietSim('epidemic', SEED);
    for (const a of sim.agents) a.redirected = true;

    step(sim, DT);

    expect(sim.displaced).toBe(0);
    expect(sim.social).toBe(CONFIG.socialMax);
  });

  it('封鎖が消えたら、数えるのをやめ、社会活動が戻り始める', () => {
    const sim = quietSim('epidemic', SEED);
    closeSchoolAndWork(sim);
    // 出発の個人差は最大 departureJitterMax 秒。そのあとなら、全員が行き先を変えられている
    runFor(sim, CONFIG.departureJitterMax + 2);
    expect(sim.displaced).toBeGreaterThan(0);

    // 寿命を尽きさせる。消えるステップでは、消える前に数えるので、その1回だけは数えたままである
    for (const z of sim.zones) z.life = 0.001;
    step(sim, DT);
    expect(sim.zones.length).toBe(0);

    const socialAtExpiry = sim.social;
    let maxAfter = 0;
    runFor(sim, 2, () => {
      maxAfter = Math.max(maxAfter, sim.displaced);
    });
    expect(maxAfter).toBe(0);
    expect(sim.social).toBeGreaterThan(socialAtExpiry);
  });

  it('数えるのは外で行き先を変えられた人だけで、閉じ込められた人は数えない。削る量は人数に比例する', () => {
    const sim = quietSim('epidemic', SEED);
    const c = centerOf(sim.city.plaza);
    const inside = sim.agents.slice(0, 20);
    const outside = sim.agents.slice(20);
    // 20人を広場の円の中へ集め、封鎖で閉じ込める。残りの10人は円から遠い隅へ置く
    for (const a of inside) {
      a.x = c.x;
      a.y = c.y;
    }
    for (const a of outside) {
      a.x = 20;
      a.y = 20;
    }
    expect(placeIsolation(sim, c.x, c.y)).toBe(true);
    expect(inside.every((a) => a.zone >= 0)).toBe(true);
    expect(outside.every((a) => a.zone < 0)).toBe(true);

    // 閉じ込められる前に振り替えられていた人がいる状況を、印を立てて作る（閉じ込めても印は消えない）。
    // 外の10人のうち行き先を変えられているのは4人だけである
    for (const a of inside) a.redirected = true;
    outside.forEach((a, i) => {
      a.redirected = i < 4;
    });
    sim.social = 50; // 上限に張り付いていると、削った量が見えない
    const zoneCost = CONFIG.socialCostPerZone;

    step(sim, DT);

    expect(sim.displaced).toBe(4);
    const expected = 50 + (CONFIG.socialRecovery - zoneCost - 4 * CONFIG.socialCostPerDisplaced) * DT;
    expect(sim.social).toBeCloseTo(expected, 10);
  });
});

describe('新商品モードは変わらない（置けるのはイベントだけで、封鎖ではない）', () => {
  it('学校の中心にイベントを置いても、誰も数えられない', () => {
    const sim = quietSim('product', SEED);
    const c = centerOf(sim.city.school);
    expect(placeIsolation(sim, c.x, c.y)).toBe(true);
    expect(sim.zones[0].kind).toBe('event');
    sim.zones[0].life = 999;
    sim.zones[0].maxLife = 999;

    let maxDisplaced = 0;
    runFor(sim, 10, () => {
      maxDisplaced = Math.max(maxDisplaced, sim.displaced);
    });

    expect(maxDisplaced).toBe(0);
  });

  it('振り替えの印が残っている人がいても、イベントしか無ければ数えず、好感度も削らない', () => {
    const sim = quietSim('product', SEED);
    const c = centerOf(sim.city.school);
    expect(placeIsolation(sim, c.x, c.y)).toBe(true);
    for (const a of sim.agents) a.redirected = true;

    step(sim, DT);

    expect(sim.displaced).toBe(0);
    // イベント1つの維持費は回復より小さいので、好感度は満点のままである
    expect(sim.social).toBe(CONFIG.socialMax);
  });
});

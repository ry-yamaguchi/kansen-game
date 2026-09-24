import { describe, expect, it } from 'vitest';
import { createSim, step } from '../engine';
import type { Agent, SimState } from '../types';

const DT = 1 / 60;
const WORLD = { w: 1000, h: 600 };
const POPULATION = 30;
const ARRIVAL_RATIO = 0.8;

/**
 * 時間帯の予定だけを確かめるため、ウェーブを止めた盤面を作る。
 * 大型イベントは人を広場へ集めて予定を上書きするので、到着率の測定に混ざる（別のテストで確かめる）
 */
function scheduleOnly(seed: number): SimState {
  const sim = createSim(WORLD, POPULATION, 'epidemic', seed);
  sim.nextWave = Number.MAX_SAFE_INTEGER;
  return sim;
}

function runFor(sim: SimState, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) step(sim, DT);
}

function ratio(sim: SimState, inside: (a: Agent) => boolean): number {
  return sim.agents.filter(inside).length / sim.agents.length;
}

function insideBlock(a: Agent, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x >= b.x && a.x <= b.x + b.w && a.y >= b.y && a.y <= b.y + b.h;
}

// 介入なし（誰も隔離・ワクチン・ロックダウンを打たない）で自然に進める
describe('介入なしで進めると、時間帯ごとの目的地に大半が着く', () => {
  it('朝20秒時点で、8割以上が通う先（学校・職場）の中にいる', () => {
    const sim = scheduleOnly(11);
    runFor(sim, 20);
    const r = ratio(sim, (a) => insideBlock(a, a.commuteRole === 'school' ? sim.city.school : sim.city.work));
    expect(r).toBeGreaterThanOrEqual(ARRIVAL_RATIO);
  });

  it('昼20秒時点（通算45秒）で、8割以上が広場か駅の中にいる', () => {
    const sim = scheduleOnly(11);
    const steps = Math.round(45 / DT);
    for (let i = 0; i < steps; i += 1) {
      // 感染が目に見えて広がると自粛して広場を避ける人が出る（B4。behaviors.test.ts で別途確認する）。
      // ここでは経路そのものが機能しているかを見たいので、流入で増える人も含め自粛を無効化しておく
      for (const a of sim.agents) a.avoidThreshold = 1.01;
      step(sim, DT);
    }
    const r = ratio(sim, (a) => insideBlock(a, sim.city.plaza) || insideBlock(a, sim.city.station));
    expect(r).toBeGreaterThanOrEqual(ARRIVAL_RATIO);
  });

  it('夕方20秒時点（通算70秒）で、8割以上が家の近くにいる', () => {
    const sim = scheduleOnly(11);
    runFor(sim, 70);
    const r = ratio(sim, (a) => Math.hypot(a.x - a.homeX, a.y - a.homeY) <= 40);
    expect(r).toBeGreaterThanOrEqual(ARRIVAL_RATIO);
  });

  it('大型イベントの最中は、大半が広場へ向かうか広場の中にいる', () => {
    const sim = scheduleOnly(11);
    runFor(sim, 30);
    // 昼の途中で大型イベントを起こす
    sim.gatherTimer = 9;
    runFor(sim, 7);
    const p = sim.city.plaza;
    const towardPlaza = (a: Agent) =>
      insideBlock(a, p) ||
      (a.targetX >= p.x && a.targetX <= p.x + p.w && a.targetY >= p.y && a.targetY <= p.y + p.h);
    expect(ratio(sim, towardPlaza)).toBeGreaterThanOrEqual(ARRIVAL_RATIO);
  });
});

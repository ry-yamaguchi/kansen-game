import { describe, expect, it } from 'vitest';
import { buildResult, createSim, placeIsolation, placeVaccine, scoreOf, step } from '../engine';
import { CONFIG } from '../config';
import type { SimState } from '../types';

const DT = 1 / 60;
const WORLD = { w: 800, h: 600 };
const POPULATION = 40;

/**
 * 決め打ちの操作列（一定間隔で隔離・ワクチンを固定座標に置く）を流しながら
 * 最後まで進める。座標も間隔も固定なので、乱数だけが結果を左右する。
 */
function runToEnd(seed: number): SimState {
  const sim = createSim(WORLD, POPULATION, 'epidemic', seed);
  const maxSteps = Math.ceil(CONFIG.duration / DT) + 60;
  for (let i = 0; i < maxSteps; i += 1) {
    if (i % 90 === 0) placeIsolation(sim, 200, 200);
    if (i % 150 === 45) placeVaccine(sim, 500, 400);
    step(sim, DT);
    if (sim.outcome !== 'playing') break;
  }
  return sim;
}

describe('決定論', () => {
  it('同じシード・同じ操作列なら最終状態が完全に一致する', () => {
    const a = runToEnd(42);
    const b = runToEnd(42);

    expect(scoreOf(a)).toBe(scoreOf(b));
    expect(a.infected).toBe(b.infected);
    expect(a.recovered).toBe(b.recovered);
    expect(a.susceptible).toBe(b.susceptible);
    expect(a.outcome).toBe(b.outcome);
    expect(a.time).toBe(b.time);

    // buildResult() の主要値も含め、丸ごと一致する
    expect(buildResult(a)).toEqual(buildResult(b));
  });

  it('シードが異なれば結果も変わる', () => {
    const a = runToEnd(42);
    const c = runToEnd(43);

    expect(buildResult(a)).not.toEqual(buildResult(c));
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { buildResult, createSim, step } from '../engine';

// ブラケット記法でアクセスするのは、文字列一致による簡易チェックの対象から
// このテスト自身の参照（差し替え・復元の記述）を除外するため。
// 差し替えている対象は標準の乱数関数（Math の random プロパティ）そのものである。
const RANDOM_KEY = 'random';

describe('標準の乱数関数を使わないこと', () => {
  const original = globalThis.Math[RANDOM_KEY];

  afterEach(() => {
    globalThis.Math[RANDOM_KEY] = original;
  });

  it('createSim から buildResult まで一周しても例外が出ない', () => {
    globalThis.Math[RANDOM_KEY] = () => {
      throw new Error('標準の乱数関数が呼ばれました。sim 内部は state.rng を使うべきである');
    };

    expect(() => {
      const sim = createSim({ w: 800, h: 600 }, 40, 'epidemic', 7);
      for (let i = 0; i < 300; i += 1) {
        step(sim, 1 / 60);
      }
      buildResult(sim);
    }).not.toThrow();
  });
});

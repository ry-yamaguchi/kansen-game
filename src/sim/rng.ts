/**
 * シード付き疑似乱数生成器。
 *
 * シミュレーションを決定論的にするため、標準の乱数関数の代わりにこれを使う。
 * 依存ライブラリを増やさないよう、mulberry32 を自前で実装している。
 * 小さく高速で、ゲームのバランス計測に十分な品質を持つ。
 */

export interface Rng {
  /** 0以上1未満の浮動小数点数を返す */
  next(): number;
  /** min以上max未満の浮動小数点数を返す */
  range(min: number, max: number): number;
  /** 0以上n未満の整数を返す */
  int(n: number): number;
}

export function createRng(seed: number): Rng {
  // 内部状態は32bit整数として扱う。0 も有効なシードにするため >>> 0 で正規化する
  let a = seed >>> 0;

  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range(min: number, max: number): number {
      return min + next() * (max - min);
    },
    int(n: number): number {
      return Math.floor(next() * n);
    },
  };
}

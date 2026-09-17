import type { World } from '../sim/types';

/** 世界座標をキャンバス座標へ写す変換。描画と入力の両方で同じものを使う。 */
export interface View {
  scale: number;
  ox: number;
  oy: number;
}

/** 世界全体が収まるように拡大率を決め、余白は中央寄せにする */
export function computeView(cssWidth: number, cssHeight: number, world: World): View {
  const scale = Math.min(cssWidth / world.w, cssHeight / world.h);
  return {
    scale,
    ox: (cssWidth - world.w * scale) / 2,
    oy: (cssHeight - world.h * scale) / 2,
  };
}

export function screenToWorld(view: View, px: number, py: number): { x: number; y: number } {
  return { x: (px - view.ox) / view.scale, y: (py - view.oy) / view.scale };
}

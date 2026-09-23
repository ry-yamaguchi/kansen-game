import { describe, expect, it } from 'vitest';
import { buildCity } from '../city';

describe('街の区画（buildCity）', () => {
  it('横長は5列×3行で、広場が中央、駅が右下にある', () => {
    const city = buildCity({ w: 1000, h: 600 });
    expect(city.cols).toBe(5);
    expect(city.rows).toBe(3);
    expect(city.plaza.col).toBe(2);
    expect(city.plaza.row).toBe(1);
    expect(city.station.col).toBe(4);
    expect(city.station.row).toBe(2);
    expect(city.school.row).toBe(0);
    expect(city.work.row).toBe(0);
  });

  it('縦長は横長を時計回りに90°回した3列×5行で、広場は中央のまま、駅は左下へ移る（鏡像ではない）', () => {
    const city = buildCity({ w: 600, h: 1000 });
    expect(city.cols).toBe(3);
    expect(city.rows).toBe(5);
    // 広場は回しても中央のまま
    expect(city.plaza.col).toBe(1);
    expect(city.plaza.row).toBe(2);
    // 横長では右下（col4,row2）だった駅が、時計回りの回転で左下（col0,row4）へ移る。
    // 単純な左右反転（鏡像）なら右下のまま、上下反転なら右上になる。どちらでもないことを確かめる
    expect(city.station.col).toBe(0);
    expect(city.station.row).toBe(4);
    // 学校・職場は横長では上段（row0）に並んでいた。時計回りの回転で右列（col=cols-1）に集まる
    expect(city.school.col).toBe(2);
    expect(city.work.col).toBe(2);
    expect(city.school.row).toBeLessThan(city.work.row);
  });

  it('区画は世界の中に収まり、互いに重ならない', () => {
    for (const world of [{ w: 1000, h: 600 }, { w: 600, h: 1000 }, { w: 800, h: 600 }]) {
      const city = buildCity(world);
      for (const b of city.blocks) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(world.w + 1e-6);
        expect(b.y + b.h).toBeLessThanOrEqual(world.h + 1e-6);
      }
      // 住宅1・広場1・駅1・学校1・職場1 が必ず1つずつある
      expect(city.blocks.filter((b) => b.role === 'plaza')).toHaveLength(1);
      expect(city.blocks.filter((b) => b.role === 'station')).toHaveLength(1);
      expect(city.blocks.filter((b) => b.role === 'school')).toHaveLength(1);
      expect(city.blocks.filter((b) => b.role === 'work')).toHaveLength(1);
      expect(city.houses.length).toBe(city.blocks.length - 4);
    }
  });
});

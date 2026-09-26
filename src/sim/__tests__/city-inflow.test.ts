import { describe, expect, it } from 'vitest';
import { buildCity } from '../city';
import { CONFIG } from '../config';
import { createSim, placeIsolation, step } from '../engine';
import { modeOf } from '../modes';

const DT = 1 / 60;

/** 外周4隅の交差点を、buildEntrances と同じ順で並べる */
function outerCorners(city: ReturnType<typeof buildCity>) {
  return [city.nodes[0][0], city.nodes[0][city.cols], city.nodes[city.rows][city.cols], city.nodes[city.rows][0]];
}

describe('街の出入り口（buildCity の entrances）', () => {
  it('駅1つとバス停3つがあり、バス停は駅に最も近い外周の角を使わない。どの入口も区画の外にある', () => {
    for (const world of [{ w: 1000, h: 600 }, { w: 600, h: 1000 }]) {
      const city = buildCity(world);
      expect(city.entrances).toHaveLength(4);

      const [station, ...buses] = city.entrances;
      const stationCenter = { x: city.station.x + city.station.w / 2, y: city.station.y + city.station.h / 2 };
      expect(station.kind).toBe('station');
      expect(station.x).toBeCloseTo(stationCenter.x);
      expect(station.y).toBeCloseTo(stationCenter.y);

      expect(buses).toHaveLength(3);
      for (const b of buses) expect(b.kind).toBe('bus');
      // 3つとも別の交差点である
      expect(new Set(buses.map((b) => `${b.x},${b.y}`)).size).toBe(3);

      // 駅に最も近い外周の角は使われておらず、バス停3つは残りの角と一致する
      const corners = outerCorners(city);
      const nearestCorner = corners.reduce((best, c) =>
        Math.hypot(c.x - stationCenter.x, c.y - stationCenter.y) <
        Math.hypot(best.x - stationCenter.x, best.y - stationCenter.y)
          ? c
          : best,
      );
      for (const b of buses) {
        expect(b.x === nearestCorner.x && b.y === nearestCorner.y).toBe(false);
        expect(corners.some((c) => c.x === b.x && c.y === b.y)).toBe(true);
      }

      // バス停はどれも区画の中には入っていない（街の外周の交差点なので、駅のように区画の中心にはならない）
      for (const b of buses) {
        for (const block of city.blocks) {
          const inside = b.x > block.x && b.x < block.x + block.w && b.y > block.y && b.y < block.y + block.h;
          expect(inside, `バス停(${b.x},${b.y}) が区画(${block.col},${block.row})の中にある`).toBe(false);
        }
      }
    }
  });
});

describe('外からの流入は、駅かバス停3か所のいずれかから現れる', () => {
  it('封鎖が無ければ、現れた瞬間の位置は駅の区画の中か、バス停のジッター範囲内である', () => {
    let sawStation = false;
    let sawBus = false;

    for (let seed = 1; seed <= 6; seed += 1) {
      const sim = createSim({ w: 1000, h: 600 }, 30, 'epidemic', seed);
      const station = sim.city.station;
      const busEntrances = sim.city.entrances.filter((e) => e.kind === 'bus');
      const busJitter = sim.city.streetWidth * CONFIG.busStopJitterRatio;
      let prevCount = sim.agents.length;
      const totalSteps = Math.ceil(CONFIG.duration / DT);

      for (let i = 0; i < totalSteps; i += 1) {
        step(sim, DT);
        if (sim.agents.length > prevCount) {
          for (let k = prevCount; k < sim.agents.length; k += 1) {
            const a = sim.agents[k];
            const insideStation =
              a.x >= station.x && a.x <= station.x + station.w && a.y >= station.y && a.y <= station.y + station.h;
            const nearBus = busEntrances.some(
              (e) => Math.abs(a.x - e.x) <= busJitter + 1e-6 && Math.abs(a.y - e.y) <= busJitter + 1e-6,
            );
            expect(
              insideStation || nearBus,
              `seed=${seed} agent#${a.id} は駅の中でもバス停の近くでもない (${a.x},${a.y})`,
            ).toBe(true);
            if (insideStation) sawStation = true;
            if (nearBus) sawBus = true;
          }
          prevCount = sim.agents.length;
        }
        if (sim.outcome !== 'playing') break;
      }
    }

    expect(sawStation, '駅からの到着が一度も無かった').toBe(true);
    expect(sawBus, 'バス停からの到着が一度も無かった').toBe(true);
  });
});

describe('入口の封鎖: 塞いだ入口は避けて、開いている入口から入ってくる', () => {
  it('駅の入口を塞いでも流入は途切れず、新しい人はその封鎖の外に現れる', () => {
    const sim = createSim({ w: 1000, h: 600 }, 30, 'epidemic', 1);
    sim.points = CONFIG.maxPoints;
    const stationEntrance = sim.city.entrances[0];
    expect(placeIsolation(sim, stationEntrance.x, stationEntrance.y)).toBe(true);
    const zone = sim.zones[0];
    // 寿命が尽きて消えないようにする（今回の確認中は封鎖され続けてほしい）
    zone.life = 999;
    zone.maxLife = 999;

    let prevCount = sim.agents.length;
    let inflowEvents = 0;
    const totalSteps = Math.ceil(CONFIG.duration / DT);

    for (let i = 0; i < totalSteps; i += 1) {
      step(sim, DT);
      if (sim.agents.length > prevCount) {
        inflowEvents += 1;
        for (let k = prevCount; k < sim.agents.length; k += 1) {
          const a = sim.agents[k];
          const d = Math.hypot(a.x - zone.x, a.y - zone.y);
          expect(d, `agent#${a.id} が塞いだ入口の中に現れた`).toBeGreaterThan(zone.r);
          expect(a.zone, `agent#${a.id} が閉じ込められている`).toBe(-1);
        }
        prevCount = sim.agents.length;
      }
      if (sim.outcome !== 'playing') break;
    }

    expect(inflowEvents, '流入が3回以上起きなかった').toBeGreaterThanOrEqual(3);
    // 駅は塞がれているので、駅が選ばれた回（このseedでは必ず起きる）は必ず振り替えられる
    expect(sim.redirectNoticeShown).toBe(true);
  });

  it('入口を4つすべて塞ぐと、新しい人はそれでも増え続けるが、選んだ入口の中に閉じ込められる', () => {
    const sim = createSim({ w: 1000, h: 600 }, 30, 'epidemic', 1);
    // 4つの入口すべてに、maxZonesの制限を無視して直接、長寿命の封鎖を置く
    for (const e of sim.city.entrances) {
      sim.zones.push({
        id: sim.nextZoneId,
        x: e.x,
        y: e.y,
        r: CONFIG.zoneRadius,
        life: 9999,
        maxLife: 9999,
        kind: 'blockade',
      });
      sim.nextZoneId += 1;
    }

    const before = sim.agents.length;
    let grew = false;
    const maxSteps = Math.ceil(CONFIG.duration / DT);
    for (let i = 0; i < maxSteps; i += 1) {
      step(sim, DT);
      if (sim.agents.length > before) {
        grew = true;
        break;
      }
      if (sim.outcome !== 'playing') break;
    }

    expect(grew, '流入が一度も起きなかった').toBe(true);
    const newcomers = sim.agents.slice(before);
    expect(newcomers.length).toBeGreaterThan(0);
    for (const a of newcomers) {
      expect(a.zone, `agent#${a.id} が閉じ込められていない`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('新商品モードのイベントは流入を閉じ込めない（道具/イベント）', () => {
  it('駅の入口にイベントを置いても、そこに現れた新しい人は閉じ込められない', () => {
    const sim = createSim({ w: 1000, h: 600 }, 30, 'product', 1);
    // fizzle（愛用中0人での打ち切り）で早く終わり、確認の途中で流入が止まらないよう、
    // 1人だけ永続的に愛用中にしておく。inflowStationShare など流入そのものの挙動は変えない
    sim.agents[0].state = 'infected';
    sim.agents[0].infectionTimer = 1e6;

    const stationEntrance = sim.city.entrances[0];
    sim.zones.push({
      id: sim.nextZoneId,
      x: stationEntrance.x,
      y: stationEntrance.y,
      r: CONFIG.zoneRadius,
      life: 999,
      maxLife: 999,
      kind: 'event',
    });
    sim.nextZoneId += 1;
    const zone = sim.zones[0];

    let prevCount = sim.agents.length;
    let sawInsideEvent = false;
    const maxSteps = Math.ceil(CONFIG.duration / DT);
    for (let i = 0; i < maxSteps; i += 1) {
      step(sim, DT);
      if (sim.agents.length > prevCount) {
        for (let k = prevCount; k < sim.agents.length; k += 1) {
          const a = sim.agents[k];
          const d = Math.hypot(a.x - zone.x, a.y - zone.y);
          if (d <= zone.r) {
            sawInsideEvent = true;
            expect(a.zone, `agent#${a.id} がイベントの円の中で閉じ込められている`).toBe(-1);
          }
        }
        prevCount = sim.agents.length;
      }
      if (sim.outcome !== 'playing') break;
    }

    expect(sawInsideEvent, 'イベントの円の中に現れた新しい人が一度もいなかった').toBe(true);
  });
});

describe('到着の演出: パルスと浮かぶ文字', () => {
  it('流入が起きると、arrivalパルスと到着人数の文字が積まれる', () => {
    const sim = createSim({ w: 1000, h: 600 }, 30, 'epidemic', 1);
    const maxSteps = Math.ceil(CONFIG.duration / DT);
    let prevCount = sim.agents.length;
    let spawned = 0;
    for (let i = 0; i < maxSteps; i += 1) {
      step(sim, DT);
      if (sim.agents.length > prevCount) {
        spawned = sim.agents.length - prevCount;
        break;
      }
      if (sim.outcome !== 'playing') break;
    }
    expect(spawned).toBeGreaterThan(0);

    const pulse = sim.pulses.find((p) => p.kind === 'arrival');
    expect(pulse, 'arrivalパルスが積まれていない').toBeDefined();

    const words = modeOf('epidemic').effectText;
    const expectedText = words.arrival.replace('{n}', String(spawned));
    const popup = sim.popups.find((p) => p.text === expectedText);
    expect(popup, `想定した文字「${expectedText}」が積まれていない`).toBeDefined();
    expect(popup!.tone).toBe('bad');
  });
});

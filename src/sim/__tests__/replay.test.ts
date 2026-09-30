import { describe, expect, it } from 'vitest';
import { CONFIG, planWorld } from '../config';
import {
  buildResult,
  createSim,
  drift,
  placeIsolation,
  placeVaccine,
  step,
  triggerLockdown,
} from '../engine';
import {
  COUNTDOWN_STEPS,
  MAX_STEPS_PER_FRAME,
  STEP,
  advanceCountdown,
  countdownDisplay,
  createCountdownProgress,
  replayRecord,
  resultOf,
} from '../replay';
import type { MatchRecord, RecordedAction } from '../replay';
import type { ModeId, SimState } from '../types';

const MODES: readonly ModeId[] = ['epidemic', 'rumor', 'anger', 'product'];
/** 画面と同じ計算で決めた盤面（PC の大きさ） */
const { world, population } = planWorld(1280, 720);

/** フレームの長さ（秒）を、決まった式でばらつかせて並べる。標準の乱数関数は使わない */
function jitteredFrames(count: number, min: number, max: number): number[] {
  const frames: number[] = [];
  let x = 12345;
  for (let i = 0; i < count; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    frames.push(min + (x / 4294967296) * (max - min));
  }
  return frames;
}

/** 感染者がいちばん集まっている所を探す（scripts/balance.ts の hotspot と同じ考え方） */
function hotspot(sim: SimState, radius: number): { x: number; y: number; infected: number } {
  let best = { x: 0, y: 0, infected: 0 };
  for (const a of sim.agents) {
    if (a.state !== 'infected') continue;
    let infected = 0;
    for (const b of sim.agents) {
      if (b.state === 'infected' && Math.hypot(a.x - b.x, a.y - b.y) <= radius) infected += 1;
    }
    if (infected > best.infected) best = { x: a.x, y: a.y, infected };
  }
  return best;
}

/**
 * 人の代わりに打つ簡単な癖。3秒ごとに感染の濃い所へワクチン、9秒ごとに隔離、25秒にロックダウン。
 * ポイントが足りなければエンジンに断られる手も混ざる。それでも記録と再生は一致しなければならない。
 */
function habit(sim: SimState, count: number): RecordedAction[] {
  const moves: RecordedAction[] = [];
  if (count % 180 === 60) {
    const h = hotspot(sim, CONFIG.vaccineRadius);
    if (h.infected > 0) moves.push({ s: count, tool: 'vaccine', x: h.x, y: h.y });
  }
  if (count % 540 === 120) {
    const h = hotspot(sim, CONFIG.zoneRadius);
    if (h.infected > 0) moves.push({ s: count, tool: 'isolation', x: h.x, y: h.y });
  }
  if (count === 1500) moves.push({ s: count, tool: 'lockdown' });
  return moves;
}

/** 決め打ちの手を、その刻みに打つ */
function planned(plan: RecordedAction[]): (sim: SimState, count: number) => RecordedAction[] {
  return (_sim, count) => plan.filter((m) => m.s === count);
}

interface Session {
  sim: SimState;
  record: MatchRecord;
  /** エンジンが断った手の数 */
  refused: number;
  /** step を回した回数 */
  steps: number;
}

/**
 * 画面（useGame）と同じ順序で1試合を遊ぶ。
 * 開始前は、ばらつくフレームの実時間で advanceCountdown を呼ぶ。遊び始めたら 1 刻みずつ step を回す。
 * 手は「エンジンの関数を呼ぶ直前」に記録へ足す。再生側の applyAction は使わず、エンジンを直接呼ぶ
 * （記録と再生が同じ間違いをしていても気づけるように）。
 * choose は、いま（step が count 回終わった時点）打つ手を返す。
 */
function playLikeUi(
  mode: ModeId,
  seed: number,
  choose: (sim: SimState, count: number) => RecordedAction[],
): Session {
  const sim = createSim(world, population, mode, seed);
  const progress = createCountdownProgress();
  for (const dt of jitteredFrames(2000, 0.004, 0.06)) {
    if (advanceCountdown(sim, progress, dt)) break;
  }
  expect(progress.done).toBe(COUNTDOWN_STEPS);

  const record: MatchRecord = {
    v: 1,
    build: 'test',
    mode,
    seed,
    world: { w: world.w, h: world.h },
    population,
    actions: [],
  };
  let refused = 0;
  let steps = 0;
  const maxSteps = Math.ceil(CONFIG.duration / STEP) + 60;
  while (steps < maxSteps) {
    for (const move of choose(sim, steps)) {
      record.actions.push({ ...move });
      const accepted =
        move.tool === 'isolation'
          ? placeIsolation(sim, move.x, move.y)
          : move.tool === 'vaccine'
            ? placeVaccine(sim, move.x, move.y)
            : triggerLockdown(sim);
      if (!accepted) refused += 1;
    }
    step(sim, STEP);
    steps += 1;
    if (sim.outcome !== 'playing') break;
  }
  record.result = resultOf(sim);
  return { sim, record, refused, steps };
}

/** 盤面の中身を丸ごと比べるための写し。乱数をどこまで使ったかも、次に出る値で確かめる */
function fingerprint(sim: SimState) {
  return {
    result: buildResult(sim),
    outcome: sim.outcome,
    time: sim.time,
    points: sim.points,
    social: sim.social,
    zones: sim.zones,
    agents: sim.agents,
    nextRandom: sim.rng.next(),
  };
}

/** CONFIG.duration を一時的に差し替えて実行する（ほかのテストへ持ち越さない） */
function withDuration<T>(seconds: number, body: () => T): T {
  const table = CONFIG as unknown as { duration: number };
  const saved = table.duration;
  table.duration = seconds;
  try {
    return body();
  } finally {
    table.duration = saved;
  }
}

describe('試合の記録から、遊んだ試合を厳密に再生する', () => {
  it('画面と同じ手順で遊んだ試合（断られた手を含む）を、記録から一致させて再生できる', () => {
    const plan: RecordedAction[] = [
      { s: 120, tool: 'isolation', x: 500.123456789, y: 300.987654321 },
      { s: 300, tool: 'vaccine', x: 312.5, y: 201.75 },
      { s: 600, tool: 'lockdown' },
      { s: 601, tool: 'vaccine', x: 702.25, y: 401.5 },
      // ポイントを使い切ったところへの3連打。少なくとも1つはエンジンに断られる
      { s: 602, tool: 'vaccine', x: 702.25, y: 401.5 },
      { s: 603, tool: 'vaccine', x: 702.25, y: 401.5 },
      { s: 604, tool: 'vaccine', x: 702.25, y: 401.5 },
    ];
    const live = playLikeUi('epidemic', 20260930, planned(plan));
    expect(live.refused).toBeGreaterThan(0);
    expect(live.record.actions).toHaveLength(plan.length);

    const replayed = replayRecord(live.record);

    expect(fingerprint(replayed)).toEqual(fingerprint(live.sim));
    expect(resultOf(replayed)).toEqual(live.record.result);
    // 手を打たなかった試合とは別の盤面になっている（手が効いていない試合では、この検査に意味がない）
    const withoutMoves = replayRecord({ ...live.record, actions: [] });
    expect(withoutMoves.agents).not.toEqual(live.sim.agents);
  });

  for (const mode of MODES) {
    it(`${mode} モードでも、遊んだ試合を記録から一致させて再生できる`, () => {
      const plan: RecordedAction[] = [
        { s: 60, tool: 'isolation', x: 321.987654321, y: 210.123456789 },
        { s: 240, tool: 'vaccine', x: 600.5, y: 300.25 },
        { s: 360, tool: 'lockdown' },
        { s: 361, tool: 'vaccine', x: 700.75, y: 420.5 },
      ];
      const live = playLikeUi(mode, 777, planned(plan));
      // 最後の手まで届いた試合でなければ、確かめたいことを確かめられない
      expect(live.record.actions).toHaveLength(plan.length);

      const replayed = replayRecord(live.record);

      expect(fingerprint(replayed)).toEqual(fingerprint(live.sim));
      expect(resultOf(replayed)).toEqual(live.record.result);
    });
  }

  it('打ち続けた長い試合（決着まで、断られる手が多い）でも、どのモードでも一致する', () => {
    for (const mode of MODES) {
      for (const seed of [11, 12, 13]) {
        const live = playLikeUi(mode, seed, habit);
        const replayed = replayRecord(live.record);
        expect(fingerprint(replayed), `${mode} シード ${seed}`).toEqual(fingerprint(live.sim));
      }
    }
  });

  it('JSON に直して戻した記録でも、同じ結果に再生できる', () => {
    const live = playLikeUi('epidemic', 31415, (sim, count) => {
      const moves = habit(sim, count);
      // 割り切れない座標にして、JSON を往復しても倍精度の値が変わらないことも確かめる
      if (count === 90) moves.push({ s: count, tool: 'isolation', x: Math.PI * 100, y: Math.E * 100 });
      return moves;
    });
    const restored = JSON.parse(JSON.stringify(live.record)) as MatchRecord;

    expect(restored).toEqual(live.record);
    const replayed = replayRecord(restored);
    expect(fingerprint(replayed)).toEqual(fingerprint(live.sim));
    expect(resultOf(replayed)).toEqual(live.record.result);
  });

  it('手は step の前に、記録された順に適用される。s は step が終わった回数である', () => {
    const record: MatchRecord = {
      v: 1,
      build: 'test',
      mode: 'epidemic',
      seed: 7,
      world: { w: world.w, h: world.h },
      population,
      actions: [
        { s: 0, tool: 'vaccine', x: 500.5, y: 300.25 },
        { s: 90, tool: 'isolation', x: 412.3456789012345, y: 250.7654321098765 },
        { s: 90, tool: 'lockdown' },
      ],
    };
    const steps: number[] = [];
    const seen = new Map<number, { vaccine: number; isolation: number; lockdown: number; time: number }>();
    const events: string[] = [];
    let firstZone: { x: number; y: number; life: number } | undefined;

    replayRecord(
      record,
      (sim, i) => {
        steps.push(i);
        seen.set(i, { ...sim.actions, time: sim.time });
        if (i === 90) firstZone = { x: sim.zones[0].x, y: sim.zones[0].y, life: sim.zones[0].life };
      },
      {
        beforeAction: (_sim, action, index) => events.push(`前 ${index} ${action.tool}`),
        afterAction: (_sim, action, index, accepted) => events.push(`後 ${index} ${action.tool} ${accepted}`),
      },
    );

    // i は 0 から1つずつ増え、最初の呼び出しはまだ1回も step が終わっていない
    expect(steps.slice(0, 3)).toEqual([0, 1, 2]);
    expect(seen.get(0)?.time).toBe(0);
    // s=0 の手は、最初の step の前に効いている
    expect(seen.get(0)).toMatchObject({ vaccine: 1, isolation: 0, lockdown: 0 });
    // s=90 の手は、89 回目までは無く、90 回 step が終わった直後（91 回目の step の前）に効いている
    expect(seen.get(89)).toMatchObject({ isolation: 0, lockdown: 0 });
    expect(seen.get(90)).toMatchObject({ isolation: 1, lockdown: 1 });
    // 置いたばかりの隔離は、まだ1刻みも老けていない。座標も丸められていない
    expect(firstZone).toEqual({ x: 412.3456789012345, y: 250.7654321098765, life: CONFIG.zoneLife });
    // 同じ刻みの手は、記録された順に前後を挟んで適用される
    expect(events).toEqual([
      '前 0 vaccine',
      '後 0 vaccine true',
      '前 1 isolation',
      '後 1 isolation true',
      '前 2 lockdown',
      '後 2 lockdown true',
    ]);
  });

  it('エンジンに断られた手も、記録どおりに再生され、断られたことが分かる', () => {
    // 開始直後に6連打する。最初のポイント（110）では4回しか払えないので、あとの手は必ず断られる
    const burst: RecordedAction[] = [10, 11, 12, 13, 14, 15].map((s) => ({
      s,
      tool: 'vaccine',
      x: 400 + s,
      y: 300,
    }));
    const live = playLikeUi('epidemic', 99, planned(burst));
    expect(live.refused).toBeGreaterThan(0);
    expect(live.record.actions).toHaveLength(burst.length);

    let refusedAtReplay = 0;
    let applied = 0;
    replayRecord(live.record, undefined, {
      afterAction: (_sim, _action, _index, accepted) => {
        applied += 1;
        if (!accepted) refusedAtReplay += 1;
      },
    });

    expect(applied).toBe(live.record.actions.length);
    expect(refusedAtReplay).toBe(live.refused);
  });

  it('決着がついたらそこで再生を止め、その後の手は適用しない', () => {
    // 2人とも最初から感染している盤面は、最初の step で手に負えなくなる（調整の値に左右されない）
    const record: MatchRecord = {
      v: 1,
      build: 'test',
      mode: 'epidemic',
      seed: 5,
      world: { w: world.w, h: world.h },
      population: 2,
      actions: [
        { s: 0, tool: 'lockdown' },
        { s: 5, tool: 'lockdown' },
      ],
    };
    const calls: number[] = [];
    let applied = 0;

    const replayed = replayRecord(record, (_sim, i) => calls.push(i), {
      afterAction: () => {
        applied += 1;
      },
    });

    expect(replayed.outcome).toBe('collapsed');
    expect(calls).toEqual([0]);
    // 決着の前に打った手だけが適用される
    expect(applied).toBe(1);
    expect(replayed.actions.lockdown).toBe(1);
  });

  it('制限時間ちょうどで終わる試合も、最後の刻みまで再生する（刻みの数え漏れがない）', () => {
    // 浮動小数の足し算のせいで、時間切れには ceil(制限時間 / 刻み) + 1 回の step が要る制限時間がある
    for (const seconds of [3, 5, 8, 12]) {
      withDuration(seconds, () => {
        const live = playLikeUi('epidemic', 8, planned([{ s: 30, tool: 'vaccine', x: 400, y: 300 }]));
        expect(live.sim.outcome, `${seconds}秒`).toBe('timeup');
        expect(live.steps).toBeLessThanOrEqual(Math.ceil(seconds / STEP) + 1);

        const replayed = replayRecord(live.record);

        expect(replayed.outcome, `${seconds}秒`).toBe('timeup');
        expect(fingerprint(replayed), `${seconds}秒`).toEqual(fingerprint(live.sim));
      });
    }
  });
});

describe('開始前のカウントダウン', () => {
  /** 固定の刻みで drift を決まった回数だけ回して作った、カウントダウン明けの盤面（記録を再生するときと同じ手順） */
  function boardAfterCountdown(seed: number): SimState {
    const sim = createSim(world, population, 'epidemic', seed);
    for (let i = 0; i < COUNTDOWN_STEPS; i += 1) drift(sim, STEP);
    return sim;
  }

  it('進む盤面は、フレームの長さ（フレームレート）に依らない', () => {
    const reference = fingerprint(boardAfterCountdown(4242));
    const sequences: Record<string, number[]> = {
      '60fps': new Array<number>(600).fill(1 / 60),
      '30fps': new Array<number>(600).fill(1 / 30),
      '144fps': new Array<number>(1000).fill(1 / 144),
      '20fps（頭打ちの手前）': new Array<number>(600).fill(0.05),
      '頭打ちいっぱい（0.25秒）': new Array<number>(200).fill(0.25),
      'ばらつく（4〜60ミリ秒）': jitteredFrames(2000, 0.004, 0.06),
    };

    for (const [label, frames] of Object.entries(sequences)) {
      const sim = createSim(world, population, 'epidemic', 4242);
      const progress = createCountdownProgress();
      let ready = false;
      for (const dt of frames) {
        if (advanceCountdown(sim, progress, dt)) {
          ready = true;
          break;
        }
      }
      expect(ready, label).toBe(true);
      expect(progress.done, label).toBe(COUNTDOWN_STEPS);
      expect(fingerprint(sim), label).toEqual(reference);
    }
  });

  it('1フレームに進める刻みには上限があり、終わったあとは何度呼んでも進まない', () => {
    const sim = createSim(world, population, 'epidemic', 1);
    const progress = createCountdownProgress();

    // 何秒ぶん渡されても、1回の呼び出しで進むのは上限まで。残りは次のフレームに回る
    expect(advanceCountdown(sim, progress, 10)).toBe(false);
    expect(progress.done).toBe(MAX_STEPS_PER_FRAME);

    let calls = 0;
    while (!advanceCountdown(sim, progress, 10)) calls += 1;
    expect(progress.done).toBe(COUNTDOWN_STEPS);
    expect(calls).toBeGreaterThan(0);

    const settled = structuredClone(sim.agents);
    expect(advanceCountdown(sim, progress, 10)).toBe(true);
    expect(progress.done).toBe(COUNTDOWN_STEPS);
    expect(sim.agents).toEqual(settled);
  });

  it('刻みの数は、カウントダウンの秒数をちょうど刻みで割った数である（数字と実際に進む盤面がずれない）', () => {
    expect(Number.isInteger(COUNTDOWN_STEPS)).toBe(true);
    expect(COUNTDOWN_STEPS * STEP).toBeCloseTo(CONFIG.countdown, 9);
  });

  it('画面に出す数字は、開始直後が CONFIG.countdown で、1つずつ減り、最後の刻みが終わったときにだけ 0（START）になる', () => {
    const shown = Array.from({ length: COUNTDOWN_STEPS + 1 }, (_, done) => countdownDisplay(done));

    expect(shown[0]).toBe(CONFIG.countdown);
    expect(shown[COUNTDOWN_STEPS]).toBe(0);
    expect(shown.indexOf(0)).toBe(COUNTDOWN_STEPS);
    // 3 → 2 → 1 → 0 のように、飛ばさず戻らず減る
    for (let i = 1; i < shown.length; i += 1) {
      expect(shown[i - 1] - shown[i]).toBeGreaterThanOrEqual(0);
      expect(shown[i - 1] - shown[i]).toBeLessThanOrEqual(1);
    }
    expect(new Set(shown).size).toBe(CONFIG.countdown + 1);
  });
});

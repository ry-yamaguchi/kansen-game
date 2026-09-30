/**
 * 試合の記録と、その厳密な再生。
 *
 * 同じシード＋同じ操作列なら同じ結果になる（掟2）ことを、実際に遊んだ試合の再現に使う。
 * 再現に要る条件は2つある。
 *
 * 1. 開始前のカウントダウンで盤面を進める刻みが、フレームの長さに依らず固定であること。
 *    drift は乱数を消費するので、刻みが揺れると開始時の盤面が試合ごとに変わってしまう。
 * 2. 操作を「何刻み目に、どこへ」と記録しておくこと。
 *
 * ここは型と純粋な関数だけを置く。DOM・時計・標準の乱数は使わない（画面側も同じ関数を呼ぶ）。
 */
import { CONFIG } from './config';
import {
  buildResult,
  createSim,
  drift,
  placeIsolation,
  placeVaccine,
  step,
  triggerLockdown,
} from './engine';
import type { ModeId, SimState, World } from './types';

/** 固定タイムステップ（秒）。フレームレートが揺れても挙動を変えないため、盤面を進める刻みは常にこれである */
export const STEP = 1 / 60;

/** 開始前のカウントダウンで drift を回す回数。CONFIG.countdown（秒）を刻みの数に直したもの */
export const COUNTDOWN_STEPS = Math.round(CONFIG.countdown / STEP);

/** 1フレームに進めてよい刻みの上限。重い端末で1フレームが際限なく長引かないための歯止めである */
export const MAX_STEPS_PER_FRAME = 8;

/**
 * 記録された1手。
 * s は「その手を打った時点で step() が何回終わっていたか」（0 は最初の step の前）。
 * x, y はエンジンへ渡した世界座標そのもの（丸めない。JSON を往復しても倍精度の値は変わらない）。
 */
export type RecordedAction =
  | { s: number; tool: 'isolation' | 'vaccine'; x: number; y: number }
  | { s: number; tool: 'lockdown' };

/** 試合の結末。記録と再生の一致を確かめる物差しに使う */
export interface RecordedResult {
  outcome: string;
  score: number;
  survivedSeconds: number;
}

/** 1試合の記録。これと同じ版のエンジンがあれば、試合をそのまま再生できる */
export interface MatchRecord {
  v: 1;
  /** 公開版のコミット（開発中は 'dev'） */
  build: string;
  mode: ModeId;
  seed: number;
  world: World;
  /** createSim へ渡した最初の人数（流入で増えた分は含まない） */
  population: number;
  actions: RecordedAction[];
  /** 遊び終えたときの結末。途中の記録には付かない */
  result?: RecordedResult;
}

/** 画面の結果と同じ計算で、試合の結末を取り出す。画面と再生スクリプトが同じ値を出すための窓口 */
export function resultOf(sim: SimState): RecordedResult {
  const r = buildResult(sim);
  return { outcome: r.outcome, score: r.score, survivedSeconds: r.survivedSeconds };
}

/** 記録された1手を盤面へ適用する。エンジンが受け付けたかを返す（ポイント不足などで断られたら false） */
export function applyAction(sim: SimState, action: RecordedAction): boolean {
  switch (action.tool) {
    case 'isolation':
      return placeIsolation(sim, action.x, action.y);
    case 'vaccine':
      return placeVaccine(sim, action.x, action.y);
    case 'lockdown':
      return triggerLockdown(sim);
  }
}

/** 手の前後を覗くための窓口。再生の流れは変えない（盤面を書き換えないこと） */
export interface ReplayHooks {
  /** index 番目の手を適用する直前。手を打つ前の盤面を調べるのに使う */
  beforeAction?: (sim: SimState, action: RecordedAction, index: number) => void;
  /** index 番目の手を適用した直後。accepted はエンジンが受け付けたか */
  afterAction?: (sim: SimState, action: RecordedAction, index: number, accepted: boolean) => void;
}

/**
 * 記録を最初から再生する。
 * 開始前のカウントダウンで drift を COUNTDOWN_STEPS 回、そのあと 1 刻みずつ step を回す。
 * i 刻み目の前に、s が i の手を記録された順に適用する（i は step が終わった回数）。
 * onBeforeStep(sim, i) は、その刻みの手を適用したあと、step を呼ぶ直前に呼ぶ。
 * 決着がつくか、制限時間ぶんの刻みを回したら止める。
 */
export function replayRecord(
  record: MatchRecord,
  onBeforeStep?: (sim: SimState, i: number) => void,
  hooks?: ReplayHooks,
): SimState {
  const sim = createSim(record.world, record.population, record.mode, record.seed);
  for (let i = 0; i < COUNTDOWN_STEPS; i += 1) drift(sim, STEP);

  // 刻みごとの手を、記録の並びを保ったまま引けるようにしておく
  const byStep = new Map<number, { action: RecordedAction; index: number }[]>();
  record.actions.forEach((action, index) => {
    const list = byStep.get(action.s);
    if (list) list.push({ action, index });
    else byStep.set(action.s, [{ action, index }]);
  });

  const maxSteps = Math.ceil(CONFIG.duration / STEP) + 1;
  for (let i = 0; i < maxSteps; i += 1) {
    for (const { action, index } of byStep.get(i) ?? []) {
      hooks?.beforeAction?.(sim, action, index);
      const accepted = applyAction(sim, action);
      hooks?.afterAction?.(sim, action, index, accepted);
    }
    onBeforeStep?.(sim, i);
    step(sim, STEP);
    if (sim.outcome !== 'playing') break;
  }
  return sim;
}

/** カウントダウンの進み具合。画面側が持ち、フレームごとに advanceCountdown へ渡す */
export interface CountdownProgress {
  /** 実時間のうち、まだ刻みに換えていない分（秒） */
  acc: number;
  /** ここまでに進めた刻みの数。COUNTDOWN_STEPS に達したらカウントダウンは終わりである */
  done: number;
}

export function createCountdownProgress(): CountdownProgress {
  return { acc: 0, done: 0 };
}

/**
 * カウントダウンを、実時間 dt（秒）ぶんだけ進める。カウントダウンが終わったら true を返す。
 * 盤面を進める刻みは、フレームの長さに依らず常に STEP である。
 * 実時間の刻みで drift を呼ぶと、乱数の消費がフレームレートで変わり、開始時の盤面が再現できなくなる。
 */
export function advanceCountdown(sim: SimState, progress: CountdownProgress, dt: number): boolean {
  progress.acc += dt;
  let guard = 0;
  while (progress.acc >= STEP && progress.done < COUNTDOWN_STEPS && guard < MAX_STEPS_PER_FRAME) {
    drift(sim, STEP);
    progress.done += 1;
    progress.acc -= STEP;
    guard += 1;
  }
  return progress.done >= COUNTDOWN_STEPS;
}

/** 画面に出すカウントダウンの数字。3 → 2 → 1 → 0（0 は START）と減る */
export function countdownDisplay(done: number): number {
  return Math.max(0, Math.ceil((COUNTDOWN_STEPS - done) * STEP));
}

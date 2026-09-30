/**
 * 試合の記録を再生する調査用スクリプト（ヘッドレス実行）。
 *
 *   npm run replay -- path/to/record.json
 *   REPLAY_SET="zoneLife=12,pointRegen=3" npm run replay -- path/to/record.json
 *
 * 結果画面の「この試合の記録をコピー」で写した文字を、ファイルに貼って渡す。
 * 同じシード＋同じ手なら、遊んだ試合がそのまま再現される（掟2）。
 * 何をどこへ打ったかと、その前後の盤面を出すので、遊び方を調べるのに使える。
 * REPLAY_SET で CONFIG の数値を上書きすれば「同じ手を新しい設定で打ったら勝てたか」も試せる。
 *
 * ゲームの挙動（src/ 配下）には一切手を入れない。ここは調査専用である。
 */
import { CONFIG } from '../src/sim/config';
import { modeOf } from '../src/sim/modes';
import { STEP, replayRecord, resultOf } from '../src/sim/replay';
import type { MatchRecord, RecordedAction, RecordedResult } from '../src/sim/replay';
import type { ModeId, SimState } from '../src/sim/types';

// このスクリプトは --ignoreConfig で単体コンパイルしており、tsconfig 経由の Node 型を持たない。
// 引数と環境変数、記録のファイルを読むためだけの最小限の宣言
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
};
declare function require(id: 'fs'): { readFileSync(path: string, encoding: 'utf8'): string };
declare function require(id: 'path'): { resolve(...segments: string[]): string };

/** 使い方の間違い（ファイルや設定の指定ミス）。原因と直し方だけを出して終える */
class UsageError extends Error {}

const MODE_IDS: readonly ModeId[] = ['epidemic', 'rumor', 'anger', 'product'];
const OUTCOME_LABEL: Record<string, string> = {
  timeup: '時間切れまで持ちこたえた',
  collapsed: '崩壊',
  boom: 'ブーム到来',
  fizzle: '定着せず',
};
/** 様子を出す間隔（秒） */
const CHECKPOINT_SECONDS = 5;

/**
 * 調整の試し用: REPLAY_SET="zoneLife=12,pointRegen=3" のように CONFIG の数値を上書きして再生する。
 * ゲーム本体の値は変えない（このプロセスの中だけで効く）。scripts/balance.ts の BALANCE_SET と同じ書き方である。
 * 読み込み時に一度だけ使われる値（agentRadius から作る余白など）は、上書きしても一部にしか効かない。
 * 上書きしたかどうかを返す。
 */
function applyOverrides(): boolean {
  let overridden = false;
  for (const pair of (process.env.REPLAY_SET ?? '').split(',').filter(Boolean)) {
    const [key, raw] = pair.split('=');
    const value = Number(raw);
    const table = CONFIG as unknown as Record<string, unknown>;
    if (typeof table[key] !== 'number' || !Number.isFinite(value)) {
      throw new UsageError(`REPLAY_SET の ${pair} を解釈できない（数値の設定だけを上書きできる）`);
    }
    // 開始前の刻みの数（COUNTDOWN_STEPS）は読み込み時に決まる。記録の前提でもあるので変えさせない
    if (key === 'countdown') {
      throw new UsageError('REPLAY_SET の countdown は上書きできない（記録は、開始前の刻みの数が同じことを前提にしている）');
    }
    table[key] = value;
    overridden = true;
    console.log(`上書き: ${key} = ${value}`);
  }
  return overridden;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 読み込んだ JSON が記録の形をしているか確かめる。違えば、何がどう違うかを添えて止める */
function parseRecord(text: string): MatchRecord {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new UsageError('記録を JSON として読めない（コピーした文字が途中で切れていないか、ファイルを確かめる）');
  }
  const bad = (what: string): never => {
    throw new UsageError(`記録の形が違う: ${what}（結果画面の「この試合の記録をコピー」で写したものを、そのまま貼る）`);
  };
  if (!isObject(data)) return bad('全体がオブジェクトではない');
  if (data.v !== 1) return bad('v が 1 ではない。この版が読めるのは v=1 の記録だけである');
  if (typeof data.mode !== 'string' || !MODE_IDS.includes(data.mode as ModeId)) return bad('mode が不明');
  if (!isNumber(data.seed)) return bad('seed が数ではない');
  const world = data.world;
  if (!isObject(world) || !isNumber(world.w) || !isNumber(world.h)) return bad('world が { w, h } ではない');
  if (!isNumber(data.population) || !Number.isInteger(data.population) || data.population < 1) {
    return bad('population が1以上の整数ではない');
  }
  if (!Array.isArray(data.actions)) return bad('actions が配列ではない');
  data.actions.forEach((a: unknown, i: number) => {
    if (!isObject(a)) return bad(`actions[${i}] がオブジェクトではない`);
    if (!isNumber(a.s) || !Number.isInteger(a.s) || a.s < 0) return bad(`actions[${i}].s が0以上の整数ではない`);
    if (a.tool === 'lockdown') return;
    if (a.tool !== 'isolation' && a.tool !== 'vaccine') return bad(`actions[${i}].tool が不明`);
    if (!isNumber(a.x) || !isNumber(a.y)) return bad(`actions[${i}] の x, y が数ではない`);
  });
  const result = data.result;
  if (result !== undefined) {
    if (!isObject(result) || typeof result.outcome !== 'string' || !isNumber(result.score) || !isNumber(result.survivedSeconds)) {
      return bad('result が { outcome, score, survivedSeconds } ではない');
    }
  }
  return data as unknown as MatchRecord;
}

function loadRecord(): MatchRecord {
  const file = process.argv[2];
  if (!file) {
    throw new UsageError('記録のファイルを指定する。例: npm run replay -- path/to/record.json');
  }
  // npm run は作業ディレクトリをリポジトリの直下に変えるので、打ち込んだ場所（INIT_CWD）から相対で探す
  const path = require('path').resolve(process.env.INIT_CWD ?? '', file);
  let text: string;
  try {
    text = require('fs').readFileSync(path, 'utf8');
  } catch {
    throw new UsageError(`記録のファイルを読めない: ${path}（パスを確かめる）`);
  }
  return parseRecord(text);
}

function seconds(steps: number): string {
  return (steps * STEP).toFixed(1).padStart(5);
}

function main(): void {
  const overridden = applyOverrides();
  const record = loadRecord();
  const def = modeOf(record.mode);
  const words = def.states;

  const toolName = (action: RecordedAction): string => `${def.tools[action.tool].label}[${action.tool}]`;
  const whereOf = (action: RecordedAction): string =>
    action.tool === 'lockdown' ? '(全体)' : `(${action.x.toFixed(1)}, ${action.y.toFixed(1)})`;

  /** 手を打つ直前の、その周りの様子。ワクチンは範囲内の未感染と感染、隔離は範囲内の感染と全体、ロックダウンは感染の総数 */
  const around = (sim: SimState, action: RecordedAction): string => {
    if (action.tool === 'lockdown') return `いま${words.infected} ${sim.infected} 人`;
    const radius = action.tool === 'vaccine' ? CONFIG.vaccineRadius : CONFIG.zoneRadius;
    let susceptible = 0;
    let infected = 0;
    let total = 0;
    for (const a of sim.agents) {
      if (Math.hypot(a.x - action.x, a.y - action.y) > radius) continue;
      total += 1;
      if (a.state === 'susceptible') susceptible += 1;
      else if (a.state === 'infected') infected += 1;
    }
    return action.tool === 'vaccine'
      ? `範囲内 ${words.susceptible} ${susceptible} 人・${words.infected} ${infected} 人`
      : `範囲内 ${words.infected} ${infected} 人・全体 ${total} 人`;
  };

  const stateOf = (sim: SimState): string =>
    `${words.infected} ${sim.infected}  ${words.susceptible} ${sim.susceptible}  ${words.recovered} ${sim.recovered}  ` +
    `${def.socialLabel} ${sim.social.toFixed(0)}  ポイント ${sim.points.toFixed(1)}  閉め出し ${sim.displaced}`;

  const timeline: string[] = [];
  const reached = new Set<number>();
  const checkpoints: string[] = [];
  const everySteps = Math.round(CHECKPOINT_SECONDS / STEP);
  let before = { text: '', points: 0 };

  const sim = replayRecord(
    record,
    // その刻みの手を打ったあと、step を呼ぶ直前の様子
    (now, i) => {
      if (i % everySteps === 0) checkpoints.push(`${seconds(i)}秒  ${stateOf(now)}`);
    },
    {
      beforeAction(now, action) {
        before = { text: around(now, action), points: now.points };
      },
      afterAction(_now, action, index, accepted) {
        reached.add(index);
        const note = accepted ? '' : '  ※実行されず（ポイント不足・待ち時間・置ける数の上限のどれか）';
        timeline.push(
          `${seconds(action.s)}秒  s=${action.s}  ${toolName(action)}  ${whereOf(action)}  ` +
            `${before.text}  ポイント ${before.points.toFixed(1)}${note}`,
        );
      },
    },
  );
  // 最後の刻みが終わった直後。周期の行と時刻が重なっても区別できるよう、小数第2位まで出す
  checkpoints.push(`${sim.time.toFixed(2).padStart(6)}秒  ${stateOf(sim)}  （終了）`);
  // 試合がその手より前に終わったときは、打てなかった手を残しておく（新しい設定で早く終わった場合など）
  record.actions.forEach((action, index) => {
    if (reached.has(index)) return;
    timeline.push(
      `${seconds(action.s)}秒  s=${action.s}  ${toolName(action)}  ${whereOf(action)}  ※この手の前に試合が終わりました`,
    );
  });

  console.log('=== 試合の再生 ===');
  console.log(
    `モード: ${def.label}（${record.mode}）  シード: ${record.seed}  ビルド: ${record.build}  手数: ${record.actions.length}`,
  );
  console.log(`盤面: ${record.world.w}×${record.world.h}  最初の人数: ${record.population}`);

  console.log('');
  console.log('--- 手の一覧（時刻は遊び始めからの秒数。周りの様子と持ち点は、打つ直前のもの） ---');
  if (timeline.length === 0) console.log('手は打たれていません');
  for (const line of timeline) console.log(line);

  console.log('');
  console.log(`--- ${CHECKPOINT_SECONDS}秒ごとの様子（その時刻に打った手は含む） ---`);
  for (const line of checkpoints) console.log(line);

  console.log('');
  console.log('--- 結果 ---');
  const replayed = resultOf(sim);
  console.log(
    `結果: ${OUTCOME_LABEL[replayed.outcome] ?? replayed.outcome}（${replayed.outcome}）  ` +
      `スコア ${replayed.score}  生存 ${replayed.survivedSeconds} 秒`,
  );
  const saved: RecordedResult | undefined = record.result;
  if (!saved) {
    console.log('（記録に結果が付いていないので、照合はしません）');
    return;
  }
  const show = (r: RecordedResult): string =>
    `outcome=${r.outcome}, score=${r.score}, survivedSeconds=${r.survivedSeconds}`;
  if (
    saved.outcome === replayed.outcome &&
    saved.score === replayed.score &&
    saved.survivedSeconds === replayed.survivedSeconds
  ) {
    console.log(`記録と一致（${show(replayed)}）`);
  } else {
    console.log(`記録と不一致  記録: ${show(saved)}  再生: ${show(replayed)}`);
    if (overridden) console.log('（REPLAY_SET で設定を変えているので、記録と違うのは当然である）');
  }
}

try {
  main();
} catch (e) {
  // 使い方の間違いは、原因と直し方だけを出す。それ以外（不具合）は、追えるよう元のまま投げ直す
  if (!(e instanceof UsageError)) throw e;
  console.error(e.message);
  process.exitCode = 1;
}

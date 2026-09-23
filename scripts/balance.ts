/**
 * バランス確認用の一時スクリプト（ヘッドレス実行）。
 * 「放置すると負ける」「介入すると効く」が成立しているかに加え、
 * 「どのツールがどの状況で効くのか」を数字で確認する。
 *
 * ゲームの挙動（src/ 配下）には一切手を入れない。ここは計測専用である。
 */
import { CONFIG, planWorld } from '../src/sim/config';
import { buildResult, createSim, placeIsolation, placeVaccine, step, triggerLockdown } from '../src/sim/engine';
import type { ModeId, SimState, ToolId } from '../src/sim/types';

const DT = 1 / 60;

type Strategy =
  | 'none'
  | 'greedy'
  | 'smart'
  | 'isolation-only'
  | 'vaccine-only'
  | 'lockdown-only'
  | 'isolation-spam'
  | 'mixed-spam';

interface Trial {
  protection: number;
  social: number;
  peak: number;
  finalInfected: number;
  score: number;
  acts: number;
  actIsolation: number;
  actVaccine: number;
  actLockdown: number;
  spent: number;
  leftover: number;
  population: number;
  collapsed: boolean;
  survived: number;
}

/**
 * 1試合をヘッドレスで実行する。
 * actIntervalSec が行動の頻度（何秒に1回 act() を呼ぶか）。これを引数にすることで
 * 「手数を増やせば強いのか」を測れるようにしている。
 */
function runGame(strategy: Strategy, mode: ModeId, seed: number, actIntervalSec: number): Trial {
  const { world, population } = planWorld(1280, 720);
  const sim = createSim(world, population, mode, seed);
  const steps = Math.ceil(CONFIG.duration / DT);
  const actEverySteps = Math.max(1, Math.round(actIntervalSec / DT));
  let actIndex = 0;
  for (let i = 0; i < steps; i += 1) {
    if (i % actEverySteps === 0) {
      act(sim, strategy, actIndex);
      actIndex += 1;
    }
    step(sim, DT);
    // 打ち切りに達したらそこで終わる
    if (sim.outcome !== 'playing') break;
  }
  const r = buildResult(sim);
  return {
    protection: r.protectionRatio,
    social: r.avgSocial,
    peak: r.peakInfected,
    finalInfected: r.finalInfected,
    score: r.score,
    acts: r.actions.isolation + r.actions.vaccine + r.actions.lockdown,
    actIsolation: r.actions.isolation,
    actVaccine: r.actions.vaccine,
    actLockdown: r.actions.lockdown,
    spent: r.pointsSpent,
    leftover: r.pointsLeft,
    population: r.population,
    collapsed: r.outcome === 'collapsed',
    survived: r.survivedSeconds,
  };
}

/** 感染者が最も密集している中心を探す */
function hotspot(sim: SimState, radius: number) {
  let best = { x: 0, y: 0, infected: 0, healthy: 0 };
  for (const a of sim.agents) {
    if (a.state !== 'infected') continue;
    let inf = 0;
    let heal = 0;
    for (const b of sim.agents) {
      if (Math.hypot(a.x - b.x, a.y - b.y) > radius) continue;
      if (b.state === 'infected') inf += 1;
      else if (b.state === 'susceptible') heal += 1;
    }
    if (inf > best.infected) best = { x: a.x, y: a.y, infected: inf, healthy: heal };
  }
  return best;
}

/**
 * 「隔離連打」が機械的に巡回する位置（盤面を5分割した目安点、比率で指定）。
 * 中心と四隅を順番に回るだけで、感染がどこにあるかは一切見ない。
 */
const SPAM_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0.22, 0.22],
  [0.78, 0.22],
  [0.22, 0.78],
  [0.78, 0.78],
];

function spamAnchor(sim: SimState, actIndex: number): { x: number; y: number } {
  const [rx, ry] = SPAM_ANCHORS[actIndex % SPAM_ANCHORS.length];
  return { x: sim.world.w * rx, y: sim.world.h * ry };
}

function act(sim: SimState, strategy: Strategy, actIndex: number): void {
  if (strategy === 'none') return;

  // 「隔離連打」は感染者の場所を一切見ない。所構わず、盤面を機械的に巡回しながら置き続ける。
  // isolation-only との対比はここにある: 狙うか、狙わないか。
  // 他の戦略と違い、下の「感染者が0なら何もしない」より前に置くのも直しどころである
  // （感染者がいなくても置き続けるのが「所構わず」の意味であり、後ろに置くと動かなくなる）。
  if (strategy === 'isolation-spam') {
    const p = spamAnchor(sim, actIndex);
    placeIsolation(sim, p.x, p.y);
    return;
  }

  if (sim.infected === 0) return;

  if (strategy === 'lockdown-only') {
    triggerLockdown(sim);
    return;
  }
  if (strategy === 'isolation-only') {
    // 「隔離連打」と対になる戦略。感染者のいる所だけを狙う
    const h = hotspot(sim, CONFIG.zoneRadius);
    if (h.infected > 0) placeIsolation(sim, h.x, h.y);
    return;
  }
  if (strategy === 'vaccine-only') {
    const h = hotspot(sim, CONFIG.vaccineRadius);
    if (h.infected > 0) placeVaccine(sim, h.x, h.y);
    return;
  }
  if (strategy === 'mixed-spam') {
    mixedSpamAct(sim, actIndex);
    return;
  }
  if (strategy === 'smart') {
    smartAct(sim);
    return;
  }
  greedyAct(sim);
}

const MIXED_ORDER: ToolId[] = ['isolation', 'vaccine', 'lockdown'];

/** 3つのツールを順番に使うだけの無思考な連打。状況の良し悪しは見ない */
function mixedSpamAct(sim: SimState, actIndex: number): void {
  const tool = MIXED_ORDER[actIndex % MIXED_ORDER.length];
  if (tool === 'isolation') {
    const h = hotspot(sim, CONFIG.zoneRadius);
    if (h.infected > 0) placeIsolation(sim, h.x, h.y);
  } else if (tool === 'vaccine') {
    const h = hotspot(sim, CONFIG.vaccineRadius);
    if (h.infected > 0) placeVaccine(sim, h.x, h.y);
  } else {
    triggerLockdown(sim);
  }
}

/** 状況に応じて手を選ぶ簡易AI */
function greedyAct(sim: SimState): void {
  const ratio = sim.infected / sim.agents.length;
  // 波が来ているあいだはロックダウンで頭を押さえる。
  // ただし社会活動度が落ちているときは打たない
  if (ratio > 0.18 && sim.lockdownCooldown === 0 && sim.social > 55) {
    if (triggerLockdown(sim)) return;
  }
  const best = hotspot(sim, CONFIG.zoneRadius);
  if (best.infected === 0) return;
  // 感染者が固まっているなら隔離、健康な人のほうが多いならワクチン
  if (best.infected >= 3 && best.infected >= best.healthy) {
    if (placeIsolation(sim, best.x, best.y)) return;
  }
  placeVaccine(sim, best.x, best.y);
}

/**
 * greedy よりも本気で状況を見るAI。
 * 感染者の密集度・未感染者の残り・社会活動の残量・ロックダウンのクールダウン・
 * 残りポイント・残り時間の6つを見て手を選ぶ。
 * 社会活動を削る隔離とロックダウンは、本当に効く場面（密集していて、まだ守る価値のある
 * 未感染者が残っていて、社会活動にまだ余裕がある場面）でだけ打つ。それ以外は既定でワクチンを使う。
 */
function smartAct(sim: SimState): void {
  const pop = Math.max(1, sim.agents.length);
  const ratio = sim.infected / pop;
  const susceptibleRatio = sim.susceptible / pop;
  // 残り時間が少ないと、社会活動を削っても取り戻す時間が無い。終盤は温存する
  const nearEnd = sim.timeLeft < 10;

  // ロックダウン: 波が来ていて・クールダウンが明けていて・社会活動に余裕があり・
  // 終盤ではなく・打った後もワクチンに回すポイントが残るときだけ
  if (
    !nearEnd &&
    ratio > 0.2 &&
    sim.lockdownCooldown === 0 &&
    sim.social > 60 &&
    sim.points >= CONFIG.costs.lockdown + CONFIG.costs.vaccine
  ) {
    if (triggerLockdown(sim)) return;
  }

  // 隔離: 感染者が固まっていて（巻き込む健康な人が感染者数以下で）、
  // まだ守るべき未感染者が十分残っていて、社会活動にまだ余裕があるときだけ
  const zoneHot = hotspot(sim, CONFIG.zoneRadius);
  if (
    !nearEnd &&
    zoneHot.infected >= 4 &&
    zoneHot.infected >= zoneHot.healthy &&
    susceptibleRatio > 0.15 &&
    sim.social > 45 &&
    sim.points >= CONFIG.costs.isolation
  ) {
    if (placeIsolation(sim, zoneHot.x, zoneHot.y)) return;
  }

  // 既定はワクチン。社会活動を削らず、未感染者の保護と感染者の回復短縮の両方に効く
  const vaxHot = hotspot(sim, CONFIG.vaccineRadius);
  if (vaxHot.infected > 0 && sim.points >= CONFIG.costs.vaccine) {
    placeVaccine(sim, vaxHot.x, vaxHot.y);
  }
}

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * trials 回試行して1行にまとめて出す。
 * 戻り値は平均スコア。「放置」の結果を後続の呼び出しに渡すと、放置比（何倍になったか）を併記する。
 */
function report(
  label: string,
  trials: number,
  strategy: Strategy,
  mode: ModeId,
  actIntervalSec: number,
  baselineScore?: number,
): number {
  const out: Trial[] = [];
  // 試行ごとに固定シードを使うことで、balance の結果を再現可能にする
  for (let i = 0; i < trials; i += 1) out.push(runGame(strategy, mode, 1000 + i, actIntervalSec));

  const prot = avg(out.map((t) => t.protection));
  const social = avg(out.map((t) => t.social));
  const peak = avg(out.map((t) => t.peak));
  const collapsed = out.filter((t) => t.collapsed);
  const acts = avg(out.map((t) => t.acts));
  const actIso = avg(out.map((t) => t.actIsolation));
  const actVax = avg(out.map((t) => t.actVaccine));
  const actLd = avg(out.map((t) => t.actLockdown));
  const spent = avg(out.map((t) => t.spent));
  const leftover = avg(out.map((t) => t.leftover));
  const score = avg(out.map((t) => t.score));
  const ratioText = baselineScore === undefined ? '基準' : `${(score / baselineScore).toFixed(2)}倍`;

  console.log(
    `${label.padEnd(20)} 抑えた割合 ${(prot * 100).toFixed(1)}% | ` +
      `社会 ${(social * 100).toFixed(0)} | ` +
      `ピーク ${peak.toFixed(1)} | ` +
      `打ち切り ${collapsed.length}/${trials}` +
      (collapsed.length ? `(${avg(collapsed.map((t) => t.survived)).toFixed(0)}秒)` : '') +
      ` | 手数 ${acts.toFixed(1)}(隔離${actIso.toFixed(1)}/ワクチン${actVax.toFixed(1)}/LD${actLd.toFixed(1)}) | ` +
      `ポイント 消費${spent.toFixed(0)}・残${leftover.toFixed(0)} | ` +
      `スコア ${score.toFixed(0)} | ` +
      `放置比 ${ratioText}`,
  );
  return score;
}

const TRIALS = 20;
// 頻度の基準値。旧実装（30ステップに1回=0.5秒に1回）と揃え、過去の計測と比較できるようにする
const DEFAULT_FREQ = 0.5;
// 行動の頻度を比較する3水準（秒に1回）
const FREQUENCIES = [0.5, 1, 2];
const MODES: ModeId[] = ['epidemic', 'rumor', 'anger'];
const MODE_LABEL: Record<ModeId, string> = { epidemic: '感染症', rumor: '噂話', anger: '悪感情' };

const baselineScores = new Map<ModeId, number>();

function runModeReport(mode: ModeId): void {
  console.log(`=== ${MODE_LABEL[mode]}モード ===`);
  const baseline = report('放置', TRIALS, 'none', mode, DEFAULT_FREQ);
  baselineScores.set(mode, baseline);
  report('隔離のみ', TRIALS, 'isolation-only', mode, DEFAULT_FREQ, baseline);
  report('隔離連打', TRIALS, 'isolation-spam', mode, DEFAULT_FREQ, baseline);
  report('ワクチンのみ', TRIALS, 'vaccine-only', mode, DEFAULT_FREQ, baseline);
  report('LDのみ', TRIALS, 'lockdown-only', mode, DEFAULT_FREQ, baseline);
  report('混合連打', TRIALS, 'mixed-spam', mode, DEFAULT_FREQ, baseline);
  report('簡易AI', TRIALS, 'greedy', mode, DEFAULT_FREQ, baseline);
  report('本気AI', TRIALS, 'smart', mode, DEFAULT_FREQ, baseline);
}

console.log('感染るラボ バランス計測（シード固定・再現可能）。放置比はスコアの倍率である。');
for (const mode of MODES) runModeReport(mode);

console.log('=== 行動の頻度を変えると強くなるか（0.5秒/1秒/2秒に1回） ===');
for (const mode of MODES) {
  const baseline = baselineScores.get(mode);
  for (const freq of FREQUENCIES) {
    report(`${MODE_LABEL[mode]}・簡易AI ${freq}秒`, TRIALS, 'greedy', mode, freq, baseline);
  }
  for (const freq of FREQUENCIES) {
    report(`${MODE_LABEL[mode]}・本気AI ${freq}秒`, TRIALS, 'smart', mode, freq, baseline);
  }
}

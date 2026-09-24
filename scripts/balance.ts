/**
 * バランス確認用の一時スクリプト（ヘッドレス実行）。
 * 「放置すると負ける」「介入すると効く」が成立しているかに加え、
 * 「どのツールがどの状況で効くのか」を数字で確認する。
 *
 * ゲームの挙動（src/ 配下）には一切手を入れない。ここは計測専用である。
 */
import { CONFIG, planWorld } from '../src/sim/config';
import { buildResult, createSim, placeIsolation, placeVaccine, step, triggerLockdown } from '../src/sim/engine';
import { modeOf } from '../src/sim/modes';
import type { ModeId, SimState, ToolId } from '../src/sim/types';

// このスクリプトは --ignoreConfig で単体コンパイルしており、tsconfig 経由の Node 型を持たない。
// BALANCE_TRIALS 環境変数を読むためだけの最小限の宣言
declare const process: { env: Record<string, string | undefined> };

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
/** 盤面を決める画面の大きさ。planWorld はこれで人数と縦横比を決める */
interface Screen {
  w: number;
  h: number;
}
const PC: Screen = { w: 1280, h: 720 };
// スマートフォン縦持ちの盤面。人数と広さは PC と同じで、縦横比だけが違う
const PHONE: Screen = { w: 375, h: 560 };

function runGame(
  strategy: Strategy,
  mode: ModeId,
  seed: number,
  actIntervalSec: number,
  screen: Screen = PC,
): Trial {
  const { world, population } = planWorld(screen.w, screen.h);
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
  screen: Screen = PC,
): number {
  const out: Trial[] = [];
  // 試行ごとに固定シードを使うことで、balance の結果を再現可能にする
  for (let i = 0; i < trials; i += 1) {
    out.push(runGame(strategy, mode, 1000 + i, actIntervalSec, screen));
  }

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

// 既定は20試合。環境変数 BALANCE_TRIALS で上書きできる（例: 崩壊率の最終確認は100試合で取る）
const envTrials = Number(process.env.BALANCE_TRIALS);
const TRIALS = Number.isFinite(envTrials) && envTrials > 0 ? Math.floor(envTrials) : 20;
// 頻度の基準値。旧実装（30ステップに1回=0.5秒に1回）と揃え、過去の計測と比較できるようにする
const DEFAULT_FREQ = 0.5;
// 行動の頻度を比較する3水準（秒に1回）
const FREQUENCIES = [0.5, 1, 2];
const MODES: ModeId[] = ['epidemic', 'rumor', 'anger'];
const MODE_LABEL: Record<ModeId, string> = {
  epidemic: '感染症',
  rumor: '噂話',
  anger: '悪感情',
  product: '新商品',
};

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

// BALANCE_ONLY=product のときは、新商品の節だけを回す（100試合の確認を速くするため）。既定は全部回す
const ONLY = process.env.BALANCE_ONLY;
if (ONLY !== 'product') {
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

  // 人間は0.5秒ごとに最善手を打てない。画面を見て、狙って、指を動かすまでに数秒かかる。
  // ここが崩れていると、数字の上では勝てても人間には理不尽なゲームになる
  const HUMAN_INTERVALS = [3, 5];
  console.log('=== 人間に近い反応の遅さ（3秒/5秒に1回） ===');
  for (const mode of MODES) {
    const baseline = baselineScores.get(mode);
    for (const freq of HUMAN_INTERVALS) {
      report(`${MODE_LABEL[mode]}・本気AI ${freq}秒`, TRIALS, 'smart', mode, freq, baseline);
    }
    for (const freq of HUMAN_INTERVALS) {
      report(`${MODE_LABEL[mode]}・簡易AI ${freq}秒`, TRIALS, 'greedy', mode, freq, baseline);
    }
  }

  // スマートフォンは盤面が縦長。画面の形で別のゲームになっていないかを見張る
  console.log('=== スマートフォン（縦長） ===');
  for (const mode of MODES) {
    const baseline = report(`${MODE_LABEL[mode]}・放置`, TRIALS, 'none', mode, DEFAULT_FREQ, undefined, PHONE);
    report(`${MODE_LABEL[mode]}・本気AI 0.5秒`, TRIALS, 'smart', mode, DEFAULT_FREQ, baseline, PHONE);
    report(`${MODE_LABEL[mode]}・本気AI 3秒`, TRIALS, 'smart', mode, 3, baseline, PHONE);
    report(`${MODE_LABEL[mode]}・簡易AI 3秒`, TRIALS, 'greedy', mode, 3, baseline, PHONE);
  }
}

// ============================================================================
// エクストラステージ「新商品」（広める側）。上の3モードとは勝ち負けが逆なので、集計も別に持つ。
// 上の出力には一切影響しない（ここで新しく足す節である）
// ============================================================================

type ProductStrategy = 'p-none' | 'p-sample' | 'p-ads' | 'p-smart' | 'p-sample-event' | 'p-sample-influencer';

interface ProductTrial {
  outcome: string;
  reach: number;
  social: number;
  score: number;
  acts: number;
}

/** 未体験の人が半径内に最も多くいる点。adoptersNear を指定すると、愛用者が近くにいる所に限る */
function susceptibleHotspot(sim: SimState, radius: number, adoptersNear = 0) {
  let best = { x: 0, y: 0, n: 0 };
  for (const a of sim.agents) {
    if (a.state !== 'susceptible') continue;
    let n = 0;
    let adopters = 0;
    for (const b of sim.agents) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (b.state === 'susceptible' && d <= radius) n += 1;
      if (adoptersNear > 0 && b.state === 'infected' && d <= adoptersNear) adopters += 1;
    }
    if (adoptersNear > 0 && adopters === 0) continue;
    if (n > best.n) best = { x: a.x, y: a.y, n };
  }
  return best;
}

/**
 * 広める側の「考えた打ち方」。人間が画面を見て真似できる判断だけを使う:
 * インフルエンサーがまだ試していなければ、まず本人に試供品を渡す。
 * 昼で広場に人が集まっていれば、広場でイベントを開く。
 * 好感度に余裕があり、あと少しでブームのときだけ広告を打つ。
 * それ以外は、未体験の人が最も固まっている所に試供品を配る
 */
function productSmartAct(sim: SimState): void {
  const influencer = sim.agents.find((a) => a.trait === 'popular' && a.state === 'susceptible');
  if (influencer && placeVaccine(sim, influencer.x, influencer.y)) return;

  const def = modeOf('product');
  const boom = def.boomRatio ?? 0.6;
  const ratio = sim.infected / Math.max(1, sim.agents.length);
  if (sim.social / CONFIG.socialMax > 0.7 && ratio >= boom * 0.7 && sim.lockdownCooldown === 0) {
    if (triggerLockdown(sim)) return;
  }

  const p = sim.city.plaza;
  const inPlaza = sim.agents.filter(
    (a) => a.x >= p.x && a.x <= p.x + p.w && a.y >= p.y && a.y <= p.y + p.h,
  ).length;
  const eventActive = sim.zones.some((z) => z.kind === 'event');
  if (sim.period === 'noon' && inPlaza >= 5 && !eventActive) {
    if (placeIsolation(sim, p.x + p.w / 2, p.y + p.h / 2)) return;
  }

  // それ以外は、未体験の人が最も固まっている所に試供品を配る（配る場所の選び方は「試供品のみ」と同じ）
  const spot = susceptibleHotspot(sim, CONFIG.vaccineRadius);
  if (spot.n > 0) placeVaccine(sim, spot.x, spot.y);
}

function productAct(sim: SimState, strategy: ProductStrategy): void {
  if (strategy === 'p-none') return;
  if (strategy === 'p-ads') {
    triggerLockdown(sim);
    return;
  }
  if (strategy === 'p-sample') {
    const spot = susceptibleHotspot(sim, CONFIG.vaccineRadius);
    if (spot.n > 0) placeVaccine(sim, spot.x, spot.y);
    return;
  }
  // 切り分け用: 試供品＋昼の広場のイベントだけ
  if (strategy === 'p-sample-event') {
    const p = sim.city.plaza;
    const inPlaza = sim.agents.filter((a) => a.x >= p.x && a.x <= p.x + p.w && a.y >= p.y && a.y <= p.y + p.h).length;
    if (sim.period === 'noon' && inPlaza >= 5 && !sim.zones.some((z) => z.kind === 'event')) {
      if (placeIsolation(sim, p.x + p.w / 2, p.y + p.h / 2)) return;
    }
    const spot = susceptibleHotspot(sim, CONFIG.vaccineRadius);
    if (spot.n > 0) placeVaccine(sim, spot.x, spot.y);
    return;
  }
  // 切り分け用: 試供品＋インフルエンサーを先に狙うだけ
  if (strategy === 'p-sample-influencer') {
    const inf = sim.agents.find((a) => a.trait === 'popular' && a.state === 'susceptible');
    if (inf && placeVaccine(sim, inf.x, inf.y)) return;
    const spot = susceptibleHotspot(sim, CONFIG.vaccineRadius);
    if (spot.n > 0) placeVaccine(sim, spot.x, spot.y);
    return;
  }
  productSmartAct(sim);
}

function runProduct(strategy: ProductStrategy, seed: number, actIntervalSec: number, screen: Screen = PC): ProductTrial {
  const { world, population } = planWorld(screen.w, screen.h);
  const sim = createSim(world, population, 'product', seed);
  const steps = Math.ceil(CONFIG.duration / DT);
  const every = Math.max(1, Math.round(actIntervalSec / DT));
  for (let i = 0; i < steps; i += 1) {
    if (i % every === 0) productAct(sim, strategy);
    step(sim, DT);
    if (sim.outcome !== 'playing') break;
  }
  const r = buildResult(sim);
  return {
    outcome: r.outcome,
    reach: r.reachRatio,
    social: r.avgSocial,
    score: r.score,
    acts: r.actions.isolation + r.actions.vaccine + r.actions.lockdown,
  };
}

function reportProduct(
  label: string,
  strategy: ProductStrategy,
  actIntervalSec: number,
  baselineScore?: number,
  screen: Screen = PC,
): number {
  const out: ProductTrial[] = [];
  for (let i = 0; i < TRIALS; i += 1) out.push(runProduct(strategy, 1000 + i, actIntervalSec, screen));
  const boom = out.filter((t) => t.outcome === 'boom').length;
  const fizzle = out.filter((t) => t.outcome === 'fizzle').length;
  const score = avg(out.map((t) => t.score));
  const ratioText = baselineScore === undefined ? '基準' : `${(score / Math.max(1, baselineScore)).toFixed(2)}倍`;
  console.log(
    `${label.padEnd(20)} ブーム到来 ${boom}/${TRIALS} | 定着せず ${fizzle}/${TRIALS} | ` +
      `普及率 ${(avg(out.map((t) => t.reach)) * 100).toFixed(1)}% | 好感度 ${(avg(out.map((t) => t.social)) * 100).toFixed(0)} | ` +
      `手数 ${avg(out.map((t) => t.acts)).toFixed(1)} | スコア ${score.toFixed(0)} | 放置比 ${ratioText}`,
  );
  return score;
}

console.log('=== 新商品（エクストラ・広める側） ===');
{
  const base = reportProduct('放置', 'p-none', DEFAULT_FREQ);
  reportProduct('試供品のみ', 'p-sample', DEFAULT_FREQ, base);
  reportProduct('広告連打', 'p-ads', DEFAULT_FREQ, base);
  reportProduct('試供品＋イベント 3秒', 'p-sample-event', 3, base);
  reportProduct('試供品＋インフルエンサー 3秒', 'p-sample-influencer', 3, base);
  reportProduct('試供品のみ 3秒', 'p-sample', 3, base);
  reportProduct('本気AI 0.5秒', 'p-smart', DEFAULT_FREQ, base);
  reportProduct('本気AI 3秒', 'p-smart', 3, base);
  reportProduct('スマホ・本気AI 3秒', 'p-smart', 3, base, PHONE);
}

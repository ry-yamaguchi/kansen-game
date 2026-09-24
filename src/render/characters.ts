import { CONFIG } from '../sim/config';
import { modeOf } from '../sim/modes';
import type { Agent, ModeId } from '../sim/types';
import type { View } from './view';

/**
 * 画面内を動き回る人の見た目。
 *
 * 実際の描画半径は4〜7CSSピクセルしかない。この大きさでは描き込みは潰れるため、
 * 状態は色ではなく「シルエット」で分ける。
 *   未感染 …… 丸い。前方のふちだけ明るく、進む先が分かる
 *   伝播中 …… 棘のある星。前方の棘が長く、突き進んでいるように見える
 *   収束後 …… 中空の殻。後ろが開いており、その開口部が向きの手がかりになる
 * 丸・棘・穴の三種は白黒にしても区別できるため、色覚特性があっても読める。
 *
 * 本体は「状態 × 向き（DIR_STEPS段）」を1枚のスプライトシートに焼き、
 * 毎フレームは同じ画像からの drawImage だけで済ませる。
 * 130体いても塗りの指定は一度も起きず、テクスチャの切り替えも起きない。
 *
 * 伝播中の人の背後のグローもここに含めてある。draw.ts 側の同じ処理と
 * 二重になるため、差し替えるときは古い方を外すこと。
 */

const TAU = Math.PI * 2;

/** 向きの量子化段数。15度刻み。この大きさなら段差は見えない */
const DIR_STEPS = 24;

/** シートの行。状態と、状態のなかの段階を行として持つ */
const R_CALM_A = 0;
const R_CALM_B = 1;
const R_ALARMED = 2;
const R_ACTIVE = 3;
const R_ACTIVE_HOT = 4;
const R_SHELL = 5;
const R_SHELL_CRACKED = 6;
const ROW_COUNT = 7;

/** 半径の何倍まで絵が届くか。棘と縁取りを含めた余裕 */
const MAX_REACH = 2.05;
/** シートの1コマに足す余白（CSSピクセル） */
const CELL_PAD = 2;

/** この感染圧を超えたら、染まりかけの見た目に切り替える */
const ALARM_AT = CONFIG.exposureThreshold * 0.45;
/** 残り耐性がこの秒数を切ったら、殻が割れた見た目に切り替える */
const SHELL_WARN = 2.6;
/** 伝播力がこの倍率を超えたら、棘の鋭い見た目に切り替える */
const HOT_AT = 1.15;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function rgba(c: Rgb, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

function hexToRgb(hex: string): Rgb {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const GOLD: Rgb = { r: 250, g: 204, b: 21 };
/** 盤面の地の色。殻の空洞をここに落とし込む */
const VOID: Rgb = { r: 6, g: 10, b: 20 };

/** スプライトに焼く色。モードごとに一度だけ作る */
interface Ink {
  calm: string;
  calmLight: string;
  active: string;
  activeCore: string;
  activeHotCore: string;
  shell: string;
  shellFaded: string;
  /** 輪郭。重なった人どうしを切り分ける */
  edge: string;
  /** 殻の内側 */
  hollow: string;
  /** 染まりかけの縁 */
  warn: string;
}

function inkOf(mode: ModeId): Ink {
  const c = modeOf(mode).colors;
  const sus = hexToRgb(c.susceptible);
  const inf = hexToRgb(c.infected);
  const rec = hexToRgb(c.recovered);
  return {
    calm: rgba(sus, 0.96),
    calmLight: rgba(mix(sus, WHITE, 0.55), 0.95),
    active: rgba(inf, 1),
    activeCore: rgba(mix(inf, WHITE, 0.7), 0.95),
    activeHotCore: rgba(WHITE, 0.96),
    shell: rgba(rec, 0.95),
    // 耐性が薄れた殻は、未感染の色へ寄せておく。また広がりうることを色でも示す
    shellFaded: rgba(mix(rec, sus, 0.45), 0.9),
    edge: rgba({ r: 3, g: 6, b: 12 }, 0.7),
    hollow: rgba(VOID, 0.72),
    warn: rgba(inf, 0.9),
  };
}

/** 伝播中の人の棘の形。モードごとに「伝わり方」を形で言い分ける */
interface Spread {
  /** 棘の本数 */
  points: number;
  /** 棘の基準長（半径倍） */
  spike: number;
  /** 前方への偏り。大きいほど矢じりに近づく */
  bias: number;
  /** 谷の深さ（半径倍） */
  inner: number;
}

const SHAPES: Record<ModeId, Spread> = {
  // 接触でうつる。粒子らしい棘を四方に持たせる
  epidemic: { points: 7, spike: 1.34, bias: 0.5, inner: 0.56 },
  // 離れていても届く。細い光条を全方位へ伸ばす
  rumor: { points: 9, spike: 1.5, bias: 0.28, inner: 0.5 },
  // 速くまっすぐ突き進む。前方だけが長い矢じりにする
  anger: { points: 5, spike: 1.15, bias: 0.75, inner: 0.52 },
  // 新商品はまだ開始画面から選べない（区切りE3で見た目を作る）。ModeId を満たすための仮値
  product: { points: 7, spike: 1.34, bias: 0.5, inner: 0.56 },
};

/** 殻の弧。0が前方。後ろを開けておくと進行方向が分かる */
const SHELL_WHOLE: readonly number[] = [-2.16, 2.16];
/** 割れかけた殻。隙間から元の状態が戻ってくる */
const SHELL_CRACKED: readonly number[] = [-2.05, -1.05, -0.5, 0.5, 1.05, 2.05];

// --- 本体の形 ---------------------------------------------------------------

/** 丸い体。前方をわずかに尖らせ、明るいふちで向きを見せる */
function paintRound(
  g: CanvasRenderingContext2D,
  r: number,
  ink: Ink,
  body: number,
  nose: number,
  edge: string,
  edgeWidth: number,
): void {
  const br = r * body;
  const spread = 1;
  g.beginPath();
  g.moveTo(r * nose, 0);
  // 前方の切り欠きを残して背中側をぐるりと回り、鼻先へ閉じる
  g.arc(0, 0, br, -spread, spread, true);
  g.closePath();
  g.fillStyle = ink.calm;
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = edgeWidth;
  g.strokeStyle = edge;
  g.stroke();

  // 前方のふち。止まって見ても進行方向が読める
  g.beginPath();
  g.arc(br * 0.14, 0, br * 0.56, -1.1, 1.1);
  g.lineWidth = Math.max(1, r * 0.3);
  g.strokeStyle = ink.calmLight;
  g.stroke();
}

/** 棘のある体。前方の棘を長くして進行方向を示す */
function paintStar(
  g: CanvasRenderingContext2D,
  r: number,
  ink: Ink,
  s: Spread,
  hot: boolean,
): void {
  const spike = s.spike * (hot ? 1.05 : 1);
  const inner = r * s.inner * (hot ? 0.68 : 1);
  g.beginPath();
  for (let k = 0; k < s.points; k++) {
    const a1 = (k / s.points) * TAU;
    const a2 = ((k + 0.5) / s.points) * TAU;
    // 後方の棘が谷より短くなると形が裏返るため、下限を設ける
    const len = Math.max(inner * 1.3, r * (spike + s.bias * Math.cos(a1)));
    const x = Math.cos(a1) * len;
    const y = Math.sin(a1) * len;
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
    g.lineTo(Math.cos(a2) * inner, Math.sin(a2) * inner);
  }
  g.closePath();
  g.fillStyle = ink.active;
  g.fill();
  // 極小では尖った角が飛ぶため、継ぎ目は丸める
  g.lineJoin = 'round';
  g.lineWidth = Math.max(0.85, r * 0.2);
  g.strokeStyle = ink.edge;
  g.stroke();

  // 芯。伝播させている当人であることが密集地帯でも分かる
  g.beginPath();
  g.arc(0, 0, r * (hot ? 0.42 : 0.32), 0, TAU);
  g.fillStyle = hot ? ink.activeHotCore : ink.activeCore;
  g.fill();
}

/** 中空の殻。穴が空いていること自体が「もう広げない」印になる */
function paintShell(
  g: CanvasRenderingContext2D,
  r: number,
  ink: Ink,
  cracked: boolean,
): void {
  const mid = r * 0.78;
  const w = r * 0.5;
  const edge = Math.max(0.85, r * 0.2);

  // 内側を地の色まで落とし、背後のグローに透けても穴として読ませる
  g.beginPath();
  g.arc(0, 0, mid + w * 0.5, 0, TAU);
  g.fillStyle = ink.hollow;
  g.fill();

  // 隙間を残したいので端は切り落とす
  g.lineCap = 'butt';
  const segs = cracked ? SHELL_CRACKED : SHELL_WHOLE;
  for (let i = 0; i < segs.length; i += 2) {
    g.beginPath();
    g.arc(0, 0, mid, segs[i], segs[i + 1]);
    g.lineWidth = w + edge * 1.6;
    g.strokeStyle = ink.edge;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, mid, segs[i], segs[i + 1]);
    g.lineWidth = w;
    g.strokeStyle = cracked ? ink.shellFaded : ink.shell;
    g.stroke();
  }
}

function paintRow(
  g: CanvasRenderingContext2D,
  row: number,
  r: number,
  ink: Ink,
  s: Spread,
): void {
  const edge = Math.max(0.85, r * 0.2);
  switch (row) {
    case R_CALM_A:
      // 同じ状態でも大きさを少し変え、群れが判子の列に見えないようにする。
      // 個体ごとの割り当ては id で決めるため、拡大縮小を挟まずに済む
      paintRound(g, r, ink, 0.96, 1.18, ink.edge, edge);
      break;
    case R_CALM_B:
      paintRound(g, r, ink, 1.04, 1.3, ink.edge, edge);
      break;
    case R_ALARMED:
      // 外から染まりかけている。縁を伝播側の色で太くする
      paintRound(g, r, ink, 1, 1.24, ink.warn, edge * 1.7);
      break;
    case R_ACTIVE:
      paintStar(g, r, ink, s, false);
      break;
    case R_ACTIVE_HOT:
      paintStar(g, r, ink, s, true);
      break;
    case R_SHELL:
      paintShell(g, r, ink, false);
      break;
    default:
      paintShell(g, r, ink, true);
      break;
  }
}

// --- 特性の印 -----------------------------------------------------------------

/**
 * 特性持ちを重ねて示す小さな印。状態のシルエット（丸／星／殻）はそのまま残し、
 * 白に近い色で細く重ねる。人数はごく少数（既定4人）なので、毎フレーム直接パスを描いてよい。
 */

/** popular の頭上に置く小さな星 */
function drawTraitStar(g: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const spikes = 5;
  const inner = size * 0.42;
  g.beginPath();
  for (let k = 0; k < spikes * 2; k += 1) {
    const rad = k % 2 === 0 ? size : inner;
    const ang = (k / (spikes * 2)) * TAU - Math.PI / 2;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = 'rgba(250,252,255,0.95)';
  g.fill();
  g.lineWidth = Math.max(0.6, size * 0.2);
  g.strokeStyle = 'rgba(8,12,22,0.55)';
  g.stroke();
}

/** medic の頭上に置く小さな十字 */
function drawTraitCross(g: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx, cy - size);
  g.lineTo(cx, cy + size);
  g.moveTo(cx - size, cy);
  g.lineTo(cx + size, cy);
  // 濃い縁を太く描いてから、白を細く重ねる（縁取り文字と同じ考え方）
  g.lineWidth = Math.max(2, size * 0.62);
  g.strokeStyle = 'rgba(8,12,22,0.5)';
  g.stroke();
  g.lineWidth = Math.max(1, size * 0.34);
  g.strokeStyle = 'rgba(250,252,255,0.95)';
  g.stroke();
}

// --- スプライトシート -------------------------------------------------------

interface Sheet {
  canvas: HTMLCanvasElement;
  /** 1コマの一辺（シート内のピクセル） */
  cell: number;
  /** 1コマの一辺（CSSピクセル） */
  cellCss: number;
}

function buildSheet(mode: ModeId, r: number, ratio: number): Sheet | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  // 半コマがちょうど整数ピクセルになるようにし、転送時のにじみを防ぐ
  const cell = 2 * Math.ceil((r * MAX_REACH + CELL_PAD) * ratio);
  canvas.width = cell * DIR_STEPS;
  canvas.height = cell * ROW_COUNT;
  const g = canvas.getContext('2d');
  if (!g) return null;

  const ink = inkOf(mode);
  const s = SHAPES[mode];
  const half = cell / 2;
  for (let row = 0; row < ROW_COUNT; row++) {
    for (let col = 0; col < DIR_STEPS; col++) {
      // コマの中心を原点に、単位をCSSピクセルに戻してから向きぶん回す
      g.setTransform(ratio, 0, 0, ratio, col * cell + half, row * cell + half);
      g.rotate((col / DIR_STEPS) * TAU);
      paintRow(g, row, r, ink, s);
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, cell, cellCss: cell / ratio };
}

/**
 * ぼかした光を1枚だけ作って使い回す。
 * 人ごとに createRadialGradient や shadowBlur を呼ぶと、
 * 伝播中の人が増えたときにスマートフォンで目に見えて重くなる。
 */
function buildGlow(color: Rgb, size: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const half = size / 2;
  const grad = g.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, rgba(color, 0.55));
  grad.addColorStop(0.4, rgba(color, 0.22));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

// --- 透明度の段階表 ---------------------------------------------------------

/**
 * 付属演出の色は毎フレーム変わる。文字列を組み立てると人数ぶんのごみが出るため、
 * 段階ごとの文字列を先に作っておいて引くだけにする。
 */
const RAMP_STEPS = 12;

function makeRamp(c: Rgb): string[] {
  const out: string[] = [];
  for (let i = 0; i < RAMP_STEPS; i++) out.push(rgba(c, Math.round(((i + 1) / RAMP_STEPS) * 100) / 100));
  return out;
}

function pick(ramp: string[], alpha: number): string {
  let i = Math.round(alpha * RAMP_STEPS) - 1;
  if (i < 0) i = 0;
  else if (i >= RAMP_STEPS) i = RAMP_STEPS - 1;
  return ramp[i];
}

interface ModeRamps {
  warn: string[];
  back: string[];
  infectedRgb: Rgb;
}

// --- 本体 -------------------------------------------------------------------

export interface CharacterRenderer {
  drawAgents(
    ctx: CanvasRenderingContext2D,
    agents: Agent[],
    view: View,
    radius: number,
    mode: ModeId,
    /** 変異株などで伝播力が上がっているときの倍率。1が通常 */
    intensity: number,
  ): void;
}

/**
 * ctx には端末のピクセル比ぶんの拡大が掛かっている。
 * スプライトを実ピクセルと同じ細かさで焼くために、その倍率を読む。
 * 1倍の画面でも2倍で焼いておき、縮小して描くことで輪郭を保つ。
 */
function spriteRatioOf(ctx: CanvasRenderingContext2D): number {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const s = t ? Math.hypot(t.a, t.b) : 1;
  const safe = Number.isFinite(s) && s > 0 ? s : 1;
  return Math.min(3, Math.max(2, Math.round(safe * 2) / 2));
}

/** 端末のピクセル格子に乗る倍率。1倍の画面では丸めが動きのがたつきになるので揃えない */
function gridOf(ctx: CanvasRenderingContext2D): number {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const s = t ? Math.hypot(t.a, t.b) : 1;
  return Number.isFinite(s) && s >= 2 ? s : 0;
}

export function createCharacterRenderer(): CharacterRenderer {
  let sheet: Sheet | null = null;
  let sheetKey = '';
  const glowCache = new Map<ModeId, HTMLCanvasElement | null>();
  const rampCache = new Map<ModeId, ModeRamps>();
  const white = makeRamp(WHITE);
  const gold = makeRamp(GOLD);
  /** ワクチンの破線。毎フレーム配列を作らないように使い回す */
  const dash = [0, 0];

  function rampsOf(mode: ModeId): ModeRamps {
    const hit = rampCache.get(mode);
    if (hit) return hit;
    const c = modeOf(mode).colors;
    const made: ModeRamps = {
      warn: makeRamp(hexToRgb(c.infected)),
      back: makeRamp(hexToRgb(c.susceptible)),
      infectedRgb: hexToRgb(c.infected),
    };
    rampCache.set(mode, made);
    return made;
  }

  function glowOf(mode: ModeId): HTMLCanvasElement | null {
    if (!glowCache.has(mode)) {
      glowCache.set(mode, buildGlow(rampsOf(mode).infectedRgb, 96));
    }
    return glowCache.get(mode) ?? null;
  }

  /** 同じ状態でも段階ごとに行を分けてある。ここで人と行を突き合わせる */
  function rowOf(a: Agent, hot: boolean): number {
    if (a.state === 'infected') return hot ? R_ACTIVE_HOT : R_ACTIVE;
    if (a.state === 'recovered') {
      return a.immunity > 0 && a.immunity <= SHELL_WARN ? R_SHELL_CRACKED : R_SHELL;
    }
    if (a.exposure >= ALARM_AT) return R_ALARMED;
    return (a.id & 1) === 0 ? R_CALM_A : R_CALM_B;
  }

  /** スプライトが用意できない環境でも遊べるようにしておく */
  function drawPlain(
    ctx: CanvasRenderingContext2D,
    agents: Agent[],
    view: View,
    r: number,
    mode: ModeId,
  ): void {
    const c = modeOf(mode).colors;
    for (const a of agents) {
      ctx.fillStyle =
        a.state === 'infected' ? c.infected : a.state === 'recovered' ? c.recovered : c.susceptible;
      ctx.beginPath();
      ctx.arc(view.ox + a.x * view.scale, view.oy + a.y * view.scale, r, 0, TAU);
      ctx.fill();
    }
  }

  return {
    drawAgents(ctx, agents, view, radius, mode, intensity) {
      if (agents.length === 0) return;
      // 拡大率のわずかな変化でシートを焼き直さないよう、半径は0.25刻みに丸める
      const r = Math.max(2.2, Math.round(radius * 4) / 4);
      const ratio = spriteRatioOf(ctx);
      const key = `${mode}|${r}|${ratio}`;
      if (key !== sheetKey) {
        sheet = buildSheet(mode, r, ratio);
        sheetKey = key;
      }
      if (!sheet) {
        drawPlain(ctx, agents, view, r, mode);
        return;
      }

      const grid = gridOf(ctx);
      const ramps = rampsOf(mode);
      const heat = Math.min(2, Math.max(1, intensity));
      const hot = intensity >= HOT_AT;

      // 伝播中の人の光。背面にまとめて敷く。
      // 伝播力が上がっているあいだは大きく強くし、盤面を見ただけで異変が伝わるようにする
      const glow = glowOf(mode);
      if (glow) {
        const size = r * 7 * (1 + (heat - 1) * 0.75);
        const half = size / 2;
        ctx.save();
        ctx.globalAlpha = Math.min(1, 0.75 + (heat - 1) * 0.5);
        for (const a of agents) {
          if (a.state !== 'infected') continue;
          ctx.drawImage(
            glow,
            view.ox + a.x * view.scale - half,
            view.oy + a.y * view.scale - half,
            size,
            size,
          );
        }
        ctx.restore();
      }

      // 本体。塗りの指定を挟まず drawImage だけを並べる。
      // 伝播中の人を後に回し、密集しても手前に出るようにする
      const cell = sheet.cell;
      const css = sheet.cellCss;
      const half = css / 2;
      for (let pass = 0; pass < 2; pass++) {
        const wantActive = pass === 1;
        for (const a of agents) {
          if ((a.state === 'infected') !== wantActive) continue;
          let cx = view.ox + a.x * view.scale;
          let cy = view.oy + a.y * view.scale;
          if (grid > 0) {
            cx = Math.round(cx * grid) / grid;
            cy = Math.round(cy * grid) / grid;
          }
          const t = a.dir / TAU;
          let col = Math.round((t - Math.floor(t)) * DIR_STEPS);
          if (col >= DIR_STEPS) col = 0;
          ctx.drawImage(
            sheet.canvas,
            col * cell,
            rowOf(a, hot) * cell,
            cell,
            cell,
            cx - half,
            cy - half,
            css,
            css,
          );
        }
      }

      // --- 付属演出。対象は少数なので、描画状態の変更もそこに閉じる ---

      // 感染しかけの度合いを外周の目盛りで見せる。長さで読めるので色に頼らない
      const gaugeR = r + 2.2;
      ctx.lineCap = 'butt';
      ctx.lineWidth = Math.max(1.6, r * 0.34);
      for (const a of agents) {
        if (a.state !== 'susceptible' || a.exposure <= 0.12) continue;
        const t = Math.min(1, a.exposure / CONFIG.exposureThreshold);
        ctx.strokeStyle = pick(ramps.warn, 0.35 + 0.55 * t);
        ctx.beginPath();
        ctx.arc(
          view.ox + a.x * view.scale,
          view.oy + a.y * view.scale,
          gaugeR,
          -Math.PI / 2,
          -Math.PI / 2 + t * TAU,
        );
        ctx.stroke();
      }

      // ワクチンで守られている人。破線にして、収束後の殻と見分けられるようにする。
      // 残りが減ると隙間が広がり、守りが薄くなっていくことが形で分かる
      const shieldR = r + 4.2;
      let sparse = -1;
      ctx.lineWidth = Math.max(1.4, r * 0.28);
      for (const a of agents) {
        if (a.state !== 'susceptible' || a.immunity <= 0) continue;
        const left = Math.min(1, a.immunity / 2.5);
        const thin = left < 0.5 ? 1 : 0;
        if (thin !== sparse) {
          sparse = thin;
          dash[0] = r * (thin ? 0.4 : 0.95);
          dash[1] = r * (thin ? 1.1 : 0.6);
          ctx.setLineDash(dash);
        }
        // 破線の位相を個体ごとにずらし、同じ絵が並ばないようにする
        ctx.lineDashOffset = a.id % 5;
        ctx.strokeStyle = pick(gold, 0.35 + 0.55 * left);
        ctx.beginPath();
        ctx.arc(view.ox + a.x * view.scale, view.oy + a.y * view.scale, shieldR, 0, TAU);
        ctx.stroke();
      }
      if (sparse >= 0) {
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }

      // 耐性が切れかけている人。殻の空洞に元の状態の色が戻ってくる。
      // また広がりうる人が何人いるかは、次の波の大きさを決めるので目立たせる。
      // immunity は毎秒1ずつ減るため、そのまま点滅の位相に使える
      for (const a of agents) {
        if (a.state !== 'recovered' || a.immunity <= 0 || a.immunity > SHELL_WARN) continue;
        const urgency = 1 - a.immunity / SHELL_WARN;
        const beat = 0.55 + 0.45 * Math.sin(a.immunity * 9);
        ctx.fillStyle = pick(ramps.back, (0.3 + 0.6 * urgency) * beat);
        ctx.beginPath();
        ctx.arc(
          view.ox + a.x * view.scale,
          view.oy + a.y * view.scale,
          r * (0.16 + 0.34 * urgency),
          0,
          TAU,
        );
        ctx.fill();
      }

      // 状態が変わった瞬間の白い波紋。広がりながら細くなる
      for (const a of agents) {
        if (a.flash <= 0) continue;
        ctx.strokeStyle = pick(white, a.flash * 0.7);
        ctx.lineWidth = Math.max(0.8, r * 0.34 * a.flash + 0.4);
        ctx.beginPath();
        ctx.arc(
          view.ox + a.x * view.scale,
          view.oy + a.y * view.scale,
          r + (1 - a.flash) * r * 3.6,
          0,
          TAU,
        );
        ctx.stroke();
      }

      // 特性の印。状態のシルエットは変えず、いちばん上に重ねて常に見えるようにする
      for (const a of agents) {
        if (!a.trait) continue;
        const cx = view.ox + a.x * view.scale;
        const cy = view.oy + a.y * view.scale;
        if (a.trait === 'social') {
          // 外側の点線の輪（届く範囲が広いことを示す）
          ctx.setLineDash([Math.max(1.4, r * 0.3), Math.max(1.4, r * 0.34)]);
          ctx.lineWidth = Math.max(1, r * 0.22);
          ctx.strokeStyle = 'rgba(248,250,252,0.8)';
          ctx.beginPath();
          ctx.arc(cx, cy, r + 6.2, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (a.trait === 'popular') {
          drawTraitStar(ctx, cx, cy - r - 5.5, Math.max(2.6, r * 0.62));
        } else if (a.trait === 'medic') {
          drawTraitCross(ctx, cx, cy - r - 5.5, Math.max(2.2, r * 0.56));
        }
      }
    },
  };
}

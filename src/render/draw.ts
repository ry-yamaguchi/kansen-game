import { CONFIG } from '../sim/config';
import { modeOf } from '../sim/modes';
import type { BlockRole, SimState, World } from '../sim/types';
import { createCharacterRenderer } from './characters';
import type { View } from './view';

/** 人を描く大きさの倍率と、画面上の最小半径（px）。描画だけに効く */
const AGENT_DRAW_SCALE = 1.5;
const AGENT_MIN_PX = 5.5;
/** 特性持ちの名札を出しておく秒数と、消えるまでの秒数 */
const NAME_TAG_HOLD = 4;
const NAME_TAG_FADE = 2;

/** 場所（住宅以外）に添える名前 */
const PLACE_LABELS: Partial<Record<BlockRole, string>> = {
  plaza: '広場',
  station: '駅',
  school: '学校',
  work: '職場',
};

/** 演出: 浮かぶ文字（good=金色・info=白）の色。bad はモードの広がる色を使う（drawPopups側で解決する） */
const POPUP_GOOD_COLOR = '#facc15';
const POPUP_INFO_COLOR = '#f8fafc';

/** '#rrggbb' 形式の16進色にアルファを付けて rgba() 文字列にする */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 設置プレビュー。指の位置に何が起きるかを事前に見せる */
export interface Preview {
  x: number;
  y: number;
  r: number;
  color: string;
  affordable: boolean;
  /** 隔離の判断材料。範囲内の内訳 */
  infected: number;
  healthy: number;
  /** 内訳の呼び名。モードによって変わる */
  infectedLabel: string;
  healthyLabel: string;
  showCounts: boolean;
}

export interface Renderer {
  draw(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    view: View,
    cssWidth: number,
    cssHeight: number,
    preview: Preview | null,
    elapsed: number,
  ): void;
}

export function createRenderer(): Renderer {
  const characters = createCharacterRenderer();

  function drawField(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    view: View,
    cssWidth: number,
    cssHeight: number,
  ): void {
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const w = state.world.w * view.scale;
    const h = state.world.h * view.scale;

    // 街の範囲
    ctx.fillStyle = '#0a1120';
    ctx.fillRect(view.ox, view.oy, w, h);

    // 方眼（研究所のモニタらしさ。座標の見当もつきやすくなる）
    const gridStep = 100 * view.scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.ox, view.oy, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(45,212,191,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = view.ox; x <= view.ox + w; x += gridStep) {
      ctx.moveTo(Math.round(x) + 0.5, view.oy);
      ctx.lineTo(Math.round(x) + 0.5, view.oy + h);
    }
    for (let y = view.oy; y <= view.oy + h; y += gridStep) {
      ctx.moveTo(view.ox, Math.round(y) + 0.5);
      ctx.lineTo(view.ox + w, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(45,212,191,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(view.ox + 0.5, view.oy + 0.5, w - 1, h - 1);
  }

  /**
   * 街の区画を描く。住宅は暗い塗り（通れない）、場所（広場・駅・学校・職場）は薄い色に名前を添える。
   * 人より先に描き、人が上に乗って見えるようにする。
   */
  function drawCity(ctx: CanvasRenderingContext2D, state: SimState, view: View): void {
    for (const b of state.city.blocks) {
      const x = view.ox + b.x * view.scale;
      const y = view.oy + b.y * view.scale;
      const w = b.w * view.scale;
      const h = b.h * view.scale;

      if (b.role === 'house') {
        ctx.fillStyle = 'rgba(4,7,15,0.82)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(45,212,191,0.07)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        continue;
      }

      ctx.fillStyle = 'rgba(45,212,191,0.08)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(45,212,191,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      const label = PLACE_LABELS[b.role];
      if (label) {
        ctx.fillStyle = 'rgba(226,232,240,0.6)';
        ctx.font = '600 12px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + w / 2, y + h / 2);
      }
    }
    // バス停: 駅と並ぶ、街の外から人が入ってくる入口（研究メモ F1）。通りの角に小さな札で示す
    for (const e of state.city.entrances) {
      if (e.kind !== 'bus') continue;
      const cx = view.ox + e.x * view.scale;
      const cy = view.oy + e.y * view.scale;
      const w = 40;
      const h = 18;
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.strokeStyle = 'rgba(45,212,191,0.55)';
      ctx.lineWidth = 1;
      // roundRect は古い Safari に無いため、角を丸めた矩形を自前で描く
      const x0 = cx - w / 2;
      const y0 = cy - h / 2;
      const rr = 5;
      ctx.beginPath();
      ctx.moveTo(x0 + rr, y0);
      ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, rr);
      ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, rr);
      ctx.arcTo(x0, y0 + h, x0, y0, rr);
      ctx.arcTo(x0, y0, x0 + w, y0, rr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(226,232,240,0.8)';
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('バス停', cx, cy + 0.5);
    }
    // 既定へ戻す。あとの描画（プレビューの内訳など）は左揃え・alphabetic を前提にしている
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawZones(ctx: CanvasRenderingContext2D, state: SimState, view: View): void {
    for (const z of state.zones) {
      const cx = view.ox + z.x * view.scale;
      const cy = view.oy + z.y * view.scale;
      const r = z.r * view.scale;
      const fade = Math.min(1, z.life / 3);

      ctx.fillStyle = `rgba(255,179,71,${0.07 * fade})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // 残り時間が少ないと点滅させ、解除が近いことを伝える
      const blink = z.life < 3 ? 0.4 + 0.6 * Math.abs(Math.sin(z.life * 6)) : 1;
      ctx.strokeStyle = `rgba(255,179,71,${0.5 * blink})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 残り持続時間を円弧で示す
      ctx.strokeStyle = 'rgba(255,179,71,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (z.life / z.maxLife) * Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawLinks(ctx: CanvasRenderingContext2D, state: SimState, view: View): void {
    const links = state.links;
    if (links.length === 0) return;
    const agents = state.agents;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k < links.length; k += 2) {
      const a = agents[links[k]];
      const b = agents[links[k + 1]];
      ctx.moveTo(view.ox + a.x * view.scale, view.oy + a.y * view.scale);
      ctx.lineTo(view.ox + b.x * view.scale, view.oy + b.y * view.scale);
    }
    ctx.strokeStyle = 'rgba(255,45,85,0.28)';
    ctx.stroke();
  }

  /**
   * 人の描画は characters.ts に委ねる。
   * 伝播中の人の背後のグローもあちらに含まれるため、ここでは何も描かない。
   */
  function drawAgents(ctx: CanvasRenderingContext2D, state: SimState, view: View): void {
    // 街の盤面は縮めて描くため、そのままだと人が画面上で半径4px前後しかなく見分けにくい。
    // 描く大きさだけを上げる（接触の判定などゲームの中身は変えない）
    const r = Math.max(AGENT_MIN_PX, CONFIG.agentRadius * view.scale * AGENT_DRAW_SCALE);
    // 開始直後の数秒だけ、特性持ちの頭上に名札を出して「誰が誰か」を盤面の上で見せる
    const tag = state.time < NAME_TAG_HOLD ? 1 : Math.max(0, 1 - (state.time - NAME_TAG_HOLD) / NAME_TAG_FADE);
    characters.drawAgents(ctx, state.agents, view, r, state.mode, state.transmissionMul, tag);
  }

  function drawPulses(ctx: CanvasRenderingContext2D, state: SimState, view: View): void {
    for (const p of state.pulses) {
      const t = p.age / p.ttl;
      const cx = view.ox + p.x * view.scale;
      const cy = view.oy + p.y * view.scale;
      if (p.kind === 'outbreak') {
        // 演出: OUTBREAK！／BUZZ!の輪。大きく素早く広がり、モードの広がる色で強く見せる
        const radius = p.r * view.scale * (0.2 + t * 1.15);
        const alpha = (1 - t) * 0.85;
        ctx.strokeStyle = hexToRgba(modeOf(state.mode).colors.infected, alpha);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      if (p.kind === 'arrival') {
        // 外から人が入ってきた入口。広がる色（新商品は未体験の色）の輪を、内側から外へ2回に分けて広げる
        const def = modeOf(state.mode);
        const color = def.spreadSide ? def.colors.susceptible : def.colors.infected;
        for (const lag of [0, 0.25]) {
          const tt = Math.max(0, Math.min(1, (p.age / p.ttl - lag) / (1 - lag)));
          if (tt <= 0 || tt >= 1) continue;
          ctx.strokeStyle = hexToRgba(color, (1 - tt) * 0.9);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, p.r * view.scale * (0.15 + tt * 0.85), 0, Math.PI * 2);
          ctx.stroke();
        }
        continue;
      }
      const radius = p.r * view.scale * (0.5 + t * 0.6);
      const alpha = (1 - t) * 0.9;
      ctx.strokeStyle =
        p.kind === 'vaccine' ? `rgba(74,222,128,${alpha})` : `rgba(255,179,71,${alpha * 0.7})`;
      ctx.lineWidth = p.kind === 'vaccine' ? 3 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * 演出: 浮かぶ文字（CHAIN・OUTBREAK・道具の手応え）。
   * 少し上に昇りながら薄れ、出た瞬間に少し大きく弾む。濃い縁取りの太字にする。
   * OUTBREAK！／BUZZ!（big）は短く左右に揺れる。揺れは描画側の経過時間から決め、simの乱数は使わない。
   */
  function drawPopups(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    view: View,
    cssWidth: number,
    elapsed: number,
  ): void {
    if (state.popups.length === 0) return;
    const bigFontPx = Math.max(26, Math.min(52, cssWidth * 0.09));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of state.popups) {
      const t = Math.min(1, p.age / p.ttl);
      const alpha = 1 - t;
      // 出た瞬間だけ大きく弾み、すぐ落ち着く
      const bounce = 1 + 0.5 * Math.exp(-t * 14);
      const rise = t * (p.big ? 24 : 16);
      const shakeX = p.big ? Math.sin(elapsed * 26) * 2.5 * Math.max(0, 1 - t * 2.5) : 0;
      const cx = view.ox + p.x * view.scale + shakeX;
      const cy = view.oy + p.y * view.scale - rise;
      const fontPx = (p.big ? bigFontPx : 15) * bounce;
      // bad はモードの広がる色（危険・悪い出来事の色と揃える）
      let color = modeOf(state.mode).colors.infected;
      if (p.tone === 'good') color = POPUP_GOOD_COLOR;
      else if (p.tone === 'info') color = POPUP_INFO_COLOR;

      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = `900 ${fontPx.toFixed(1)}px system-ui, -apple-system, sans-serif`;
      ctx.lineWidth = p.big ? 6 : 3.5;
      // 盤面の端（角のバス停など）に出た文字が切れないよう、盤面の内側へ寄せる
      const half = ctx.measureText(p.text).width / 2 + ctx.lineWidth;
      const left = view.ox + half;
      const right = view.ox + state.world.w * view.scale - half;
      const x = left <= right ? Math.min(right, Math.max(left, cx)) : view.ox + (state.world.w * view.scale) / 2;
      const y = Math.max(view.oy + fontPx / 2 + ctx.lineWidth, cy);
      ctx.strokeStyle = 'rgba(5,8,15,0.9)';
      ctx.strokeText(p.text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(p.text, x, y);
    }
    ctx.restore();
  }

  function drawPreview(ctx: CanvasRenderingContext2D, view: View, world: World, preview: Preview): void {
    const cx = view.ox + preview.x * view.scale;
    const cy = view.oy + preview.y * view.scale;
    const r = preview.r * view.scale;
    const color = preview.affordable ? preview.color : '#64748b';

    ctx.save();
    ctx.globalAlpha = preview.affordable ? 1 : 0.55;
    ctx.fillStyle = color;
    ctx.globalAlpha *= 0.1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.globalAlpha = preview.affordable ? 0.95 : 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 中心の十字
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy);
    ctx.lineTo(cx + 7, cy);
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx, cy + 7);
    ctx.stroke();
    ctx.restore();

    if (preview.showCounts) {
      const label = `${preview.infectedLabel} ${preview.infected} / ${preview.healthyLabel} ${preview.healthy}`;
      ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = ctx.measureText(label).width;
      const boxW = tw + 16;
      const boxH = 22;
      // 盤面の内側に収める。上端近くに置くと箱が盤面の外へ切れていた不具合の修正（左右も念のため収める）
      const boardLeft = view.ox;
      const boardRight = view.ox + world.w * view.scale;
      const boardTop = view.oy;
      const bx = Math.min(Math.max(cx - boxW / 2, boardLeft + 2), boardRight - boxW - 2);
      const by = Math.max(cy - r - 30, boardTop + 2);
      ctx.fillStyle = 'rgba(5,8,15,0.85)';
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, boxW, boxH);
      ctx.fillStyle = '#e2e8f0';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 8, by + boxH / 2);
    }
  }

  function drawOverlays(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    cssWidth: number,
    cssHeight: number,
    elapsed: number,
  ): void {
    // ロックダウン中は画面全体を青く沈ませる
    if (state.lockdownTimer > 0) {
      ctx.fillStyle = 'rgba(96,165,250,0.1)';
      ctx.fillRect(0, 0, cssWidth, cssHeight);
    }

    // 危険度に応じた赤い縁。感染が急増していることが視界の端で分かる
    if (state.danger > 0.05) {
      const pulse = 0.6 + 0.4 * Math.sin(elapsed * 6);
      const alpha = state.danger * 0.5 * pulse;
      const thickness = Math.min(cssWidth, cssHeight) * 0.16;
      const grad = ctx.createLinearGradient(0, 0, 0, cssHeight);
      grad.addColorStop(0, `rgba(255,45,85,${alpha})`);
      grad.addColorStop(thickness / cssHeight, 'rgba(255,45,85,0)');
      grad.addColorStop(1 - thickness / cssHeight, 'rgba(255,45,85,0)');
      grad.addColorStop(1, `rgba(255,45,85,${alpha})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cssWidth, cssHeight);

      const grad2 = ctx.createLinearGradient(0, 0, cssWidth, 0);
      grad2.addColorStop(0, `rgba(255,45,85,${alpha})`);
      grad2.addColorStop(thickness / cssWidth, 'rgba(255,45,85,0)');
      grad2.addColorStop(1 - thickness / cssWidth, 'rgba(255,45,85,0)');
      grad2.addColorStop(1, `rgba(255,45,85,${alpha})`);
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, cssWidth, cssHeight);
    }
  }

  return {
    draw(ctx, state, view, cssWidth, cssHeight, preview, elapsed) {
      drawField(ctx, state, view, cssWidth, cssHeight);
      drawCity(ctx, state, view);
      drawZones(ctx, state, view);
      drawLinks(ctx, state, view);
      drawAgents(ctx, state, view);
      drawPulses(ctx, state, view);
      if (preview) drawPreview(ctx, view, state.world, preview);
      drawOverlays(ctx, state, cssWidth, cssHeight, elapsed);
      // 浮かぶ文字はオーバーレイ（危険の赤い縁・ロックダウンの青）の上に出し、埋もれないようにする
      drawPopups(ctx, state, view, cssWidth, elapsed);
    },
  };
}

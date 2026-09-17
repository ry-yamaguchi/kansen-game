import type { ToolId, World } from './types';

/**
 * ゲームバランスの調整値。
 * 厳密な感染症モデルではなく「見て分かる」ことを優先したチューニング。
 */
export const CONFIG = {
  /** 1ゲームの長さ（秒） */
  duration: 75,
  /** 初期感染者数 */
  initialInfected: 3,

  // --- エージェント ---
  agentRadius: 6.5,
  speedMin: 34,
  speedMax: 58,
  /** 進行方向のゆらぎ（ラジアン/秒） */
  turnRate: 2.2,

  // --- 感染 ---
  /** 接触と判定する距離 */
  contactRadius: 30,
  /** 感染者1人との接触で1秒あたり蓄積する量 */
  exposureGain: 1.5,
  /** 非接触時に1秒あたり減衰する量 */
  exposureDecay: 0.5,
  /** この値を超えると感染判定 */
  exposureThreshold: 1,
  /** しきい値到達時に実際に感染する確率 */
  infectionChance: 0.9,
  /** 同時に効く感染者数の上限（密集地帯での爆発を抑える） */
  maxContactStack: 3,
  /** 感染期間（秒） */
  recoveryMin: 10,
  recoveryMax: 14.5,

  // --- 対策ポイント ---
  startPoints: 110,
  /** 1秒あたりの自然回復量 */
  pointRegen: 1.7,
  maxPoints: 200,

  // --- 隔離エリア ---
  zoneRadius: 86,
  /** 感染期間より長く保たせることで、中の感染を燃え尽きさせられる */
  zoneLife: 18,
  /** 隔離中の移動速度倍率 */
  zoneSpeedFactor: 0.24,
  /** 隔離中は接触も制限されるため、感染圧に掛ける倍率 */
  zoneContactFactor: 0.32,

  // --- ワクチン／治療エリア ---
  vaccineRadius: 84,
  /** 免疫の持続時間（秒） */
  immunityDuration: 12,
  /** 免疫中の接触蓄積の倍率 */
  immunityFactor: 0.08,
  /**
   * 感染者の残り感染時間に掛ける倍率（治療効果）。
   * ここを強くするとワクチンが万能になり、隔離を選ぶ理由が消える。
   * ワクチンは「予防」、隔離は「既に固まった感染者の封じ込め」と役割を分けている。
   */
  treatFactor: 0.6,

  // --- 緊急ロックダウン ---
  lockdownDuration: 6,
  lockdownCooldown: 18,
  lockdownSpeedFactor: 0.14,

  // --- コスト ---
  costs: {
    isolation: 28,
    vaccine: 30,
    lockdown: 38,
  } satisfies Record<ToolId, number>,
} as const;

export interface ToolMeta {
  id: ToolId;
  label: string;
  short: string;
  hint: string;
  cost: number;
  /** タップして設置する範囲系ツールか */
  placeable: boolean;
  color: string;
}

export const TOOLS: ToolMeta[] = [
  {
    id: 'isolation',
    label: '隔離エリア',
    short: '隔離',
    hint: '範囲を封鎖します。外に感染を出しません',
    cost: CONFIG.costs.isolation,
    placeable: true,
    color: '#ffb347',
  },
  {
    id: 'vaccine',
    label: 'ワクチン',
    short: 'ワクチン',
    hint: '健康な人に免疫をつけ、感染者を早く回復させます',
    cost: CONFIG.costs.vaccine,
    placeable: true,
    color: '#4ade80',
  },
  {
    id: 'lockdown',
    label: 'ロックダウン',
    short: 'LD',
    hint: '全員の移動を5秒間ほぼ止めます',
    cost: CONFIG.costs.lockdown,
    placeable: false,
    color: '#60a5fa',
  },
];

export const COLORS = {
  susceptible: '#2dd4bf',
  infected: '#ff2d55',
  recovered: '#a78bfa',
  immune: '#facc15',
  zone: '#ffb347',
  vaccine: '#4ade80',
} as const;

/**
 * 画面サイズから世界の大きさと人数を決める。
 * 面積あたりの人口密度をほぼ一定に保つことで、端末が変わっても
 * 感染の広がり方が大きく変わらないようにしている。
 */
export function planWorld(cssWidth: number, cssHeight: number): { world: World; population: number } {
  const compact = Math.min(cssWidth, cssHeight) < 520 || cssWidth < 700;
  const area = compact ? 470_000 : 690_000;
  const population = compact ? 60 : 85;
  const rawAspect = cssWidth / Math.max(1, cssHeight);
  const aspect = Math.min(2.1, Math.max(0.52, rawAspect));
  const h = Math.sqrt(area / aspect);
  const w = area / h;
  return { world: { w: Math.round(w), h: Math.round(h) }, population };
}

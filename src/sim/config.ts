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
  /**
   * 感染者1人との接触で1秒あたり蓄積する量。
   * SIRS では高すぎると「何をしても3割が感染し続ける」平衡に落ち着き、
   * 介入の効果が見えなくなる。抑え込みが届く範囲に置く。
   */
  exposureGain: 1.8,
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
  /**
   * 半径が小さいと盤面のごく一部しか覆えず、社会活動度の代償を回収できない。
   * 「一区画を封鎖して持ちこたえる」道具として意味を持つ大きさにしている。
   */
  zoneRadius: 105,
  /** 感染期間より長く保たせることで、中の感染を燃え尽きさせられる */
  zoneLife: 18,
  /** 隔離中の移動速度倍率 */
  zoneSpeedFactor: 0.24,
  /**
   * 隔離中は接触も制限されるため、感染圧に掛ける倍率。
   * ここを効かせないと、隔離が「健康な人を感染者と閉じ込める罠」になってしまう。
   */
  zoneContactFactor: 0.12,

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
  lockdownDuration: 8,
  /**
   * クールダウンを短くし、抑制の主役にする。
   * 使いすぎを止めるのは待ち時間ではなく社会活動度の低下であり、
   * それがポイント回復の鈍化に跳ね返る。
   */
  lockdownCooldown: 10,
  lockdownSpeedFactor: 0.14,
  /**
   * ロックダウン中の感染圧の倍率。
   * 止めるだけでは、密集したまま固まって逆に感染が進んでしまう。
   * 距離を取らせる意味でここも下げる。
   */
  lockdownTransmissionFactor: 0.4,

  /** 開始前のカウントダウン（秒） */
  countdown: 3,

  // --- 回復後の耐性（SIRS）---
  /**
   * 回復してから未感染に戻るまでの秒数。
   * 永久免疫にすると盤面が回復者で埋まって終わってしまうため、必ず戻す。
   */
  resistanceDuration: 9,

  // --- 外部からの流入 ---
  /** 流入の間隔（秒）。時間が経つと短くなる */
  inflowIntervalStart: 13,
  inflowIntervalEnd: 7,
  /** 1回に入ってくる人数。時間が経つと増える */
  inflowCountStart: 1,
  inflowCountEnd: 3,
  /** 人数の上限。増えすぎて重くならないようにする */
  maxPopulation: 130,

  // --- 社会活動度 ---
  socialMax: 100,
  /**
   * 隔離エリア1つを維持するのに1秒あたり失う活動度。
   * 回復量より大きくしないと、上限に張り付いて機構が死ぬ。
   * 1つなら維持できる、2つ以上は削られる、という設定にしている。
   */
  socialCostPerZone: 2,
  /** ロックダウン中に1秒あたり失う活動度 */
  socialCostLockdown: 8,
  /** 何もしていないときに1秒あたり戻る活動度 */
  socialRecovery: 3,
  /** 活動度が低いと対策ポイントの回復が鈍る。その下限倍率 */
  socialRegenFloor: 0.35,

  // --- 隔離エリアの制限 ---
  /** 同時に置ける隔離エリアの数 */
  maxZones: 3,

  // --- スコアの重み ---
  /**
   * 非感染率の時間積分に掛ける係数。
   * 感染を抑えることが主目的なので、社会活動より重くする。
   * 社会活動を重くしすぎると「何もしないのが最適」になってしまう。
   */
  scoreProtection: 120,
  /** 社会活動度の時間積分に掛ける係数 */
  scoreSocial: 22,
  /** 最大同時感染者数への減点 */
  scorePeakPenalty: 14,

  // --- コスト ---
  costs: {
    isolation: 28,
    vaccine: 30,
    lockdown: 30,
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

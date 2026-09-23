import type { ToolId, World } from './types';

/**
 * ゲームバランスの調整値。
 * 厳密な感染症モデルではなく「見て分かる」ことを優先したチューニング。
 */
export const CONFIG = {
  /** 1ゲームの長さ（秒） */
  duration: 75,
  /** 初期感染者数 */
  initialInfected: 2,

  // --- エージェント ---
  agentRadius: 6.5,

  // --- 街 ---
  /** 通りの幅。世界の短辺に対する比率 */
  streetWidthRatio: 0.12,
  /** 出発時刻の個人差の最大値（秒）。全員が一斉に動き出さないようにする */
  departureJitterMax: 6,
  /** 昼に広場でなく駅へ向かう人の割合 */
  noonStationRatio: 0.2,

  // --- 時間帯 ---
  /** 朝が終わる時刻（秒） */
  periodMorningEnd: 25,
  /** 昼が終わる時刻（秒）。これ以降は夕方 */
  periodNoonEnd: 50,

  // --- 感染 ---
  // 接触距離・伝播力・持続時間・速度はモードごとに違うため
  // src/sim/modes.ts の tuning 側で持つ。ここには共通のものだけを置く。
  /** 非接触時に1秒あたり減衰する量 */
  exposureDecay: 0.5,
  /** この値を超えると感染判定 */
  exposureThreshold: 1,
  /**
   * 感染の速さの全体倍率。モードごとの exposureGain の差は保ったまま、全体の速さだけを合わせる。
   * 街では人が学校・職場・広場に集まり、何もない平面より接触が数倍に増えるため、ここで釣り合わせる
   */
  exposureScale: 0.25,
  /** しきい値到達時に実際に感染する確率 */
  infectionChance: 0.9,
  /** 同時に効く感染者数の上限（密集地帯での爆発を抑える） */
  maxContactStack: 3,

  // --- 対策ポイント ---
  startPoints: 110,
  /** 1秒あたりの自然回復量 */
  pointRegen: 1.9,
  // 上限は開始時と同じにする。使わずに貯めたポイントは溢れて消えるので、待つことにも代償がある
  maxPoints: 110,

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
  zoneContactFactor: 0.08,

  // --- ワクチン／治療エリア ---
  vaccineRadius: 84,
  /** 免疫の持続時間（秒） */
  immunityDuration: 12,
  /** 免疫中の接触蓄積の倍率 */
  immunityFactor: 0.05,
  /**
   * 感染者の残り感染時間に掛ける倍率（治療効果）。
   * ここを強くするとワクチンが万能になり、隔離を選ぶ理由が消える。
   * ワクチンは「予防」、隔離は「既に固まった感染者の封じ込め」と役割を分けている。
   */
  treatFactor: 0.45,

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
  lockdownTransmissionFactor: 0.3,

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
  socialCostPerZone: 1.5,
  /** ロックダウン中に1秒あたり失う活動度 */
  socialCostLockdown: 8,
  /** 何もしていないときに1秒あたり戻る活動度 */
  socialRecovery: 3,
  /** 活動度が低いと対策ポイントの回復が鈍る。その下限倍率 */
  socialRegenFloor: 0.35,

  // --- 隔離エリアの制限 ---
  /** 同時に置ける隔離エリアの数 */
  maxZones: 3,

  // --- スコア ---
  /**
   * スコアは加算ではなく掛け算で出す。
   * 加算だと「感染は壊滅したが街は動いていた」でも点が入ってしまい、
   * 何もしないのが最適解になりかねない。
   * どちらかが崩れたら点にならない形にしている。
   */
  scoreBase: 10000,
  /** 抑制係数。この抑制率までは0点 */
  scoreProtectionFloor: 0.46,
  /** 床から満点までの幅 */
  scoreProtectionSpan: 0.38,
  /** 社会係数。この活動度までは0点 */
  scoreSocialFloor: 0.28,
  scoreSocialSpan: 0.62,
  /** 最大同時感染者数による補正の強さ（最大でこの割合だけ削る） */
  scorePeakWeight: 0.3,
  /** 人口のこの割合まで感染が広がったら、補正が最大に効く */
  scorePeakRef: 0.7,

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
 *
 * 街の形は毎回同じにする（駅や広場の位置を覚えて、守り方を磨けるようにするため）。
 * 世界の大きさは横長 1000×600・縦長 600×1000 の2種類だけで、画面の高さが幅より
 * 大きいときだけ縦長にする。中間の縦横比では余白ができるが、街の形を保つほうを優先する。
 * 人数は30人（2026-09-23、街と目的地のある盤面への作り直しで85人から減らした）。
 */
export function planWorld(cssWidth: number, cssHeight: number): { world: World; population: number } {
  const population = 30;
  const world: World = cssHeight > cssWidth ? { w: 600, h: 1000 } : { w: 1000, h: 600 };
  return { world, population };
}

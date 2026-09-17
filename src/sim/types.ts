/** シミュレーションの型定義。DOM に依存しない純粋なデータ構造。 */

export type AgentState = 'susceptible' | 'infected' | 'recovered';

export interface Agent {
  id: number;
  x: number;
  y: number;
  /** 進行方向（ラジアン） */
  dir: number;
  /** 個体ごとの基礎速度（world units / 秒） */
  speed: number;
  state: AgentState;
  /** 一度でも感染したか。「守れた人数」の判定に使う */
  everInfected: boolean;
  /** 感染中の残り時間（秒）。0 になると回復 */
  infectionTimer: number;
  /** 接触の蓄積量。しきい値を超えると感染判定 */
  exposure: number;
  /** ワクチンによる免疫の残り時間（秒） */
  immunity: number;
  /** 所属する隔離エリアの id。-1 は未所属 */
  zone: number;
  /** 今フレームの感染者接触数（描画用） */
  contacts: number;
  /** 今フレームの感染圧。隔離中は接触が制限されるため重みが下がる */
  load: number;
  /** 状態変化時の視覚パルス（1 → 0 に減衰） */
  flash: number;
}

export interface IsolationZone {
  id: number;
  x: number;
  y: number;
  r: number;
  /** 残り持続時間（秒） */
  life: number;
  maxLife: number;
}

export type PulseKind = 'vaccine' | 'zone-expire' | 'outbreak';

/** 一過性の視覚エフェクト */
export interface Pulse {
  x: number;
  y: number;
  r: number;
  age: number;
  ttl: number;
  kind: PulseKind;
}

export interface World {
  w: number;
  h: number;
}

/**
 * countdown は開始直前の数秒。人は動くが時間も感染も進まない。
 * 初期配置を見て初手を決めるための猶予である。
 */
export type Phase = 'ready' | 'countdown' | 'playing' | 'finished';

/** 画面に出す短い通知（ウェーブの発生など） */
export interface Notice {
  id: number;
  title: string;
  detail: string;
  tone: 'bad' | 'good';
}

export type ToolId = 'isolation' | 'vaccine' | 'lockdown';

export interface ActionCounts {
  isolation: number;
  vaccine: number;
  lockdown: number;
}

export interface SimState {
  world: World;
  agents: Agent[];
  zones: IsolationZone[];
  pulses: Pulse[];
  /** 描画用の接触ペア（[iのindex, jのindex, ...] のフラット配列） */
  links: number[];
  /** 経過時間（秒） */
  time: number;
  /** 残り時間（秒） */
  timeLeft: number;
  points: number;
  /** ロックダウンの残り効果時間（秒） */
  lockdownTimer: number;
  /** ロックダウンの残りクールダウン（秒） */
  lockdownCooldown: number;
  actions: ActionCounts;
  pointsSpent: number;
  susceptible: number;
  infected: number;
  recovered: number;
  peakInfected: number;
  totalInfected: number;
  /** 直近の新規感染ペース（EMA）。危険演出に使う */
  infectionRate: number;
  /** 0..1 の危険度 */
  danger: number;
  nextZoneId: number;

  // --- 社会活動度 ---
  /** 0..100。隔離やロックダウンで下がり、放っておくと戻る */
  social: number;

  // --- ウェーブによる変化 ---
  /** 感染力の倍率。変異株で上がる */
  transmissionMul: number;
  /** 回復後の耐性時間の倍率。変異株で下がる */
  resistanceMul: number;
  /** 中央へ集まっている残り時間（秒） */
  gatherTimer: number;
  /** 次に発生させるウェーブの番号 */
  nextWave: number;
  /** 直近の通知。表示したら消してよい */
  notice: Notice | null;
  nextNoticeId: number;

  // --- 外部からの流入 ---
  /** 次の流入までの残り時間（秒） */
  inflowTimer: number;
  /** 流入で入ってきたのべ人数 */
  inflowTotal: number;

  // --- スコアの素になる時間積分 ---
  /** 非感染率の積分（秒） */
  healthySeconds: number;
  /** 社会活動度（0..1に正規化）の積分（秒） */
  socialSeconds: number;
}

export interface GameResult {
  /** 流入を含めた最終人数 */
  population: number;
  /**
   * 感染を抑えられていた割合（0..1）。
   * 「終わった瞬間の状態」ではなく制限時間ぜんたいの平均なので、
   * 最後に感染者が残っていても抑え続けていれば高くなる。
   */
  protectionRatio: number;
  /** 平均社会活動度（0..1） */
  avgSocial: number;
  peakInfected: number;
  /** 最後に残っていた感染者数 */
  finalInfected: number;
  /** のべ感染者数 */
  totalInfected: number;
  /** 外から入ってきたのべ人数 */
  inflowTotal: number;
  actions: ActionCounts;
  pointsLeft: number;
  pointsSpent: number;
  /** スコアの内訳 */
  breakdown: { protection: number; social: number; peakPenalty: number; points: number };
  score: number;
  rank: 'S' | 'A' | 'B' | 'C' | 'D';
  verdict: string;
  comment: string;
}

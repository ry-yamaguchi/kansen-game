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

export type Phase = 'ready' | 'playing' | 'finished';

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
}

export interface GameResult {
  population: number;
  /** 最終感染率（0..1）。一度でも感染した人の割合 */
  infectionRate: number;
  peakInfected: number;
  /** 一度も感染しなかった人数 */
  protectedCount: number;
  totalInfected: number;
  actions: ActionCounts;
  pointsLeft: number;
  pointsSpent: number;
  score: number;
  rank: 'S' | 'A' | 'B' | 'C' | 'D';
  comment: string;
}

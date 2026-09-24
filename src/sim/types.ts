/** シミュレーションの型定義。DOM に依存しない純粋なデータ構造。 */

import type { Rng } from './rng';

export type AgentState = 'susceptible' | 'infected' | 'recovered';

/** 生まれつきの特性の種類 */
export type TraitId = 'social' | 'popular' | 'medic';
/** 生まれつきの特性。null は特性なし */
export type Trait = TraitId | null;

/** 一日の時間帯。朝は通う先、昼は広場（一部は駅）、夕方は家へ向かう */
export type Period = 'morning' | 'noon' | 'evening';

/**
 * 今向かっている（または着いている）目的の種類。
 * - home: 家にいる、または家へ向かっている（夕方の既定）
 * - commute: 学校・職場にいる、または向かっている（朝の既定）
 * - noon: 広場か駅にいる、または向かっている（昼の既定）
 * - gather: 大型イベントで広場に集まっている、または向かっている（時間帯に関わらず割り込む）
 */
export type Purpose = 'home' | 'commute' | 'noon' | 'gather';

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

  // --- 街・目的地（2026-09-24 街への作り直しで追加） ---
  /** 家（住宅区画に面した通り沿いの点） */
  homeX: number;
  homeY: number;
  /** 通う先が学校か職場か */
  commuteRole: 'school' | 'work';
  /** 昼に広場でなく駅へ向かう人か */
  noonToStation: boolean;
  /** 出発時刻の個人差（秒）。時間帯が変わってからこの秒数だけ待って出発する */
  departureOffset: number;
  /** 通りの中での横ずれ量（固定・個体ごと）。同じ通りを歩く全員が一本の線に重ならないようにする */
  lane: number;
  /** 今向かっている、または達している目的 */
  purpose: Purpose;
  /** 次に切り替える目的。departAt に達するまでは purpose を保つ */
  pendingPurpose: Purpose | null;
  /** pendingPurpose へ切り替えてよい時刻（SimState.time と同じ単位） */
  departAt: number;
  /** 目的地に着いて、その場で小さく歩き回っているか */
  arrived: boolean;
  /** これから通る経路（交差点などの通過点を順に並べたもの）。着いていれば空 */
  path: { x: number; y: number }[];
  /** path の何番目の点を目指しているか */
  pathIndex: number;
  /** 今回の目的地（滞在中はこの点を中心に小さく歩き回る） */
  targetX: number;
  targetY: number;
  /** 着いたあとに歩き回る範囲（実際の行き先から決める。封鎖で行き先を変えた人もここに留まる） */
  stay: { x: number; y: number; w: number; h: number };
  /** 封鎖に行く手を阻まれている時間（秒）。長く続いたら行き先を選び直す */
  blockedFor: number;
  /** 封鎖のせいで本来の行き先と違う所へ向かっている。封鎖が消えたら予定に戻す */
  redirected: boolean;

  // --- 人の振る舞い（2026-09-24 人の振る舞いの追加で追加） ---
  /** 感染中でも体調を理由に休まず、予定どおり通う先へ向かうか。false なら家で休む（B3） */
  sickStaysHome: boolean;
  /** 街の感染割合がこの値を超えたら、昼の広場・駅を避けて通う先に留まる（B4） */
  avoidThreshold: number;
  /** 直近のロックダウンに従っているか。従わない人には速度・感染圧の低下が掛からない（B5） */
  compliesLockdown: boolean;

  // --- 人の個性（2026-09-24 特性の追加で追加） ---
  /** 生まれつきの特性。最初の人数のうち数人だけに付き、流入で増えた人には付かない（研究メモ A1/B1/C3） */
  trait: Trait;

  // --- 新商品モード専用（2026-09-24 エクストラステージ区切りE1で追加） ---
  /**
   * 何人に勧められたら試すか（1〜4人）。作るときに普及の5分類の重みで引く（研究メモE1/E2）。
   * 新商品モード以外では使わない（常に0）。
   */
  adoptThreshold: number;
  /**
   * 勧められた（愛用中の人と合計recommendTime以上そばにいた）と数えた相手のid。
   * 同じ人を重複して数えないための記録。愛用中・飽きた間は空にする（新商品モード以外では常に空）。
   */
  recommendedBy: number[];
  /**
   * 勧められている途中の相手ごとの、接触半径内にいた時間の合計（秒）。recommendTimeに達したら
   * recommendedBy へ移す（新商品モード以外では常に空）。
   */
  recommendProgress: { id: number; seconds: number }[];
}

export type BlockRole = 'house' | 'plaza' | 'station' | 'school' | 'work';

/** 街の区画（1マス）。住宅は建物で通れず、それ以外は中を歩ける */
export interface CityBlock {
  role: BlockRole;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 区画グリッド上の列・行（0始まり） */
  col: number;
  row: number;
}

/** 通りの交差点。経路探索の節点 */
export interface CityNode {
  x: number;
  y: number;
  /** 交差点グリッド上の行・列（0始まり。区画数 + 1 だけある） */
  r: number;
  c: number;
}

/** 街の盤面。区画と通り（交差点の格子）を持つ。世界の大きさが決まれば一意に決まる */
export interface City {
  cols: number;
  rows: number;
  /** 通りの幅（world units） */
  streetWidth: number;
  blocks: CityBlock[];
  /** 交差点。nodes[行][列] */
  nodes: CityNode[][];
  /** 住宅区画（通れない）だけを抜き出したもの */
  houses: CityBlock[];
  plaza: CityBlock;
  station: CityBlock;
  school: CityBlock;
  work: CityBlock;
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

/**
 * 決着の付き方。
 * - timeup: 制限時間まで持ちこたえた
 * - collapsed: 同時感染率が限界を超えて打ち切られた
 * - boom:（新商品モード）同時の愛用率がブームの基準を超えた。勝ち
 * - fizzle:（新商品モード）愛用中が0人になった。定着せず、負け
 *
 * 感染症・噂話・悪感情は伝播が0になっても終わらない（timeup と collapsed の2つだけ）。
 * 新商品モードは逆に、愛用中が0人になると終わる（fizzle）。
 */
export type Outcome = 'playing' | 'timeup' | 'collapsed' | 'boom' | 'fizzle';

/** 画面に出す短い通知（ウェーブの発生など） */
export interface Notice {
  id: number;
  title: string;
  detail: string;
  tone: 'bad' | 'good';
}

export type ToolId = 'isolation' | 'vaccine' | 'lockdown';

export type ModeId = 'epidemic' | 'rumor' | 'anger' | 'product';

/**
 * モードごとに差し替える数値。
 * 色と呼び名だけを変えても別のゲームにはならないため、
 * 伝わり方そのものをここで変える。
 */
export interface Tuning {
  /** 接触と判定する距離。噂は遠くまで届く */
  contactRadius: number;
  /** 1秒あたりの感染圧 */
  exposureGain: number;
  /** 伝播している状態が続く秒数 */
  spreadMin: number;
  spreadMax: number;
  /** 収まったあと、また広がりうる状態に戻るまでの秒数 */
  resistanceDuration: number;
  speedMin: number;
  speedMax: number;
  turnRate: number;
  /** 伝播中の人の移動速度倍率。怒っている人は速い */
  activeSpeedMul: number;
  /** 伝播中の人の方向転換のしやすさ。怒っている人は直進する */
  activeTurnMul: number;
  /** 留まっている（arrived）者どうしの接触の重み。1で無効（旧来どおり）。感染症・噂話は場所で広がり重い、悪感情は軽い（B2/D1） */
  stayContact: number;
  /** どちらかが移動中の接触の重み。1で無効（旧来どおり）。悪感情は通りですれ違う接触が重い（B2/D1） */
  moveContact: number;
  /** ワクチン／訂正情報が付ける免疫の強さ（CONFIG.immunityFactor）に掛ける倍率。1で無効。小さいほど予防が強く効く（C2） */
  immunityMul: number;
  /** ワクチン／訂正情報の治療効果（CONFIG.treatFactor）に掛ける倍率。1で無効。大きいほど治療が弱く効く（C2） */
  treatMul: number;
}

export interface ActionCounts {
  isolation: number;
  vaccine: number;
  lockdown: number;
}

export interface SimState {
  mode: ModeId;
  tuning: Tuning;
  world: World;
  /** 街の盤面（区画・通り）。world から一意に決まり、ゲーム中は変わらない */
  city: City;
  /** 今の時間帯 */
  period: Period;
  agents: Agent[];
  /** このシミュレーション専用のシード付き乱数生成器。標準の乱数関数は使わない */
  rng: Rng;
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
  /** ロックダウンを発動した回数（自粛疲れの計算に使う。B5） */
  lockdownCount: number;
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

  outcome: Outcome;
}

export interface GameResult {
  mode: ModeId;
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
  outcome: Outcome;
  /** 打ち切られた場合、何秒もったか */
  survivedSeconds: number;
  /** 最後に残っていた感染者数 */
  finalInfected: number;
  /** のべ感染者数 */
  totalInfected: number;
  /** 外から入ってきたのべ人数 */
  inflowTotal: number;
  actions: ActionCounts;
  pointsLeft: number;
  pointsSpent: number;
  /** スコアの内訳。掛け算で出すため、係数は 0..1 で持つ */
  breakdown: {
    base: number;
    protectionFactor: number;
    socialFactor: number;
    peakFactor: number;
    pointsBonus: number;
  };
  score: number;
  rank: 'S' | 'A' | 'B' | 'C' | 'D';
  verdict: string;
  comment: string;
}

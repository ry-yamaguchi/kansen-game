import type { ToolId, TraitId, World } from './types';

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
  /** 感染中に体調を理由に家で休む人の割合。残りは予定どおり通う先へ向かう（研究メモ B3） */
  sickStayHomeRate: 0.25,

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
  pointRegen: 2.5,
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
  /**
   * 繰り返し発動しても最低限従う人の割合の下限。自粛疲れが際限なく効かないようにする（研究メモ B5）
   */
  lockdownComplianceFloor: 0.4,
  /** ロックダウンを1回発動するごとに、従う割合がここだけ落ちる（自粛疲れ。研究メモ B5） */
  lockdownFatigue: 0.25,

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

  // --- 人の個性（特性。2026-09-24 追加） ---
  /**
   * 最初の人数のうち、特性を持つ人数。social→popular→medicの順に選ぶ。
   * 合計が人数に満たない盤面（小さなテストなど）では、誰にも付けない。
   * 0にすれば、その特性を持つ人がいない盤面で遊べる（研究メモ A1: 注意すべき対象は4つ以内）。
   */
  traitCounts: {
    social: 2,
    popular: 1,
    medic: 1,
  } satisfies Record<TraitId, number>,
  /** social: 感染中に、接触した相手にかかる感染圧の倍率（研究メモ B1: 感染の2割が8割を広げる） */
  traitSocialLoadMul: 2.5,
  /** social: 接触と判定する距離の倍率。よく人と会う分、届く範囲も広い */
  traitSocialRadiusMul: 1.3,
  /** popular: 同じ場所に留まっている人の向きを popular へ寄せる強さ（1秒あたり、向きの差に掛ける割合） */
  traitPopularPull: 0.35,
  /** popular: これより近づいたら、それ以上は寄せない（重なりすぎ防止） */
  traitPopularMinDist: 18,
  /** medic: 半径内にいる感染者の、感染残り時間が減る速さの倍率 */
  traitMedicRecoverMul: 1.8,
  /** medic: 効果が届く半径 */
  traitMedicRadius: 80,

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

  // --- 新商品（エクストラステージ。2026-09-24 区切りE1で追加。研究メモE1/E2） ---
  /** 愛用中の人と接触半径内に合計これだけの秒数いたら「勧められた」と数える */
  recommendTime: 1.5,
  /**
   * 試供品でその場で試すのは、勧められる人数がこれ以下の人（新しもの好き・初期採用者）だけ。
   * それより慎重な人には「1人に勧められた」ぶんとして数える。配るだけでは広まらない（研究メモ E2）
   */
  sampleAdoptMaxThreshold: 1,
  /**
   * 「何人に勧められたら試すか」（1〜4人）の割合。研究メモE2の普及の5分類（新しもの好き〜慎重派）に沿う。
   * 添字0が1人・添字3が4人で、合計は1になる。
   */
  adoptThresholdWeights: [0.1, 0.4, 0.35, 0.15] as readonly number[],
  /** 普及係数（新商品のscoreProtectionFloor相当）。一度でも試した割合がこの値までは0点 */
  scoreAdoptionFloor: 0.3,
  /** 床から満点までの幅（新商品） */
  scoreAdoptionSpan: 0.5,
  /** 同時愛用率による補正の強さ（新商品。scorePeakWeightの裏返し。最大でこの割合だけ上乗せする） */
  scorePeakBonusWeight: 0.3,
  /** 人口のこの割合まで同時愛用が増えたら、補正が最大に効く（新商品） */
  scorePeakBonusRef: 0.6,
  /** boomで終えたとき、残り時間の割合に応じて足す最大ボーナス点（新商品。早くブームにするほど高い） */
  scoreBoomBonusMax: 100,

  // --- 新商品: 道具3つの裏返しと好感度（区切りE2で追加。design-extra-stage.md「道具」・研究メモE3） ---
  /**
   * 好感度（state.social / socialMax）が低いほど、愛用中の人の残り時間の減りが速くなる倍率の強さ。
   * 実際の倍率は 1 + (1 - 好感度) × goodwillChurnMul。好感度0で最大2倍の速さになる。
   */
  goodwillChurnMul: 1.0,
  /** 好感度がこの値未満のあいだ、試すのに要る人数が1人多くなる（押しつけの反発。心理的リアクタンス） */
  goodwillResistBelow: 0.4,
  /** イベントが人を集める半径。zoneRadius(105)の2.2倍 */
  eventAttractRadius: 231,
  /**
   * イベントの円の中では勧め合いが盛り上がる。「勧められた」と数えるまでの時間がこの倍率で早く進む。
   * 人が集まって同じものを楽しむ場だからである。これが無いと、イベントは同じポイントの試供品より損になった
   * （2026-09-25、100試合の切り分けで確認）
   */
  eventRecommendMul: 2,
  /** イベントの好感度コストの倍率。封鎖の裏返しである広告より嫌がられないため、封鎖(zone)の半分に留める */
  eventSocialCostMul: 0.5,
  /**
   * 広告（triggerLockdown）中に失う好感度が、使うたび大きくなる伸び率。
   * 実際の倍率は 1 + adSocialCostGrowth × (lockdownCountの発動回数 − 1)。押しつけるほど反発される（研究メモE3）
   */
  adSocialCostGrowth: 0.5,

  // --- コスト ---
  costs: {
    isolation: 28,
    vaccine: 26,
    lockdown: 30,
  } satisfies Record<ToolId, number>,

  // --- 演出（CHAIN / OUTBREAK / 手応え。2026-09-25 追加）---
  // ここはすべて記録と表示だけに使う値であり、感染・移動・得点などゲームの数値には関わらない。
  /** 連鎖と数える間隔（秒）。直前の接触感染からこの秒数以内なら連鎖が続く */
  chainWindow: 1.5,
  /** 連鎖数がこの値以上になるたびに「CHAIN ×N」を出す */
  chainPopupThreshold: 3,
  /**
   * 近い場所・短い間隔への連続表示を間引く条件（秒・距離）。
   * 密集地で連鎖が立て続けに起きても、文字が同じ場所へ重ねて出ないようにする。
   */
  chainPopupMinGap: 0.4,
  chainPopupMinDist: 50,
  /**
   * infectionRateがこの値以上でOUTBREAK（新商品はBUZZ）を出す。
   * 放置では10〜45秒ごろに、本気で抑えている試合では届きにくいことを確認して決めた
   * （docs/roadmap.md 演出・手応えの節）。
   */
  outbreakRate: 4.5,
  /** OUTBREAKを出してから次まで空ける秒数 */
  outbreakCooldown: 12,
  /** OUTBREAKの輪の大きさ・表示秒数 */
  outbreakPulseRadius: 190,
  outbreakPulseTtl: 1.2,
  /** 浮かぶ文字（小）の表示秒数 */
  popupTtl: 1.8,
  /** 浮かぶ文字（大。OUTBREAK/BUZZ専用）の表示秒数 */
  popupTtlBig: 2.2,
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

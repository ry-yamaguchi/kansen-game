import type { ModeId, Tuning, ToolId, TraitId } from './types';

/**
 * ウェーブ（時間経過で状況を悪化させる出来事）。
 * 「序盤は簡単 → 終盤は手が回らない」という起伏をここで作る。
 * 途中に救援を1つ挟み、単調な右肩下がりにしない。
 */
export type EventKind = 'variant' | 'gathering' | 'support' | 'weakImmunity';

export interface WaveEvent {
  /** 発生する時刻（開始からの秒数） */
  at: number;
  kind: EventKind;
  /** 画面に出す見出し。「です・ます」調にする */
  title: string;
  /** 何が起きるかの一行 */
  detail: string;
  tone: 'bad' | 'good';
}

/** ウェーブの効果量。モードによらず共通 */
export const WAVE_EFFECT = {
  /** 伝播力に掛ける倍率 */
  variantTransmission: 1.4,
  /** 人が中央に集まる時間（秒） */
  gatheringDuration: 9,
  /** 中央へ向かう強さ */
  gatheringPull: 1.5,
  /** 支援で戻る対策ポイント */
  supportPoints: 45,
  /** 収まったあとの耐性時間に掛ける倍率 */
  weakImmunityFactor: 0.45,
} as const;

export interface ModeDef {
  id: ModeId;
  label: string;
  /** 選択画面に出す一行 */
  tagline: string;
  /** 何が広がるのかの呼び名。「感染」「拡散」など */
  spreadNoun: string;
  /** 広げている人の呼び名。人数を数える文脈で使う */
  personNoun: string;
  /** 伝播力が上がる出来事の呼び名。「変異株」「尾ひれ」など */
  variantLabel: string;
  /** 伝播力そのものの呼び名。「感染力」など */
  powerLabel: string;
  /** 状態の呼び名 */
  states: { susceptible: string; infected: string; recovered: string };
  colors: { susceptible: string; infected: string; recovered: string };
  /** 抑制の代償になる指標の呼び名 */
  socialLabel: string;
  /** 対策の呼び名。効果そのものは3モード共通 */
  tools: Record<ToolId, { label: string; short: string; hint: string }>;
  /** 特性持ちの呼び名と一言の説明（開始画面の凡例に使う）。効果そのものは3モード共通 */
  traits: Record<TraitId, { label: string; hint: string }>;
  /**
   * 同時にこの割合まで広がったら打ち切って負けにする。
   * 未指定のモードは打ち切らず、制限時間まで続く。
   */
  collapseRatio?: number;
  /**
   * （新商品モード）同時にこの割合まで広まったらブーム到来として打ち切り、勝ちにする。
   * 未指定のモードはブーム判定をしない。
   */
  boomRatio?: number;
  tuning: Tuning;
  waves: WaveEvent[];
  /** 開始画面で色の意味を説明する文 */
  intro: string;
  /** 開始前のカウントダウン中に出す案内。色の言葉は colors.infected と食い違わないこと */
  countdownHint: string;
  /**
   * 広める側のモード（新商品）だけが持つ言葉。開始画面と結果画面で「抑える」側の言葉と差し替える。
   * 未指定のモードは、いままでどおり spreadNoun などから「抑える」側の言葉を組み立てる
   */
  spreadSide?: {
    startNote: string;
    reachLabel: string;
    peakLabel: string;
    finalLabel: string;
    totalLabel: string;
    inflowLabel: string;
    actionsLabel: string;
    unusedLabel: string;
    reachFactorLabel: string;
    socialFactorLabel: string;
    peakFactorLabel: string;
    pointsLabel: string;
    note: string;
    boomTitle: string;
    fizzleTitle: string;
  };
}

const EPIDEMIC: ModeDef = {
  id: 'epidemic',
  label: '感染症',
  tagline: '接触でうつる。基本のモードです',
  spreadNoun: '感染',
  personNoun: '感染者',
  variantLabel: '変異株',
  powerLabel: '感染力',
  states: { susceptible: '未感染', infected: '感染', recovered: '回復' },
  colors: { susceptible: '#2dd4bf', infected: '#ff2d55', recovered: '#a78bfa' },
  socialLabel: '社会活動',
  tools: {
    isolation: {
      label: '隔離エリア',
      short: '隔離',
      hint: '出入りを止めます。中の人どうしはうつり合います',
    },
    vaccine: {
      label: 'ワクチン',
      short: '接種',
      hint: '健康な人に免疫をつけ、感染者を早く回復させます',
    },
    lockdown: {
      label: 'ロックダウン',
      short: '停止',
      hint: '全員の移動と接触を8秒間抑えます',
    },
  },
  traits: {
    social: { label: 'よく人と会う人', hint: '感染が広がりやすくなります' },
    popular: { label: '人気者', hint: '周りに人が集まります' },
    medic: { label: '医療スタッフ', hint: '近くの感染が早く収まります' },
  },
  // 同時に6割5分が感染したら医療が崩壊したものとして打ち切る（段階3のバランス取り直しで7割5分から変更）
  collapseRatio: 0.65,
  tuning: {
    contactRadius: 30,
    exposureGain: 1.8,
    spreadMin: 10,
    spreadMax: 14.5,
    // 回復しても長くは守られない。放っておくと、同じ人がまた感染源になる
    resistanceDuration: 7,
    // 盤面（長辺1000）の端から端まで10秒前後で歩ける速さ。街への作り直し（2026-09-24）で
    // 従来値から約2.17倍に上げた。モード間の相対差はそのまま保っている
    speedMin: 74,
    speedMax: 126,
    turnRate: 2.2,
    activeSpeedMul: 1,
    activeTurnMul: 1,
    // 同じ場所に長く留まる接触が重く、すれ違いは軽い。職場や学校で広がる（B2）
    stayContact: 1.0,
    moveContact: 0.35,
    immunityMul: 1,
    treatMul: 1,
  },
  waves: [
    {
      at: 20,
      kind: 'variant',
      title: '感染力の高い変異株が確認されました',
      detail: '接触したときに感染しやすくなります',
      tone: 'bad',
    },
    {
      at: 35,
      kind: 'gathering',
      title: '大型イベントが始まりました',
      detail: '人が中央へ集まります',
      tone: 'bad',
    },
    {
      at: 45,
      kind: 'support',
      title: '医療支援が届きました',
      detail: '対策ポイントが回復します',
      tone: 'good',
    },
    {
      at: 60,
      kind: 'weakImmunity',
      title: '新たな変異株が広がっています',
      detail: '回復後の耐性が短くなります',
      tone: 'bad',
    },
  ],
  intro: '赤が感染者です。近づいた時間が長いほどうつります。',
  countdownHint: '赤い点の位置を確認してください',
};

const RUMOR: ModeDef = {
  id: 'rumor',
  label: '噂話',
  tagline: '遠くまで一瞬で届く。飽きるのも早いです',
  spreadNoun: '拡散',
  personNoun: '拡散者',
  variantLabel: '尾ひれ',
  powerLabel: '広まりやすさ',
  states: { susceptible: '知らない', infected: '噂している', recovered: '飽きた' },
  colors: { susceptible: '#38bdf8', infected: '#fbbf24', recovered: '#64748b' },
  socialLabel: '世間の信頼',
  tools: {
    isolation: {
      label: '箝口令',
      short: '箝口令',
      hint: '噂の出入りを止めます。中では話が回ります',
    },
    vaccine: {
      label: '訂正情報',
      short: '訂正',
      hint: '範囲の人が噂を信じにくくなります',
    },
    lockdown: {
      label: '全体アナウンス',
      short: '告知',
      hint: '街全体の話題を8秒間そらします',
    },
  },
  traits: {
    social: { label: '話し好き', hint: '噂が広がりやすくなります' },
    popular: { label: '顔の広い人', hint: '周りに人が集まります' },
    medic: { label: '記者', hint: '近くの噂が早く収まります' },
  },
  // 同時に6割3分が噂をしていたら、収拾不能として打ち切る（段階3のバランス取り直しで7割5分から変更）
  collapseRatio: 0.63,
  tuning: {
    // 噂は離れていても伝わる。そのぶん1回の接触は弱い
    contactRadius: 44,
    exposureGain: 1.45,
    // 飽きるより前に、聞いた人がまた話す時間を確保する
    // （放置すると鎮火が早すぎたため、やや伸ばした）
    spreadMin: 8.5,
    spreadMax: 12.5,
    // 飽きてもそこそこ早く戻ってくる。噂は一度で終わらない
    resistanceDuration: 12,
    // epidemic と同じ比率（約2.17倍）で引き上げてある
    speedMin: 87,
    speedMax: 157,
    turnRate: 2.6,
    activeSpeedMul: 1.1,
    // 噂している人はあちこち動き回る
    activeTurnMul: 1.9,
    // 噂は場所を選ばず、離れていても伝わる。留まっていてもすれ違いでもほぼ同じ重みにする（B2）
    stayContact: 1.0,
    moveContact: 0.6,
    // 訂正情報は、まだ聞いていない人への予防がよく効き、すでに噂している人を止める効きは弱い（C2）
    immunityMul: 0.6,
    treatMul: 1.4,
    },
  waves: [
    {
      at: 18,
      kind: 'variant',
      title: '尾ひれが付きました',
      detail: '噂が信じられやすくなります',
      tone: 'bad',
    },
    {
      at: 32,
      kind: 'gathering',
      title: '井戸端会議が始まりました',
      detail: '人が中央へ集まります',
      tone: 'bad',
    },
    {
      at: 44,
      kind: 'support',
      title: '有力者が否定してくれました',
      detail: '対策ポイントが回復します',
      tone: 'good',
    },
    {
      at: 58,
      kind: 'weakImmunity',
      title: '別の噂が混ざり始めました',
      detail: '飽きても、すぐまた話し始めます',
      tone: 'bad',
    },
  ],
  intro: '黄が噂をしている人です。離れていても伝わります。',
  countdownHint: '黄色い点の位置を確認してください',
};

const ANGER: ModeDef = {
  id: 'anger',
  label: '悪感情',
  tagline: '怒った人は速く突き進む。すぐ再燃します',
  spreadNoun: '炎上',
  personNoun: '怒った人',
  variantLabel: '蒸し返し',
  powerLabel: '移りやすさ',
  states: { susceptible: '平静', infected: '怒り', recovered: '冷めた' },
  colors: { susceptible: '#4ade80', infected: '#f43f5e', recovered: '#94a3b8' },
  socialLabel: '街の空気',
  tools: {
    isolation: {
      label: 'クールダウン区域',
      short: '冷却',
      hint: '人の出入りを止めます。中では気持ちが伝わります',
    },
    vaccine: {
      label: '対話・仲裁',
      short: '仲裁',
      hint: '範囲の人をなだめ、怒りを早く収めます',
    },
    lockdown: {
      label: '一斉に深呼吸',
      short: '深呼吸',
      hint: '街全体の動きを8秒間止めます',
    },
  },
  traits: {
    social: { label: '火種になりやすい人', hint: '怒りが広がりやすくなります' },
    popular: { label: '目立つ人', hint: '周りに人が集まります' },
    medic: { label: '仲裁役', hint: '近くの怒りが早く収まります' },
  },
  // 同時に6割6分が怒っていたら、暴動として打ち切る（段階3のバランス取り直しで7割5分から変更）
  collapseRatio: 0.66,
  tuning: {
    contactRadius: 27,
    exposureGain: 4.5,
    spreadMin: 7.5,
    spreadMax: 11,
    // すぐ再燃する。冷めても安心できない
    resistanceDuration: 5,
    // epidemic と同じ比率（約2.17倍）で引き上げてある
    speedMin: 65,
    speedMax: 113,
    turnRate: 3,
    // 怒っている人は速く、まっすぐ突き進む
    activeSpeedMul: 1.6,
    activeTurnMul: 0.45,
    // 通りですれ違う見知らぬ人どうしが重く、同じ職場の仲間どうしは軽い。感染症・噂話と逆になる（D1）
    stayContact: 0.45,
    moveContact: 1.2,
    immunityMul: 1,
    treatMul: 1,
  },
  waves: [
    {
      at: 16,
      kind: 'variant',
      title: '火に油を注ぐ投稿が出ました',
      detail: '怒りが移りやすくなります',
      tone: 'bad',
    },
    {
      at: 30,
      kind: 'gathering',
      title: '広場に人が集まり始めました',
      detail: '人が中央へ集まります',
      tone: 'bad',
    },
    {
      at: 42,
      kind: 'support',
      title: '謝罪が受け入れられました',
      detail: '対策ポイントが回復します',
      tone: 'good',
    },
    {
      at: 56,
      kind: 'weakImmunity',
      title: '蒸し返す人が現れました',
      detail: '冷めても、すぐまた怒り出します',
      tone: 'bad',
    },
  ],
  intro: '赤が怒っている人です。速く動き、まっすぐ人に向かいます。',
  countdownHint: '赤い点の位置を確認してください',
};

/**
 * エクストラステージ「新商品」（広める側を遊ぶ。感染症の真逆）。docs/design-extra-stage.md 参照。
 *
 * 区切りE1では、モードの定義・複合的な伝染（複数の人に勧められて初めて試す）・勝ち負けと得点の
 * 裏返しまでを作る。道具の効果の裏返し（E2）と画面（E3）はまだ無い。
 * 開始画面からはまだ選べない（MODE_LIST に含めない）。
 */
const PRODUCT: ModeDef = {
  id: 'product',
  label: '新商品',
  tagline: '広める側を遊びます。真逆のモードです',
  spreadNoun: '普及',
  personNoun: '愛用者',
  variantLabel: '新展開',
  powerLabel: '広まりやすさ',
  states: { susceptible: '未体験', infected: '愛用中', recovered: '飽きた' },
  colors: { susceptible: '#94a3b8', infected: '#facc15', recovered: '#a78bfa' },
  socialLabel: '好感度',
  // 用語は仮置き。効果の裏返しはE2で作るため、この区切りでは3モード共通の効果のままである
  tools: {
    isolation: {
      label: 'イベント',
      short: 'イベント',
      hint: '周りの人を集めます。集まった人どうしで勧め合います',
    },
    vaccine: {
      label: '試供品',
      short: '試供品',
      hint: '範囲の人がその場で試します。飽きた人には効きません',
    },
    lockdown: {
      label: '広告',
      short: '広告',
      hint: '8秒間、試しやすくなります。使うほど好感度が下がります',
    },
  },
  traits: {
    social: { label: '顔の広い人', hint: '勧める相手が多くなります' },
    popular: { label: 'インフルエンサー', hint: 'その人に勧められると2人分と数えます' },
    medic: { label: '辛口レビュアー', hint: '近くの愛用が早く飽きます' },
  },
  // 崩壊ラインは持たない（打ち切りの負けは fizzle。愛用中が0人になったとき）
  // 同時に6割が愛用したらブーム到来として打ち切り、勝ちにする
  boomRatio: 0.6,
  tuning: {
    contactRadius: 30,
    // 新商品モードは複合的な伝染（accumulateRecommend）に切り替えるため、感染症側の exposure 系の値は
    // 使わない。Tuning の型を満たすためだけに epidemic と同じ値を置いている
    exposureGain: 1.8,
    // 愛用中でいる時間（＝飽きるまでの秒数）
    spreadMin: 10,
    spreadMax: 14.5,
    // 飽きてから未体験に戻るまでの秒数
    resistanceDuration: 7,
    speedMin: 74,
    speedMax: 126,
    turnRate: 2.2,
    activeSpeedMul: 1,
    activeTurnMul: 1,
    // 新商品モードでは未使用（複合的な伝染は時間の合計だけで数え、重みを付けない）
    stayContact: 1.0,
    moveContact: 0.35,
    // 新商品モードでは未使用（道具の効果はE2で作る）
    immunityMul: 1,
    treatMul: 1,
  },
  // ウェーブはこの区切りでは作らない
  waves: [],
  intro: '明るく光った人が愛用中です。何人にも勧められると試したくなります。',
  countdownHint: '光っている点が愛用中の人です。位置を確認してください',
  spreadSide: {
    startNote:
      '押しつけるほど好感度が下がり、対策ポイントの回復も鈍ります。スコアは「広めること」と「好感度を保つこと」の掛け算です。広告に頼りすぎても点になりません。',
    reachLabel: '普及率（一度でも試した人）',
    peakLabel: '最大同時愛用者',
    finalLabel: '終了時の愛用者',
    totalLabel: 'のべ愛用者',
    inflowLabel: '駅から来た人',
    actionsLabel: '使った手',
    unusedLabel: '使いませんでした',
    reachFactorLabel: '× 普及',
    socialFactorLabel: '× 好感度',
    peakFactorLabel: '× 同時愛用の補正',
    pointsLabel: '＋ 残ポイント（ブームの上乗せを含む）',
    note: '普及と好感度は掛け算です。押しつけて広めても点になりません。',
    boomTitle: '秒でブーム到来',
    fizzleTitle: '秒で途絶えました',
  },
};

export const MODES: Record<ModeId, ModeDef> = {
  epidemic: EPIDEMIC,
  rumor: RUMOR,
  anger: ANGER,
  product: PRODUCT,
};

// product はまだ開始画面から選べない（区切りE3で追加する）。ここに足すと選択肢に出てしまう
export const MODE_LIST: ModeDef[] = [EPIDEMIC, RUMOR, ANGER];

/** 開始画面で「エクストラ」として別に並べるモード。広める側を遊ぶ */
export const EXTRA_MODES: ModeDef[] = [PRODUCT];

export function modeOf(id: ModeId): ModeDef {
  return MODES[id];
}

/**
 * 時間の経過で状況を悪化させるウェーブ。
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

export const WAVES: WaveEvent[] = [
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
];

/** イベントの効果量 */
export const WAVE_EFFECT = {
  /** 変異株で感染力に掛ける倍率 */
  variantTransmission: 1.4,
  /** 大型イベントで人が中央に集まる時間（秒） */
  gatheringDuration: 9,
  /** 中央へ向かう強さ */
  gatheringPull: 1.5,
  /** 医療支援で戻る対策ポイント */
  supportPoints: 45,
  /** 変異株で回復後の耐性時間に掛ける倍率 */
  weakImmunityFactor: 0.45,
} as const;

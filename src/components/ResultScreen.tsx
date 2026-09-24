import { useEffect, useRef } from 'react';
import { modeOf } from '../sim/modes';
import type { GameResult } from '../sim/types';

interface Props {
  result: GameResult;
  onRetry(): void;
  onChangeMode(): void;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rrow ${strong ? 'rrow--strong' : ''}`}>
      <span className="rrow__label">{label}</span>
      <span className="rrow__value">{value}</span>
    </div>
  );
}

export function ResultScreen({ result, onRetry, onChangeMode }: Props) {
  const retryRef = useRef<HTMLButtonElement>(null);

  // もう一度遊ぶのが最短でできるよう、開いた時点でボタンに焦点を当てる
  useEffect(() => {
    retryRef.current?.focus();
  }, []);

  const usedTotal = result.actions.isolation + result.actions.vaccine + result.actions.lockdown;
  const b = result.breakdown;
  const def = modeOf(result.mode);
  // 広める側（新商品）は見出しの言葉を差し替える。抑える側の3モードは今までどおりに組み立てる
  const side = def.spreadSide;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <div className="panel">
        <div className={`rank rank--${result.rank}`} aria-hidden="true">
          {result.rank}
        </div>
        <p className={`verdict verdict--${result.rank}`}>{result.verdict}</p>
        <h2 className="panel__title" id="result-title">
          {result.outcome === 'collapsed'
            ? `${result.survivedSeconds} 秒でゲームオーバー`
            : result.outcome === 'boom' && side
              ? `${result.survivedSeconds} ${side.boomTitle}`
              : result.outcome === 'fizzle' && side
                ? `${result.survivedSeconds} ${side.fizzleTitle}`
                : '記録'}
        </h2>
        <p className="panel__lead">{result.comment}</p>

        <div className="rrows">
          {side ? (
            <Row label={side.reachLabel} value={`${Math.round(result.reachRatio * 100)}%`} strong />
          ) : (
            <Row
              label={`${def.spreadNoun}を抑えた割合`}
              value={`${Math.round(result.protectionRatio * 100)}%`}
              strong
            />
          )}
          <Row label={`平均${def.socialLabel}`} value={`${Math.round(result.avgSocial * 100)}`} strong />
          <Row label={side ? side.peakLabel : `${def.personNoun}のピーク`} value={`${result.peakInfected} 人`} />
          <Row label={side ? side.finalLabel : `終了時の${def.personNoun}`} value={`${result.finalInfected} 人`} />
          <Row label={side ? side.totalLabel : `のべ${def.spreadNoun}数`} value={`${result.totalInfected} 人`} />
          <Row
            label={side ? side.inflowLabel : '外部から流入'}
            value={`${result.inflowTotal} 人（最終 ${result.population} 人）`}
          />
          <Row
            label={side ? side.actionsLabel : '使用した対策'}
            value={
              usedTotal === 0
                ? side
                  ? side.unusedLabel
                  : '使いませんでした'
                : `${def.tools.isolation.short} ${result.actions.isolation} ／ ${def.tools.vaccine.short} ${result.actions.vaccine} ／ ${def.tools.lockdown.short} ${result.actions.lockdown}`
            }
          />
          <Row label="使ったポイント" value={`${result.pointsSpent}（残り ${result.pointsLeft}）`} />
        </div>

        <div className="finalscore">
          <span className="finalscore__label">スコア</span>
          <span className="finalscore__value">{result.score.toLocaleString('ja-JP')}</span>
        </div>

        <ul className="breakdown">
          <li>
            <span>基礎点</span>
            <span>{b.base.toLocaleString('ja-JP')}</span>
          </li>
          <li className={b.protectionFactor < 0.2 ? 'is-weak' : undefined}>
            <span>{side ? side.reachFactorLabel : `× ${def.spreadNoun}の抑制`}</span>
            <span>{Math.round(b.protectionFactor * 100)}%</span>
          </li>
          <li className={b.socialFactor < 0.2 ? 'is-weak' : undefined}>
            <span>{side ? side.socialFactorLabel : `× ${def.socialLabel}の維持`}</span>
            <span>{Math.round(b.socialFactor * 100)}%</span>
          </li>
          <li>
            <span>{side ? side.peakFactorLabel : `× ${def.personNoun}のピークによる補正`}</span>
            <span>{Math.round(b.peakFactor * 100)}%</span>
          </li>
          <li>
            <span>{side ? side.pointsLabel : '＋ 残ポイント'}</span>
            <span>{b.pointsBonus.toLocaleString('ja-JP')}</span>
          </li>
        </ul>
        <p className="breakdown__note">
          {side ? side.note : `抑制と${def.socialLabel}は掛け算です。どちらかが低いと点になりません。`}
        </p>

        <button ref={retryRef} type="button" className="cta" onClick={onRetry}>
          もう一度プレイ
        </button>
        <button type="button" className="cta cta--sub" onClick={onChangeMode}>
          モードを選び直す
        </button>
      </div>
    </div>
  );
}

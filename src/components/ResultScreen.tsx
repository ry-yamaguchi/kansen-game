import { useEffect, useRef } from 'react';
import type { GameResult } from '../sim/types';

interface Props {
  result: GameResult;
  onRetry(): void;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rrow ${strong ? 'rrow--strong' : ''}`}>
      <span className="rrow__label">{label}</span>
      <span className="rrow__value">{value}</span>
    </div>
  );
}

export function ResultScreen({ result, onRetry }: Props) {
  const retryRef = useRef<HTMLButtonElement>(null);

  // もう一度遊ぶのが最短でできるよう、開いた時点でボタンに焦点を当てる
  useEffect(() => {
    retryRef.current?.focus();
  }, []);

  const usedTotal = result.actions.isolation + result.actions.vaccine + result.actions.lockdown;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <div className="panel">
        <div className={`rank rank--${result.rank}`} aria-hidden="true">
          {result.rank}
        </div>
        <h2 className="panel__title" id="result-title">
          記録
        </h2>
        <p className="panel__lead">{result.comment}</p>

        <div className="rrows">
          <Row label="最終感染率" value={`${Math.round(result.infectionRate * 100)}%`} strong />
          <Row label="守れた人数" value={`${result.protectedCount} / ${result.population} 人`} strong />
          <Row label="最大同時感染者数" value={`${result.peakInfected} 人`} />
          <Row label="のべ感染者数" value={`${result.totalInfected} 人`} />
          <Row
            label="使用した対策"
            value={
              usedTotal === 0
                ? '使いませんでした'
                : `隔離 ${result.actions.isolation} ／ ワクチン ${result.actions.vaccine} ／ ロックダウン ${result.actions.lockdown}`
            }
          />
          <Row label="使ったポイント" value={`${result.pointsSpent}（残り ${result.pointsLeft}）`} />
        </div>

        <div className="finalscore">
          <span className="finalscore__label">スコア</span>
          <span className="finalscore__value">{result.score.toLocaleString('ja-JP')}</span>
        </div>

        <button ref={retryRef} type="button" className="cta" onClick={onRetry}>
          もう一度プレイ
        </button>
      </div>
    </div>
  );
}

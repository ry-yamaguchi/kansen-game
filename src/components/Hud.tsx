import { CONFIG } from '../sim/config';
import type { HudSnapshot } from '../hooks/useGame';

interface Props {
  hud: HudSnapshot;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: 'safe' | 'danger' | 'recovered' | 'plain';
}) {
  return (
    <div className={`stat stat--${tone}`}>
      <span className="stat__dot" aria-hidden="true" />
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  );
}

export function Hud({ hud }: Props) {
  const seconds = Math.ceil(hud.timeLeft);
  const infectedRatio = hud.population > 0 ? hud.infected / hud.population : 0;
  const pointRatio = Math.min(1, hud.points / CONFIG.maxPoints);
  const socialRatio = Math.max(0, Math.min(1, hud.social / CONFIG.socialMax));
  const lowSocial = hud.social < 50;
  const urgent = seconds <= 10;

  return (
    <header className="hud">
      <div className="hud__row hud__row--top">
        <div className={`timer ${urgent ? 'timer--urgent' : ''}`}>
          <span className="timer__value">{seconds}</span>
          <span className="timer__unit">秒</span>
        </div>

        <div className="stats">
          <Stat label="未感染" value={hud.susceptible} tone="safe" />
          <Stat label="感染" value={hud.infected} tone="danger" />
          <Stat label="回復" value={hud.recovered} tone="recovered" />
        </div>

        <div className="score">
          <span className="score__label">スコア</span>
          <span className="score__value">{hud.score.toLocaleString('ja-JP')}</span>
        </div>
      </div>

      <div className="hud__row hud__row--bars">
        <div className="points">
          <span className="points__label">対策ポイント</span>
          <span className="points__value">{hud.points}</span>
          <div className="points__track">
            <div className="points__fill" style={{ width: `${pointRatio * 100}%` }} />
          </div>
        </div>

        <div className={`social ${lowSocial ? 'social--low' : ''}`}>
          <span className="social__label">社会活動</span>
          <span className="social__value">{Math.round(hud.social)}</span>
          <div className="social__track">
            <div className="social__fill" style={{ width: `${socialRatio * 100}%` }} />
          </div>
        </div>

        <div className="spread" aria-hidden="true">
          <div className="spread__track">
            <div
              className="spread__fill"
              style={{ width: `${Math.min(100, infectedRatio * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

import { CONFIG } from '../sim/config';
import { modeOf } from '../sim/modes';
import type { ModeId } from '../sim/types';
import type { HudSnapshot } from '../hooks/useGame';

interface Props {
  hud: HudSnapshot;
  mode: ModeId;
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

export function Hud({ hud, mode }: Props) {
  const def = modeOf(mode);
  const seconds = Math.ceil(hud.timeLeft);
  const infectedRatio = hud.population > 0 ? hud.infected / hud.population : 0;
  const pointRatio = Math.min(1, hud.points / CONFIG.maxPoints);
  const socialRatio = Math.max(0, Math.min(1, hud.social / CONFIG.socialMax));
  const lowSocial = hud.social < 50;
  const urgent = seconds <= 10;

  const badges: { key: string; text: string; tone: string }[] = [];
  // 打ち切りが近いことは最優先で知らせる。突然終わったと感じさせない
  if (def.collapseRatio !== undefined && infectedRatio >= def.collapseRatio * 0.7) {
    const remain = Math.max(0, Math.ceil(def.collapseRatio * hud.population - hud.infected));
    badges.push({
      key: 'collapse',
      text: `崩壊まであと ${remain} 人（${Math.round(def.collapseRatio * 100)}% で打ち切り）`,
      tone: 'bad',
    });
  }
  if (hud.transmissionMul > 1.01) {
    badges.push({
      key: 'variant',
      text: `変異株　感染力 ×${hud.transmissionMul.toFixed(1)}`,
      tone: 'bad',
    });
  }
  if (hud.resistanceMul < 0.99) {
    badges.push({
      key: 'weak',
      text: `変異株　回復後の耐性 ${Math.round(hud.resistanceMul * 100)}%`,
      tone: 'bad',
    });
  }
  if (hud.gatherTimer > 0) {
    badges.push({
      key: 'gather',
      text: `大型イベント　あと ${Math.ceil(hud.gatherTimer)} 秒`,
      tone: 'warn',
    });
  }
  if (hud.lockdownTimer > 0) {
    badges.push({
      key: 'lockdown',
      text: `ロックダウン中　あと ${Math.ceil(hud.lockdownTimer)} 秒`,
      tone: 'info',
    });
  }
  if (hud.zones > 0) {
    badges.push({
      key: 'zones',
      text: `隔離 ${hud.zones} / ${CONFIG.maxZones}`,
      tone: 'zone',
    });
  }

  return (
    <header className="hud">
      <div className="hud__row hud__row--top">
        <div className={`timer ${urgent ? 'timer--urgent' : ''}`}>
          <span className="timer__value">{seconds}</span>
          <span className="timer__unit">秒</span>
        </div>

        <div className="stats">
          <Stat label={def.states.susceptible} value={hud.susceptible} tone="safe" />
          <Stat label={def.states.infected} value={hud.infected} tone="danger" />
          <Stat label={def.states.recovered} value={hud.recovered} tone="recovered" />
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
          <span className="social__label">{def.socialLabel}</span>
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

      {/* 変異株などの効果は通知が消えたあとも続く。効いている間ずっと見せる */}
      {badges.length > 0 ? (
        <div className="badges">
          {badges.map((b) => (
            <span key={b.key} className={`badge badge--${b.tone}`}>
              {b.text}
            </span>
          ))}
        </div>
      ) : null}
    </header>
  );
}

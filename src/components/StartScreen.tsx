import { useEffect, useRef } from 'react';
import { CONFIG } from '../sim/config';
import { EXTRA_MODES, MODE_LIST, modeOf } from '../sim/modes';
import type { ModeId } from '../sim/types';

interface Props {
  mode: ModeId;
  onSelectMode(id: ModeId): void;
  onStart(): void;
}

export function StartScreen({ mode, onSelectMode, onStart }: Props) {
  const def = modeOf(mode);
  const startRef = useRef<HTMLButtonElement>(null);

  // Enter ですぐ始められるよう開始ボタンに焦点を当てる。ただしスクロールはさせない。
  // 画面が低いと、焦点に合わせて下まで流れ、上にあるモードの選択肢が見えなくなるため
  useEffect(() => {
    startRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="start-title">
      <div className="panel">
        <p className="panel__eyebrow">感染るラボ</p>
        <h2 className="panel__title" id="start-title">
          何を広げないか、選んでください
        </h2>

        <div className="modes" role="radiogroup" aria-label="モード">
          {MODE_LIST.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === mode}
              className={`mode ${m.id === mode ? 'is-selected' : ''}`}
              onClick={() => onSelectMode(m.id)}
            >
              <span className="mode__dots" aria-hidden="true">
                <i style={{ background: m.colors.susceptible }} />
                <i style={{ background: m.colors.infected }} />
                <i style={{ background: m.colors.recovered }} />
              </span>
              <span className="mode__name">{m.label}</span>
              <span className="mode__tag">{m.tagline}</span>
            </button>
          ))}
        </div>
        <p className="modes__extra-title">エクストラ — 今度は広める側です</p>
        <div className="modes modes--extra" role="radiogroup" aria-label="エクストラのモード">
          {EXTRA_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === mode}
              className={`mode mode--extra ${m.id === mode ? 'is-selected' : ''}`}
              onClick={() => onSelectMode(m.id)}
            >
              <span className="mode__dots" aria-hidden="true">
                <i style={{ background: m.colors.susceptible }} />
                <i style={{ background: m.colors.infected }} />
                <i style={{ background: m.colors.recovered }} />
              </span>
              <span className="mode__name">{m.label}</span>
              <span className="mode__tag">{m.tagline}</span>
            </button>
          ))}
        </div>

        <p className="panel__lead">
          {def.intro}{' '}
          <span style={{ color: def.colors.susceptible }}>{def.states.susceptible}</span> ／{' '}
          <span style={{ color: def.colors.infected }}>{def.states.infected}</span> ／{' '}
          <span style={{ color: def.colors.recovered }}>{def.states.recovered}</span> の3状態です。
          {def.states.recovered}になっても、しばらくすると
          {def.states.susceptible}に戻ります。
        </p>

        <ul className="traits" aria-label="特性を持つ人の見分け方">
          <li>
            <span className="traits__icon" aria-hidden="true">
              ◌
            </span>
            {def.traits.social.label} — {def.traits.social.hint}
          </li>
          <li>
            <span className="traits__icon" aria-hidden="true">
              ★
            </span>
            {def.traits.popular.label} — {def.traits.popular.hint}
          </li>
          <li>
            <span className="traits__icon" aria-hidden="true">
              ✚
            </span>
            {def.traits.medic.label} — {def.traits.medic.hint}
          </li>
        </ul>

        <p className="panel__note">
          街には住宅・学校・職場・広場・駅があります。朝は学校や職場へ、昼は広場へ、
          夕方は家へと、時間帯によって人が街を行き来します。
        </p>

        <ol className="howto">
          <li>下のボタンで対策を選びます</li>
          <li>画面を押したまま動かすと、効果の範囲が見えます</li>
          <li>指を離すと、そこに対策を打ちます</li>
        </ol>

        <p className="panel__note">
          {def.spreadSide ? (
            def.spreadSide.startNote
          ) : (
            <>
              抑え込むほど{def.socialLabel}が下がり、対策ポイントの回復も鈍ります。
              スコアは「抑えること」と「{def.socialLabel}を保つこと」の掛け算です。
              どちらかに振り切っても点になりません。
            </>
          )}
        </p>

        <button ref={startRef} type="button" className="cta" onClick={onStart}>
          {CONFIG.duration} 秒で開始
        </button>
      </div>
    </div>
  );
}

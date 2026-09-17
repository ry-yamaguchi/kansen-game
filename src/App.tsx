import { useRef } from 'react';
import { ActionBar } from './components/ActionBar';
import { Hud } from './components/Hud';
import { ResultScreen } from './components/ResultScreen';
import { StartScreen } from './components/StartScreen';
import { useGame } from './hooks/useGame';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useGame(canvasRef);
  const { hud, phase } = game;

  return (
    <div className={`app ${hud.danger > 0.6 ? 'app--alert' : ''}`}>
      <Hud hud={hud} />

      <main className="stage">
        <canvas
          ref={canvasRef}
          className="board"
          role="img"
          aria-label={`街の様子。未感染 ${hud.susceptible} 人、感染 ${hud.infected} 人、回復 ${hud.recovered} 人。`}
          onPointerDown={game.onPointerDown}
          onPointerMove={game.onPointerMove}
          onPointerUp={game.onPointerUp}
          onPointerCancel={game.onPointerUp}
          onPointerLeave={game.onPointerLeave}
        />

        <div className="toasts" aria-live="polite">
          {game.toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.tone}`}>
              {t.text}
            </div>
          ))}
        </div>

        {game.countdown >= 0 ? (
          <div className="countdown" aria-live="assertive">
            <span key={game.countdown} className="countdown__value">
              {game.countdown === 0 ? 'START' : game.countdown}
            </span>
            {game.countdown > 0 ? (
              <span className="countdown__hint">赤い点の位置を確認してください</span>
            ) : null}
          </div>
        ) : null}

        {game.notice ? (
          <div
            key={game.notice.id}
            className={`notice notice--${game.notice.tone}`}
            role="status"
            aria-live="polite"
          >
            <strong className="notice__title">{game.notice.title}</strong>
            <span className="notice__detail">{game.notice.detail}</span>
          </div>
        ) : null}

        {phase === 'ready' ? <StartScreen onStart={game.start} /> : null}
        {phase === 'finished' && game.result ? (
          <ResultScreen result={game.result} onRetry={game.start} />
        ) : null}
      </main>

      <ActionBar
        hud={hud}
        tool={game.tool}
        disabled={phase !== 'playing' && phase !== 'countdown'}
        onSelect={game.selectTool}
        onLockdown={game.useLockdown}
        /* カウントダウン中も選べるようにして、初手を構えておけるようにする */
      />
    </div>
  );
}

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

        {phase === 'ready' ? <StartScreen onStart={game.start} /> : null}
        {phase === 'finished' && game.result ? (
          <ResultScreen result={game.result} onRetry={game.start} />
        ) : null}
      </main>

      <ActionBar
        hud={hud}
        tool={game.tool}
        disabled={phase !== 'playing'}
        onSelect={game.selectTool}
        onLockdown={game.useLockdown}
      />
    </div>
  );
}

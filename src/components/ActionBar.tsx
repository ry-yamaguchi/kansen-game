import { CONFIG, TOOLS } from '../sim/config';
import { modeOf } from '../sim/modes';
import type { HudSnapshot } from '../hooks/useGame';
import type { ModeId, ToolId } from '../sim/types';

interface Props {
  hud: HudSnapshot;
  mode: ModeId;
  tool: ToolId | null;
  disabled: boolean;
  onSelect(id: ToolId | null): void;
  onLockdown(): void;
}

export function ActionBar({ hud, mode, tool, disabled, onSelect, onLockdown }: Props) {
  const words = modeOf(mode).tools;
  return (
    <nav className="actions" aria-label="対策">
      {TOOLS.map((base) => {
        // 効果は共通で、呼び名だけモードごとに差し替える
        const meta = { ...base, ...words[base.id] };
        const affordable = hud.points >= meta.cost;
        const cooling = meta.id === 'lockdown' && hud.lockdownCooldown > 0;
        const selected = tool === meta.id;
        const unusable = disabled || !affordable || cooling;

        return (
          <button
            key={meta.id}
            type="button"
            className={`action action--${meta.id} ${selected ? 'is-selected' : ''} ${
              unusable ? 'is-unusable' : ''
            }`}
            aria-pressed={meta.placeable ? selected : undefined}
            aria-label={`${meta.label} コスト${meta.cost}ポイント。${meta.hint}`}
            disabled={disabled}
            onClick={() => {
              if (meta.id === 'lockdown') {
                onLockdown();
                return;
              }
              onSelect(selected ? null : meta.id);
            }}
          >
            <span className="action__head">
              {/* 狭い画面では折り返して2行になるため、短い呼び名に切り替える */}
              <span className="action__name">
                <span className="action__full">{meta.label}</span>
                <span className="action__short">{meta.short}</span>
              </span>
              <span className="action__cost">{meta.cost}</span>
            </span>
            <span className="action__hint">{meta.hint}</span>
            {cooling ? (
              <span className="action__cool">
                あと {Math.ceil(hud.lockdownCooldown)} 秒
                <span
                  className="action__coolbar"
                  style={{
                    width: `${
                      (1 -
                        hud.lockdownCooldown /
                          (CONFIG.lockdownCooldown + CONFIG.lockdownDuration)) *
                      100
                    }%`,
                  }}
                />
              </span>
            ) : null}
            {meta.placeable && selected ? (
              <span className="action__ready">タップした場所に設置します</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

import { CONFIG, TOOLS } from '../sim/config';
import type { HudSnapshot } from '../hooks/useGame';
import type { ToolId } from '../sim/types';

interface Props {
  hud: HudSnapshot;
  tool: ToolId | null;
  disabled: boolean;
  onSelect(id: ToolId | null): void;
  onLockdown(): void;
}

export function ActionBar({ hud, tool, disabled, onSelect, onLockdown }: Props) {
  return (
    <nav className="actions" aria-label="対策">
      {TOOLS.map((meta) => {
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
              <span className="action__name">{meta.label}</span>
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

import React, { useCallback, useState } from 'react';
import { Dices, EyeOff, Minus, Plus, Send, Terminal } from 'lucide-react';
import type { QuickDiceBarProps } from '@/lib/componentProps';
import { useCampaignStore } from '@/lib/store';

interface QuickDieDef {
  id: string;
  label: string;
  baseFormula: string;
  primaryFor?: string;
}

const QUICK_DICE: QuickDieDef[] = [
  { id: '2d6', label: '2d6', baseFormula: '2d6', primaryFor: 'mighty-blade-3e' },
  { id: 'd4', label: 'd4', baseFormula: '1d4' },
  { id: 'd6', label: 'd6', baseFormula: '1d6' },
  { id: 'd8', label: 'd8', baseFormula: '1d8' },
  { id: 'd10', label: 'd10', baseFormula: '1d10' },
  { id: 'd12', label: 'd12', baseFormula: '1d12' },
  { id: 'd20', label: 'd20', baseFormula: '1d20', primaryFor: 'generic-rpg' },
  { id: 'd100', label: 'd100', baseFormula: '1d100' },
];

export const QuickDiceBar: React.FC<QuickDiceBarProps> = ({
  activeCharacter,
  systemId,
  compact = false,
}) => {
  const { rollDice, isGm } = useCampaignStore();
  const [modifier, setModifier] = useState(0);
  const [customFormula, setCustomFormula] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(!compact);
  const [secretRoll, setSecretRoll] = useState(false);

  const fireRoll = useCallback(
    (formula: string, label: string) => {
      const trimmed = formula.trim();
      if (!trimmed) return;
      rollDice({
        formula: trimmed,
        label,
        characterId: activeCharacter?.id,
        visibility: isGm && secretRoll ? 'gm_only' : 'all_players',
      });
    },
    [rollDice, activeCharacter?.id, isGm, secretRoll]
  );

  const handleQuickDie = useCallback(
    (die: QuickDieDef) => {
      const modSuffix = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : '';
      const formula = `${die.baseFormula}${modSuffix}`;
      const label =
        die.id === '2d6' && systemId === 'mighty-blade-3e'
          ? `Teste Rápido (${formula})`
          : `Rolagem ${formula}`;
      fireRoll(formula, label);
    },
    [modifier, systemId, fireRoll]
  );

  const handleCustomSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const cleaned = customFormula.trim().replace(/^\/r(oll)?\s+/i, '');
      if (!cleaned) return;
      fireRoll(cleaned, `Fórmula (${cleaned})`);
      setCustomFormula('');
      if (compact) setShowCustomInput(false);
    },
    [customFormula, fireRoll, compact]
  );

  const btnHeight = compact ? 36 : 30;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: compact ? '6px 8px' : '6px 10px',
        background: 'rgba(12, 15, 20, 0.92)',
        borderTop: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* Primary 1-tap dice strip (horizontally scrollable on narrow mobile screens) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <span
          title="Rolagem rápida de dados"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            color: 'var(--gold-500)',
            paddingRight: 2,
            flexShrink: 0,
          }}
        >
          <Dices size={15} />
        </span>

        {QUICK_DICE.map((die) => {
          const isPrimary =
            die.primaryFor === systemId ||
            (!systemId && die.id === '2d6');
          return (
            <button
              key={die.id}
              type="button"
              onClick={() => handleQuickDie(die)}
              title={`Rolar ${die.baseFormula}${modifier !== 0 ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`}
              style={{
                height: btnHeight,
                minWidth: isPrimary ? (compact ? 48 : 44) : compact ? 40 : 36,
                padding: '0 8px',
                borderRadius: 'var(--radius-xs)',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 100ms ease, background 140ms ease, border-color 140ms ease',
                background: isPrimary
                  ? 'linear-gradient(135deg, rgba(212, 168, 79, 0.95), rgba(176, 134, 51, 0.95))'
                  : 'var(--bg-elevated)',
                color: isPrimary ? 'var(--text-inverse)' : 'var(--text-primary)',
                border: isPrimary
                  ? '1px solid rgba(242, 204, 123, 0.8)'
                  : '1px solid var(--border-default)',
                boxShadow: isPrimary ? '0 0 12px rgba(212, 168, 79, 0.25)' : 'none',
              }}
            >
              {die.label}
            </button>
          );
        })}

        {/* Divider */}
        <div
          style={{
            width: 1,
            height: 20,
            background: 'var(--border-subtle)',
            margin: '0 2px',
            flexShrink: 0,
          }}
        />

        {/* Modifier stepper */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: btnHeight,
            borderRadius: 'var(--radius-xs)',
            border: '1px solid var(--border-default)',
            background: 'var(--bg-obsidian)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setModifier((m) => Math.max(-20, m - 1))}
            aria-label="Diminuir modificador"
            title="Diminuir modificador"
            style={{
              width: compact ? 30 : 24,
              height: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            onClick={() => setModifier(0)}
            title="Clique para zerar modificador"
            style={{
              minWidth: 32,
              height: '100%',
              padding: '0 4px',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color:
                modifier > 0
                  ? 'var(--emerald-400)'
                  : modifier < 0
                    ? 'var(--crimson-400)'
                    : 'var(--text-muted)',
              borderLeft: '1px solid var(--border-subtle)',
              borderRight: '1px solid var(--border-subtle)',
            }}
          >
            {modifier >= 0 ? `+${modifier}` : modifier}
          </button>
          <button
            type="button"
            onClick={() => setModifier((m) => Math.min(30, m + 1))}
            aria-label="Aumentar modificador"
            title="Aumentar modificador"
            style={{
              width: compact ? 30 : 24,
              height: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            <Plus size={12} />
          </button>
        </div>

        {/* Toggle custom formula input on compact mobile */}
        {compact && (
          <button
            type="button"
            onClick={() => setShowCustomInput((v) => !v)}
            title="Fórmula personalizada (ex: 3d6+2)"
            aria-label="Fórmula personalizada"
            style={{
              height: btnHeight,
              minWidth: 36,
              padding: '0 8px',
              borderRadius: 'var(--radius-xs)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              background: showCustomInput ? 'var(--gold-soft)' : 'var(--bg-elevated)',
              border: `1px solid ${showCustomInput ? 'var(--border-gold)' : 'var(--border-default)'}`,
              color: showCustomInput ? 'var(--gold-400)' : 'var(--text-secondary)',
            }}
          >
            <Terminal size={14} />
          </button>
        )}

        {/* Inline custom formula form on desktop */}
        {!compact && (
          <form
            onSubmit={handleCustomSubmit}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 'auto',
              flexShrink: 0,
            }}
          >
            <input
              type="text"
              value={customFormula}
              onChange={(e) => setCustomFormula(e.target.value)}
              placeholder="3d6+2..."
              aria-label="Fórmula personalizada de dados"
              style={{
                width: 96,
                height: btnHeight,
                padding: '0 8px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--bg-obsidian)',
                border: '1px solid var(--border-default)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-primary)',
              }}
            />
            <button
              type="submit"
              disabled={!customFormula.trim()}
              title="Rolar fórmula"
              aria-label="Rolar fórmula"
              style={{
                height: btnHeight,
                width: btnHeight,
                borderRadius: 'var(--radius-xs)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                color: 'var(--gold-400)',
              }}
            >
              <Send size={13} />
            </button>
          </form>
        )}

        {/* GM Secret Roll Toggle */}
        {isGm && (
          <button
            type="button"
            onClick={() => setSecretRoll((s) => !s)}
            aria-pressed={secretRoll}
            title={
              secretRoll
                ? 'Rolagem Secreta do Mestre ATIVA (somente Mestre vê)'
                : 'Ativar Rolagem Secreta do Mestre'
            }
            style={{
              height: btnHeight,
              padding: '0 9px',
              borderRadius: 'var(--radius-xs)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
              background: secretRoll ? 'var(--amethyst-soft)' : 'var(--bg-elevated)',
              border: `1px solid ${secretRoll ? 'rgba(192, 132, 252, 0.6)' : 'var(--border-default)'}`,
              color: secretRoll ? 'var(--amethyst-400)' : 'var(--text-secondary)',
            }}
          >
            <EyeOff size={13} />
            {!compact && <span>{secretRoll ? 'Secreta' : 'GM'}</span>}
          </button>
        )}
      </div>

      {/* Expandable custom formula row on compact/mobile */}
      {compact && showCustomInput && (
        <form
          onSubmit={handleCustomSubmit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <input
            type="text"
            value={customFormula}
            onChange={(e) => setCustomFormula(e.target.value)}
            placeholder="Fórmula (ex: 3d6+2, 2d20kh1)..."
            aria-label="Fórmula personalizada de dados"
            className="mesa-input"
            style={{
              height: 36,
              padding: '0 10px',
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
            }}
          />
          <button
            type="submit"
            disabled={!customFormula.trim()}
            className="mesa-btn mesa-btn--gold mesa-btn--sm"
            style={{ minHeight: 36, padding: '0 12px', flexShrink: 0 }}
          >
            <Send size={13} />
            <span>Rolar</span>
          </button>
        </form>
      )}
    </div>
  );
};

export default QuickDiceBar;

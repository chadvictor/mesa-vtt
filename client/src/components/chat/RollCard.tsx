import React, { useMemo, useState } from 'react';
import {
  Check,
  Crosshair,
  Dices,
  Flame,
  Heart,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-react';
import { getSystemEngine } from '@systems/registry';
import type {
  ChatMessage,
  InteractiveAction,
  RolledDie,
  RollOutcome,
} from '@systems/types';
import { useCampaignStore } from '@/lib/store';

export interface RollCardProps {
  message: ChatMessage;
  compact?: boolean;
}

function getDieHighlight(die: RolledDie): 'max' | 'min' | 'normal' {
  if (die.dropped) return 'normal';
  if (die.value === die.sides) return 'max';
  if (die.value === 1) return 'min';
  return 'normal';
}

function getActionToneStyle(style: InteractiveAction['style']): React.CSSProperties {
  switch (style) {
    case 'damage':
      return {
        background: 'rgba(239, 68, 68, 0.16)',
        borderColor: 'rgba(239, 68, 68, 0.45)',
        color: '#fca5a5',
      };
    case 'heal':
      return {
        background: 'rgba(34, 197, 94, 0.16)',
        borderColor: 'rgba(34, 197, 94, 0.45)',
        color: '#86efac',
      };
    case 'mana':
      return {
        background: 'rgba(59, 130, 246, 0.16)',
        borderColor: 'rgba(59, 130, 246, 0.45)',
        color: '#93c5fd',
      };
    case 'condition':
      return {
        background: 'rgba(168, 85, 247, 0.16)',
        borderColor: 'rgba(168, 85, 247, 0.45)',
        color: '#d8b4fe',
      };
    case 'roll':
      return {
        background: 'rgba(212, 168, 79, 0.16)',
        borderColor: 'rgba(212, 168, 79, 0.45)',
        color: '#f2cc7b',
      };
    default:
      return {
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-default)',
        color: 'var(--text-primary)',
      };
  }
}

function renderActionIcon(action: InteractiveAction) {
  switch (action.actionType) {
    case 'apply_damage':
      return <Swords size={13} />;
    case 'apply_heal':
      return <Heart size={13} />;
    case 'spend_mana':
      return <Zap size={13} />;
    case 'apply_condition':
      return <Flame size={13} />;
    case 'roll_followup':
      return <Dices size={13} />;
    default:
      return <Sparkles size={13} />;
  }
}

export function RollCard({ message, compact = false }: RollCardProps) {
  const {
    campaign,
    characters,
    activeCharacter,
    targetCharacter,
    executeChatAction,
    rollDice,
    patchCharacter,
    sendChat,
    pushToast,
    user,
  } = useCampaignStore();

  const roll = message.roll;
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [localExecuted, setLocalExecuted] = useState<Record<string, string>>({});
  const [showQuickApply, setShowQuickApply] = useState(false);

  const systemId = campaign?.systemId ?? 'mighty-blade-3e';
  const engine = useMemo(() => getSystemEngine(systemId), [systemId]);

  const actor = useMemo(
    () => characters.find((c) => c.id === message.characterId) ?? activeCharacter ?? undefined,
    [characters, message.characterId, activeCharacter]
  );

  const meta = (roll?.systemMeta ?? {}) as Record<string, unknown>;
  const defaultTargetId =
    (typeof meta.targetCharacterId === 'string' && meta.targetCharacterId) ||
    targetCharacter?.id ||
    '';

  const effectiveTargetId = selectedTargetId || defaultTargetId;
  const resolvedTarget = useMemo(
    () => characters.find((c) => c.id === effectiveTargetId) ?? undefined,
    [characters, effectiveTargetId]
  );

  const evaluated = useMemo(() => {
    if (!roll) return null;
    return engine.resolveRollOutcome(roll, actor, resolvedTarget);
  }, [engine, roll, actor, resolvedTarget]);

  if (!roll) return null;

  const outcome: RollOutcome | undefined = roll.outcome ?? evaluated?.outcome;
  const serverActions = message.actions && message.actions.length > 0 ? message.actions : [];
  const actions: InteractiveAction[] =
    serverActions.length > 0 ? serverActions : (evaluated?.actions ?? []);

  const isCrit = outcome?.kind === 'critical';
  const isFumble = outcome?.kind === 'fumble';
  const isSuccess = outcome?.kind === 'success';
  const isFailure = outcome?.kind === 'failure';

  const manaSpent =
    typeof meta.manaCost === 'number' && meta.manaCost > 0
      ? meta.manaCost
      : typeof meta.manaSpent === 'number' && meta.manaSpent > 0
        ? meta.manaSpent
        : 0;
  const manaAlreadySpent = Boolean(meta.manaAlreadySpent);

  const isDamageRoll =
    meta.kind === 'damage' ||
    roll.label.toLowerCase().includes('dano') ||
    typeof meta.criticalMultiplier === 'number';
  const isHealRoll = meta.kind === 'heal' || roll.label.toLowerCase().includes('cura');

  const cardBorder = isCrit
    ? 'rgba(242, 204, 123, 0.8)'
    : isFumble
      ? 'rgba(239, 68, 68, 0.72)'
      : isSuccess
        ? 'rgba(34, 197, 94, 0.45)'
        : isFailure
          ? 'rgba(239, 68, 68, 0.35)'
          : 'var(--border-gold)';

  const cardBg = isCrit
    ? 'linear-gradient(155deg, rgba(212, 168, 79, 0.16) 0%, rgba(20, 25, 34, 0.96) 55%)'
    : isFumble
      ? 'linear-gradient(155deg, rgba(239, 68, 68, 0.15) 0%, rgba(20, 25, 34, 0.96) 55%)'
      : 'linear-gradient(160deg, rgba(27, 34, 48, 0.92) 0%, rgba(15, 19, 27, 0.96) 100%)';

  const handleActionClick = (action: InteractiveAction) => {
    const isServerAction = serverActions.some((a) => a.id === action.id);
    const targetId = selectedTargetId || action.targetCharacterId || effectiveTargetId;
    const targetChar = characters.find((c) => c.id === targetId);

    if (action.actionType === 'roll_followup') {
      const formula = String(action.payload.formula ?? '1d6');
      const label = String(action.payload.label ?? `Dano · ${roll.label}`);
      const mult = Number(action.payload.criticalMultiplier ?? 1);
      rollDice({
        formula: mult > 1 ? `(${formula}) * ${mult}` : formula,
        label,
        characterId: message.characterId ?? activeCharacter?.id,
        targetCharacterId: targetId || undefined,
        systemMeta: {
          ...action.payload,
          kind: label.toLowerCase().includes('cura') ? 'heal' : 'damage',
          targetCharacterId: targetId || undefined,
          targetName: targetChar?.name,
        },
      });
      setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
      return;
    }

    // If it's a persisted server action and target wasn't overridden, run through WS
    if (isServerAction && (!selectedTargetId || selectedTargetId === action.targetCharacterId)) {
      executeChatAction(message.id, action.id);
      return;
    }

    // Execute directly via system engine + character.patch
    if (action.actionType === 'apply_damage') {
      if (!targetChar) {
        pushToast('Selecione um alvo para aplicar o dano.', 'warning');
        setShowQuickApply(true);
        return;
      }
      const amount = Math.max(0, Number(action.payload.amount ?? roll.total));
      const dmgType = typeof action.payload.damageType === 'string' ? action.payload.damageType : undefined;
      const patch = engine.applyDamage(targetChar, amount, dmgType);
      patchCharacter(targetChar.id, patch);
      sendChat({
        kind: 'combat_action',
        content: `${targetChar.name} sofreu ${amount} de dano${dmgType ? ` (${dmgType})` : ''}.`,
      });
      setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
      pushToast(`Aplicado ${amount} de dano em ${targetChar.name}.`, 'success');
      return;
    }

    if (action.actionType === 'apply_heal') {
      const healTarget = targetChar ?? actor;
      if (!healTarget) {
        pushToast('Selecione um personagem para aplicar cura.', 'warning');
        setShowQuickApply(true);
        return;
      }
      const amount = Math.max(0, Number(action.payload.amount ?? roll.total));
      const patch = engine.applyHealing(healTarget, amount);
      patchCharacter(healTarget.id, patch);
      sendChat({
        kind: 'combat_action',
        content: `${healTarget.name} recuperou ${amount} PV.`,
      });
      setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
      pushToast(`Curado ${amount} PV em ${healTarget.name}.`, 'success');
      return;
    }

    if (action.actionType === 'spend_mana') {
      if (!actor) {
        pushToast('Nenhum personagem ativo para descontar PM.', 'warning');
        return;
      }
      const amount = Math.max(0, Number(action.payload.amount ?? manaSpent));
      const res = engine.spendMana(actor, amount);
      if (res.error || !res.patch) {
        pushToast(res.error ?? 'Mana insuficiente.', 'error');
        return;
      }
      patchCharacter(actor.id, res.patch);
      setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
      pushToast(`${actor.name} gastou ${amount} PM.`, 'info');
      return;
    }

    if (action.actionType === 'apply_condition') {
      const condTarget = targetChar ?? actor;
      if (!condTarget) {
        pushToast('Selecione um alvo para aplicar a condição.', 'warning');
        setShowQuickApply(true);
        return;
      }
      const conditionId = String(action.payload.conditionId ?? '');
      const rounds = typeof action.payload.rounds === 'number' ? action.payload.rounds : undefined;
      if (!conditionId) return;
      const patch = engine.applyCondition(condTarget, conditionId, rounds);
      patchCharacter(condTarget.id, patch);
      sendChat({
        kind: 'combat_action',
        content: `${condTarget.name} recebeu a condição ${conditionId}.`,
      });
      setLocalExecuted((prev) => ({ ...prev, [action.id]: user.displayName }));
      pushToast(`Condição aplicada em ${condTarget.name}.`, 'info');
    }
  };

  const handleQuickApplyAmount = (kind: 'damage' | 'heal') => {
    const targetChar =
      characters.find((c) => c.id === effectiveTargetId) ??
      (kind === 'heal' ? actor : undefined);
    if (!targetChar) {
      pushToast('Escolha um personagem no seletor de alvo acima.', 'warning');
      return;
    }
    const amount = Math.max(0, Math.floor(roll.total));
    const patch =
      kind === 'damage'
        ? engine.applyDamage(targetChar, amount)
        : engine.applyHealing(targetChar, amount);
    patchCharacter(targetChar.id, patch);
    sendChat({
      kind: 'combat_action',
      content:
        kind === 'damage'
          ? `${targetChar.name} sofreu ${amount} de dano.`
          : `${targetChar.name} recuperou ${amount} PV.`,
    });
    pushToast(
      kind === 'damage'
        ? `-${amount} PV aplicado em ${targetChar.name}`
        : `+${amount} PV curado em ${targetChar.name}`,
      'success'
    );
  };

  const hasApplyDamageAction = actions.some((a) => a.actionType === 'apply_damage');
  const hasApplyHealAction = actions.some((a) => a.actionType === 'apply_heal');

  return (
    <div
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        borderRadius: 'var(--radius-md)',
        padding: compact ? '10px 11px' : '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        boxShadow: isCrit
          ? '0 0 22px rgba(212, 168, 79, 0.22)'
          : isFumble
            ? '0 0 18px rgba(239, 68, 68, 0.2)'
            : 'var(--shadow-sm)',
      }}
    >
      {/* Dramatic Crit / Fumble Banner */}
      {isCrit && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 'var(--radius-xs)',
            background: 'linear-gradient(90deg, rgba(212,168,79,0.28), rgba(242,204,123,0.42), rgba(212,168,79,0.28))',
            border: '1px solid rgba(242, 204, 123, 0.7)',
            color: '#fef3c7',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          <Sparkles size={14} />
          <span>{outcome?.badgeText ?? 'CRÍTICO! (2× Dano)'}</span>
        </div>
      )}

      {isFumble && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 'var(--radius-xs)',
            background: 'linear-gradient(90deg, rgba(220,38,38,0.25), rgba(239,68,68,0.42), rgba(220,38,38,0.25))',
            border: '1px solid rgba(248, 113, 113, 0.65)',
            color: '#fee2e2',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          <Skull size={14} />
          <span>{outcome?.badgeText ?? 'FALHA CRÍTICA!'}</span>
        </div>
      )}

      {/* Header: Roll label + formula + PM cost */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Dices size={15} style={{ color: 'var(--gold-400)', flexShrink: 0 }} />
          <span
            style={{
              fontWeight: 700,
              fontSize: compact ? 13 : 14,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {roll.label || 'Rolagem'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {manaSpent > 0 && (
            <span className="mesa-badge mesa-badge--sapphire">
              <Zap size={11} />
              {manaAlreadySpent ? `-${manaSpent} PM gastos` : `Custo ${manaSpent} PM`}
            </span>
          )}
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-muted)',
              padding: '2px 7px',
              borderRadius: 'var(--radius-xs)',
              background: 'rgba(0,0,0,0.28)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {roll.formula}
          </span>
        </div>
      </div>

      {/* Dice faces & total breakdown */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          padding: '8px 10px',
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(7, 9, 13, 0.55)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {roll.dice.map((die, idx) => {
            const hl = getDieHighlight(die);
            return (
              <span
                key={`${die.sides}-${idx}`}
                title={`d${die.sides}${die.dropped ? ' (descartado)' : ''}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 30,
                  height: 30,
                  padding: '0 6px',
                  borderRadius: 7,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 14,
                  fontWeight: 800,
                  opacity: die.dropped ? 0.4 : 1,
                  textDecoration: die.dropped ? 'line-through' : 'none',
                  background:
                    hl === 'max'
                      ? 'rgba(212, 168, 79, 0.24)'
                      : hl === 'min'
                        ? 'rgba(239, 68, 68, 0.22)'
                        : 'var(--bg-elevated)',
                  border:
                    hl === 'max'
                      ? '1px solid rgba(242, 204, 123, 0.85)'
                      : hl === 'min'
                        ? '1px solid rgba(248, 113, 113, 0.7)'
                        : '1px solid var(--border-default)',
                  color:
                    hl === 'max'
                      ? '#fde68a'
                      : hl === 'min'
                        ? '#fca5a5'
                        : 'var(--text-primary)',
                  boxShadow: hl === 'max' ? '0 0 10px rgba(212, 168, 79, 0.3)' : undefined,
                }}
              >
                {die.value}
                <sub style={{ fontSize: 9, opacity: 0.65, marginLeft: 1 }}>d{die.sides}</sub>
              </span>
            );
          })}

          {roll.modifier !== 0 && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                padding: '0 2px',
              }}
            >
              {roll.modifier > 0 ? `+ ${roll.modifier}` : `- ${Math.abs(roll.modifier)}`}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginLeft: 'auto' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>=</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: compact ? 22 : 26,
              fontWeight: 800,
              lineHeight: 1,
              color: isCrit
                ? '#fde68a'
                : isFumble
                  ? '#f87171'
                  : isSuccess
                    ? '#4ade80'
                    : isFailure
                      ? '#fca5a5'
                      : 'var(--gold-400)',
            }}
          >
            {roll.total}
          </span>
        </div>
      </div>

      {/* Difficulty / Defense comparison badge */}
      {outcome && !isCrit && !isFumble && (outcome.difficulty !== undefined || outcome.targetDefense !== undefined) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
            fontSize: 12,
          }}
        >
          <span
            className={`mesa-badge ${
              isSuccess ? 'mesa-badge--emerald' : isFailure ? 'mesa-badge--crimson' : 'mesa-badge--gold'
            }`}
          >
            <Shield size={11} />
            {outcome.badgeText ??
              (isSuccess
                ? `Sucesso! vs ${outcome.targetDefense !== undefined ? `Def ${outcome.targetDefense}` : `Dif ${outcome.difficulty}`}`
                : `Falha vs ${outcome.targetDefense !== undefined ? `Def ${outcome.targetDefense}` : `Dif ${outcome.difficulty}`}`)}
          </span>
          {outcome.targetName && (
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              Alvo: <strong style={{ color: 'var(--text-secondary)' }}>{outcome.targetName}</strong>
            </span>
          )}
        </div>
      )}

      {/* Interactive 1-Click Automation Buttons + Target Picker */}
      {(actions.length > 0 || isDamageRoll || isHealRoll || showQuickApply) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 2 }}>
          {characters.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Crosshair size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <select
                aria-label="Alvo da ação"
                value={effectiveTargetId}
                onChange={(e) => setSelectedTargetId(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'rgba(7, 9, 13, 0.72)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '4px 8px',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                }}
              >
                <option value="">Alvo automático / escolher personagem...</option>
                {characters.map((ch) => {
                  const hp = ch.resources?.pv ?? ch.resources?.hp;
                  return (
                    <option key={ch.id} value={ch.id}>
                      {ch.name} {hp ? `(${hp.current}/${hp.max} PV)` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {actions.map((action) => {
              const executedBy = action.executedBy ?? localExecuted[action.id];
              const isDone = Boolean(executedBy);
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleActionClick(action)}
                  disabled={isDone && action.actionType !== 'roll_followup'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 10px',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid',
                    fontSize: 12,
                    fontWeight: 600,
                    minHeight: 30,
                    transition: 'filter 120ms ease, transform 100ms ease',
                    ...getActionToneStyle(action.style),
                    opacity: isDone ? 0.72 : 1,
                  }}
                >
                  {isDone ? <Check size={13} /> : renderActionIcon(action)}
                  <span>{isDone ? `${action.label} (${executedBy})` : action.label}</span>
                </button>
              );
            })}

            {isDamageRoll && !hasApplyDamageAction && (
              <button
                type="button"
                onClick={() => handleQuickApplyAmount('damage')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid',
                  fontSize: 12,
                  fontWeight: 600,
                  minHeight: 30,
                  ...getActionToneStyle('damage'),
                }}
              >
                <Swords size={13} />
                <span>
                  Aplicar {roll.total} Dano{resolvedTarget ? ` em ${resolvedTarget.name}` : ''}
                </span>
              </button>
            )}

            {isHealRoll && !hasApplyHealAction && (
              <button
                type="button"
                onClick={() => handleQuickApplyAmount('heal')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid',
                  fontSize: 12,
                  fontWeight: 600,
                  minHeight: 30,
                  ...getActionToneStyle('heal'),
                }}
              >
                <Heart size={13} />
                <span>
                  Aplicar {roll.total} Cura{resolvedTarget ? ` em ${resolvedTarget.name}` : ''}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Subtle quick-apply toggle for arbitrary manual rolls (e.g. /r 2d6+3) */}
      {actions.length === 0 && !isDamageRoll && !isHealRoll && !showQuickApply && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button
            type="button"
            onClick={() => setShowQuickApply(true)}
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            Aplicar como Dano / Cura…
          </button>
        </div>
      )}

      {showQuickApply && actions.length === 0 && !isDamageRoll && !isHealRoll && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => handleQuickApplyAmount('damage')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 9px',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid',
              fontSize: 11,
              fontWeight: 600,
              ...getActionToneStyle('damage'),
            }}
          >
            <Swords size={12} />
            Aplicar {roll.total} Dano
          </button>
          <button
            type="button"
            onClick={() => handleQuickApplyAmount('heal')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 9px',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid',
              fontSize: 11,
              fontWeight: 600,
              ...getActionToneStyle('heal'),
            }}
          >
            <Heart size={12} />
            Aplicar {roll.total} Cura
          </button>
        </div>
      )}
    </div>
  );
}

export default RollCard;

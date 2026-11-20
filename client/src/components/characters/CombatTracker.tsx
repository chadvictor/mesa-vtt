import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Dices,
  Play,
  Plus,
  Square,
  Swords,
  Trash2,
} from 'lucide-react';
import { getSystemEngine } from '@systems/registry';
import type { Character } from '@systems/types';
import { useCampaignStore } from '@/lib/store';

export interface CombatTrackerProps {
  onOpenSheet?: (characterId: string) => void;
  selectedTargetId?: string | null;
  onSelectTarget?: (characterId: string | null) => void;
}

export function CombatTracker({
  onOpenSheet,
  selectedTargetId,
  onSelectTarget,
}: CombatTrackerProps) {
  const {
    campaign,
    combat,
    characters,
    activeCharacter,
    isGm,
    user,
    updateCombat,
    rollDice,
    pushToast,
  } = useCampaignStore();

  const [addingMenuOpen, setAddingMenuOpen] = useState(false);

  const engine = useMemo(
    () => getSystemEngine(campaign?.systemId ?? 'mighty-blade-3e'),
    [campaign?.systemId]
  );

  const sortedCombatants = useMemo(() => {
    return [...combat.combatants].sort((a, b) => b.initiative - a.initiative);
  }, [combat.combatants]);

  const charById = useMemo(
    () => new Map(characters.map((c) => [c.id, c])),
    [characters]
  );

  const availableToAdd = useMemo(() => {
    const inCombat = new Set(combat.combatants.map((c) => c.characterId).filter(Boolean));
    return characters.filter((c) => !inCombat.has(c.id));
  }, [characters, combat.combatants]);

  const rollInitiativeForCharacter = (char: Character) => {
    const plan = engine.planInitiative(char);
    const computedBonus = Number(char.computed?.iniciativaBonus ?? 0);
    // Roll on server for authoritative chat card + 3D dice
    rollDice({
      formula: plan.formula,
      label: `Iniciativa · ${char.name}`,
      characterId: char.id,
      systemMeta: plan.systemMeta,
    });

    // Also ensure character is added/updated in combat tracker with quick roll estimate
    const existing = combat.combatants.find((c) => c.characterId === char.id);
    const rolled =
      campaign?.systemId === 'tagmar-3'
        ? Math.floor(Math.random() * 10) + 1 + computedBonus
        : campaign?.systemId === 'generic-rpg'
          ? Math.floor(Math.random() * 20) + 1 + computedBonus
          : Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1 + computedBonus;

    if (existing) {
      updateCombat('set_initiative', { id: existing.id, initiative: rolled });
    } else {
      updateCombat('add', {
        characterId: char.id,
        name: char.name,
        portraitUrl: char.portraitUrl,
        initiative: rolled,
        isNpc: char.kind !== 'pc',
        hidden: false,
      });
    }
  };

  const handleRollOwnInitiative = () => {
    const char =
      activeCharacter ??
      characters.find(
        (c) => c.ownerUserId === user.id || c.controlledByUserIds?.includes(user.id)
      );
    if (!char) {
      pushToast('Selecione um personagem para rolar iniciativa.', 'warning');
      return;
    }
    rollInitiativeForCharacter(char);
  };

  const handleAddCharacter = (char: Character) => {
    const bonus = Number(char.computed?.iniciativaBonus ?? 0);
    const init =
      campaign?.systemId === 'tagmar-3'
        ? Math.floor(Math.random() * 10) + 1 + bonus
        : campaign?.systemId === 'generic-rpg'
          ? Math.floor(Math.random() * 20) + 1 + bonus
          : Math.floor(Math.random() * 6) + Math.floor(Math.random() * 6) + 2 + bonus;
    updateCombat('add', {
      characterId: char.id,
      name: char.name,
      portraitUrl: char.portraitUrl,
      initiative: init,
      isNpc: char.kind !== 'pc',
      hidden: false,
    });
    setAddingMenuOpen(false);
  };

  return (
    <div
      style={{
        background: combat.active
          ? 'linear-gradient(180deg, rgba(212, 168, 79, 0.1) 0%, rgba(20, 25, 34, 0.96) 100%)'
          : 'var(--bg-elevated)',
        border: `1px solid ${combat.active ? 'var(--border-gold)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Swords size={15} style={{ color: combat.active ? 'var(--gold-400)' : 'var(--text-muted)' }} />
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              fontWeight: 700,
              color: combat.active ? 'var(--gold-400)' : 'var(--text-primary)',
            }}
          >
            Combate
          </span>
          {combat.active ? (
            <span className="mesa-badge mesa-badge--gold">Rodada {combat.round}</span>
          ) : (
            <span className="mesa-badge">Inativo</span>
          )}
        </div>

        <button
          type="button"
          className="mesa-btn mesa-btn--sm"
          onClick={handleRollOwnInitiative}
          title="Rolar Iniciativa do personagem ativo"
          style={{ minHeight: 26, padding: '2px 8px', fontSize: 11 }}
        >
          <Dices size={12} style={{ color: 'var(--gold-400)' }} />
          Iniciativa
        </button>
      </div>

      {/* GM Controls */}
      {isGm && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {!combat.active ? (
            <button
              type="button"
              className="mesa-btn mesa-btn--gold mesa-btn--sm"
              style={{ flex: 1, minHeight: 28 }}
              onClick={() => updateCombat('start')}
            >
              <Play size={12} />
              Iniciar Combate
            </button>
          ) : (
            <>
              <button
                type="button"
                className="mesa-btn mesa-btn--sm"
                onClick={() => updateCombat('prev_turn')}
                title="Turno anterior"
                style={{ minHeight: 28, padding: '0 8px' }}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="mesa-btn mesa-btn--gold mesa-btn--sm"
                style={{ flex: 1, minHeight: 28 }}
                onClick={() => updateCombat('next_turn')}
              >
                Próximo Turno
                <ChevronRight size={14} />
              </button>
              <button
                type="button"
                className="mesa-btn mesa-btn--danger mesa-btn--sm"
                onClick={() => updateCombat('end')}
                title="Encerrar Combate"
                style={{ minHeight: 28, padding: '0 8px' }}
              >
                <Square size={12} />
              </button>
            </>
          )}

          {availableToAdd.length > 0 && (
            <button
              type="button"
              className="mesa-btn mesa-btn--sm"
              onClick={() => setAddingMenuOpen((v) => !v)}
              title="Adicionar personagem ao combate"
              style={{ minHeight: 28, padding: '0 8px' }}
            >
              <Plus size={13} />
            </button>
          )}
        </div>
      )}

      {/* Add Combatant Picker */}
      {isGm && addingMenuOpen && availableToAdd.length > 0 && (
        <div
          style={{
            background: 'var(--bg-obsidian)',
            border: '1px solid var(--border-gold)',
            borderRadius: 'var(--radius-xs)',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            maxHeight: 140,
            overflowY: 'auto',
          }}
        >
          <span style={{ fontSize: 10.5, color: 'var(--text-muted)', padding: '0 4px' }}>
            Adicionar à ordem de iniciativa:
          </span>
          {availableToAdd.map((ch) => (
            <button
              key={ch.id}
              type="button"
              onClick={() => handleAddCharacter(ch)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                padding: '4px 6px',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--text-primary)',
                textAlign: 'left',
              }}
            >
              <span>{ch.name}</span>
              <span style={{ fontSize: 10, color: 'var(--gold-400)' }}>+ Rolar</span>
            </button>
          ))}
        </div>
      )}

      {/* Turn Order List */}
      {sortedCombatants.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', padding: '4px 0' }}>
          Clique em <strong>Iniciativa</strong> para entrar na ordem de turnos.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sortedCombatants.map((c, idx) => {
            const isCurrent = combat.active && idx === combat.turnIndex % Math.max(1, sortedCombatants.length);
            const linked = c.characterId ? charById.get(c.characterId) : undefined;
            const hp =
              linked?.systemId === 'tagmar-3'
                ? linked.resources?.eh ?? linked.resources?.ef
                : linked?.resources?.pv ?? linked?.resources?.hp;
            const hpPct = hp && hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0;
            const isTarget = Boolean(c.characterId && selectedTargetId === c.characterId);

            return (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '5px 7px',
                  borderRadius: 'var(--radius-xs)',
                  background: isCurrent
                    ? 'linear-gradient(90deg, rgba(212, 168, 79, 0.24) 0%, rgba(27, 34, 48, 0.9) 100%)'
                    : 'rgba(12, 15, 20, 0.6)',
                  border: `1px solid ${
                    isCurrent ? 'var(--gold-400)' : isTarget ? 'rgba(239, 68, 68, 0.5)' : 'var(--border-subtle)'
                  }`,
                  boxShadow: isCurrent ? '0 0 12px rgba(212, 168, 79, 0.2)' : undefined,
                }}
              >
                <span
                  style={{
                    width: 12,
                    fontSize: 11,
                    color: isCurrent ? 'var(--gold-400)' : 'transparent',
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  ▶
                </span>

                <img
                  src={c.portraitUrl || './assets/portraits/human-warrior.svg'}
                  alt={c.name}
                  onClick={() => c.characterId && onOpenSheet?.(c.characterId)}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: `1px solid ${c.isNpc ? 'rgba(239,68,68,0.5)' : 'var(--border-gold)'}`,
                    cursor: c.characterId ? 'pointer' : 'default',
                    flexShrink: 0,
                  }}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    onClick={() => c.characterId && onOpenSheet?.(c.characterId)}
                    style={{
                      fontSize: 12,
                      fontWeight: isCurrent ? 700 : 600,
                      color: isCurrent ? '#fef3c7' : 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: c.characterId ? 'pointer' : 'default',
                    }}
                  >
                    {c.name}
                  </div>
                  {hp && (
                    <div
                      style={{
                        height: 3,
                        borderRadius: 99,
                        background: 'rgba(255,255,255,0.08)',
                        marginTop: 2,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${hpPct}%`,
                          height: '100%',
                          background: hpPct <= 30 ? 'var(--crimson-500)' : 'var(--emerald-500)',
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Initiative Score */}
                {isGm ? (
                  <input
                    type="number"
                    aria-label={`Iniciativa de ${c.name}`}
                    value={c.initiative}
                    onChange={(e) =>
                      updateCombat('set_initiative', {
                        id: c.id,
                        initiative: Number(e.target.value) || 0,
                      })
                    }
                    style={{
                      width: 38,
                      textAlign: 'center',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      fontWeight: 700,
                      background: 'var(--bg-obsidian)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 5,
                      padding: '2px 3px',
                      color: 'var(--gold-400)',
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--gold-400)',
                      padding: '2px 6px',
                      borderRadius: 5,
                      background: 'var(--bg-obsidian)',
                    }}
                  >
                    {c.initiative}
                  </span>
                )}

                {c.characterId && onSelectTarget && (
                  <button
                    type="button"
                    title="Selecionar como alvo"
                    onClick={() => onSelectTarget(isTarget ? null : c.characterId)}
                    style={{
                      padding: 3,
                      color: isTarget ? 'var(--crimson-400)' : 'var(--text-muted)',
                    }}
                  >
                    <Crosshair size={13} />
                  </button>
                )}

                {isGm && (
                  <button
                    type="button"
                    title="Remover do combate"
                    onClick={() => updateCombat('remove', { id: c.id })}
                    style={{ padding: 3, color: 'var(--text-muted)' }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default CombatTracker;

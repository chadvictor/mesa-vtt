import React, { useMemo, useState } from 'react';
import {
  Crosshair,
  Eye,
  EyeOff,
  FileText,
  Heart,
  Sparkles,
  Trash2,
  X,
  Activity,
} from 'lucide-react';
import type { ActiveCondition, Character, Token } from '@systems/types';
import { useCampaignStore } from '@/lib/store';
import conditionsData from '@data/mighty-blade/conditions.json';

interface ConditionCatalogItem {
  id: string;
  name: string;
  emoji: string;
  color: string;
  icon: string;
  category: string;
  description: string;
}

const CONDITION_CATALOG = conditionsData as ConditionCatalogItem[];

export interface TokenPopoverProps {
  sceneId: string;
  token: Token;
  character: Character | null;
  isGm: boolean;
  canControl: boolean;
  anchor?: { x: number; y: number; containerWidth: number; containerHeight: number } | null;
  compact?: boolean;
  onClose: () => void;
  onOpenCharacterSheet: (characterId: string) => void;
}

export const TokenPopover: React.FC<TokenPopoverProps> = ({
  sceneId,
  token,
  character,
  isGm,
  canControl,
  anchor,
  compact = false,
  onClose,
  onOpenCharacterSheet,
}) => {
  const {
    updateToken,
    deleteToken,
    patchCharacter,
    targetCharacterId,
    setTargetCharacterId,
    pushToast,
  } = useCampaignStore();

  const [showConditions, setShowConditions] = useState(false);

  // Sync live PV/PM from linked character if present, falling back to token fields
  const pvBar = character?.resources?.pv;
  const pmBar = character?.resources?.pm;

  const hp = pvBar ? pvBar.current : token.hp;
  const hpMax = pvBar ? pvBar.max : token.hpMax;
  const mp = pmBar ? pmBar.current : token.mp;
  const mpMax = pmBar ? pmBar.max : token.mpMax;

  const activeConditionIds = useMemo(() => {
    const ids = new Set<string>(token.conditions ?? []);
    if (character?.conditions) {
      for (const c of character.conditions) {
        ids.add(c.id);
      }
    }
    return ids;
  }, [token.conditions, character?.conditions]);

  const canEditStats = isGm || canControl;
  const isTarget = Boolean(character && targetCharacterId === character.id);

  const adjustResource = (kind: 'hp' | 'mp', delta: number) => {
    if (!canEditStats) return;

    if (kind === 'hp') {
      const cur = hp ?? 0;
      const max = hpMax ?? Math.max(cur, 1);
      const next = Math.max(0, Math.min(max + 50, cur + delta));
      updateToken(sceneId, token.id, { hp: next, hpMax: max, showBars: true });
      if (character) {
        patchCharacter(character.id, {
          resources: {
            ...character.resources,
            pv: { ...(character.resources.pv ?? { current: cur, max }), current: next, max },
          },
        });
      }
    } else {
      const cur = mp ?? 0;
      const max = mpMax ?? Math.max(cur, 1);
      const next = Math.max(0, Math.min(max + 50, cur + delta));
      updateToken(sceneId, token.id, { mp: next, mpMax: max, showBars: true });
      if (character) {
        patchCharacter(character.id, {
          resources: {
            ...character.resources,
            pm: { ...(character.resources.pm ?? { current: cur, max }), current: next, max },
          },
        });
      }
    }
  };

  const toggleCondition = (cond: ConditionCatalogItem) => {
    if (!canEditStats) return;
    const exists = activeConditionIds.has(cond.id);
    const nextTokenConds = exists
      ? (token.conditions ?? []).filter((id) => id !== cond.id)
      : Array.from(new Set([...(token.conditions ?? []), cond.id]));

    updateToken(sceneId, token.id, { conditions: nextTokenConds });

    if (character) {
      const currentList: ActiveCondition[] = character.conditions ?? [];
      const nextCharConds: ActiveCondition[] = exists
        ? currentList.filter((c) => c.id !== cond.id)
        : [
            ...currentList.filter((c) => c.id !== cond.id),
            { id: cond.id, name: cond.name, icon: cond.icon },
          ];
      patchCharacter(character.id, { conditions: nextCharConds });
    }
  };

  const toggleLayer = () => {
    if (!isGm) return;
    const nextLayer = token.layer === 'gm' ? 'tokens' : 'gm';
    updateToken(sceneId, token.id, { layer: nextLayer });
    pushToast(
      nextLayer === 'gm'
        ? `"${token.name}" movido para camada oculta do Mestre.`
        : `"${token.name}" agora está visível para os jogadores.`,
      'info'
    );
  };

  const cycleSize = () => {
    if (!isGm) return;
    const nextSize = token.size >= 3 ? 1 : token.size + 1;
    updateToken(sceneId, token.id, { size: nextSize });
  };

  const handleDelete = () => {
    if (!isGm) return;
    deleteToken(sceneId, token.id);
    onClose();
  };

  const hpPct = hpMax && hpMax > 0 && hp !== undefined ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0;
  const mpPct = mpMax && mpMax > 0 && mp !== undefined ? Math.max(0, Math.min(100, (mp / mpMax) * 100)) : 0;

  const roleBadge =
    character?.kind === 'pc'
      ? { label: 'PC', cls: 'mesa-badge--gold' }
      : character?.kind === 'monster'
        ? { label: 'Monstro', cls: 'mesa-badge--crimson' }
        : character?.kind === 'npc'
          ? { label: 'NPC', cls: 'mesa-badge--sapphire' }
          : { label: 'Token', cls: '' };

  // Desktop anchored positioning vs mobile bottom card
  const popoverStyle: React.CSSProperties = compact
    ? {
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: 8,
        zIndex: 22,
        maxHeight: '62%',
        overflowY: 'auto',
      }
    : (() => {
        const cardW = 304;
        const cardH = showConditions ? 390 : 260;
        const pad = 12;
        if (!anchor) {
          return {
            position: 'absolute',
            right: 12,
            bottom: 12,
            width: cardW,
            zIndex: 22,
          };
        }
        let left = anchor.x + 28;
        if (left + cardW + pad > anchor.containerWidth) {
          left = anchor.x - cardW - 28;
        }
        left = Math.max(pad, Math.min(anchor.containerWidth - cardW - pad, left));

        let top = anchor.y - 40;
        if (top + cardH + pad > anchor.containerHeight) {
          top = anchor.containerHeight - cardH - pad;
        }
        top = Math.max(58, top);

        return {
          position: 'absolute',
          left,
          top,
          width: cardW,
          maxHeight: Math.max(220, anchor.containerHeight - 72),
          overflowY: 'auto',
          zIndex: 22,
        };
      })();

  const stepBtnStyle: React.CSSProperties = {
    minWidth: compact ? 36 : 30,
    height: compact ? 32 : 26,
    padding: '0 6px',
    borderRadius: 'var(--radius-xs)',
    border: '1px solid var(--border-default)',
    background: 'var(--bg-elevated)',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-primary)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div
      role="dialog"
      aria-label={`Controles de ${token.name}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        ...popoverStyle,
        background: 'rgba(15, 20, 29, 0.96)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${token.layer === 'gm' ? 'rgba(192, 132, 252, 0.55)' : 'var(--border-gold)'}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 'var(--radius-full)',
            overflow: 'hidden',
            border: `2px solid ${token.color || '#d4a84f'}`,
            background: 'var(--bg-obsidian)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {token.imageUrl ? (
            <img
              src={token.imageUrl}
              alt={token.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontWeight: 700, color: 'var(--gold-400)' }}>
              {token.name.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {token.name}
            </span>
            <span className={`mesa-badge ${roleBadge.cls}`}>{roleBadge.label}</span>
            {token.layer === 'gm' && (
              <span className="mesa-badge mesa-badge--amethyst">
                <EyeOff size={10} /> GM
              </span>
            )}
          </div>
          {character?.subtitle && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {character.subtitle}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar painel do token"
          className="mesa-btn mesa-btn--ghost"
          style={{ width: 28, height: 28, minHeight: 28, padding: 0, borderRadius: 'var(--radius-full)' }}
        >
          <X size={15} />
        </button>
      </div>

      {/* PV (HP) Bar & Quick Buttons */}
      {(hp !== undefined || hpMax !== undefined || canEditStats) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, color: 'var(--emerald-400)' }}>
              <Heart size={13} /> PV
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
              {hp ?? 0} / {hpMax ?? 0}
            </span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 'var(--radius-full)',
              background: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${hpPct}%`,
                height: '100%',
                background:
                  hpPct > 50
                    ? 'linear-gradient(90deg, #16a34a, #4ade80)'
                    : hpPct > 25
                      ? 'linear-gradient(90deg, #d97706, #fbbf24)'
                      : 'linear-gradient(90deg, #b91c1c, #f87171)',
                transition: 'width 180ms ease',
              }}
            />
          </div>
          {canEditStats && (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between' }}>
              {[-5, -1, 1, 5].map((delta) => (
                <button
                  key={`hp-${delta}`}
                  type="button"
                  onClick={() => adjustResource('hp', delta)}
                  style={{
                    ...stepBtnStyle,
                    flex: 1,
                    color: delta < 0 ? 'var(--crimson-400)' : 'var(--emerald-400)',
                    borderColor:
                      delta < 0 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)',
                  }}
                >
                  {delta > 0 ? `+${delta}` : delta}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PM (MP) Bar & Quick Buttons */}
      {(mp !== undefined || mpMax !== undefined) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, color: 'var(--sapphire-400)' }}>
              <Sparkles size={13} /> PM
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
              {mp ?? 0} / {mpMax ?? 0}
            </span>
          </div>
          <div
            style={{
              height: 5,
              borderRadius: 'var(--radius-full)',
              background: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${mpPct}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #2563eb, #60a5fa)',
                transition: 'width 180ms ease',
              }}
            />
          </div>
          {canEditStats && (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between' }}>
              {[-5, -1, 1, 5].map((delta) => (
                <button
                  key={`mp-${delta}`}
                  type="button"
                  onClick={() => adjustResource('mp', delta)}
                  style={{
                    ...stepBtnStyle,
                    flex: 1,
                    color: delta < 0 ? 'var(--amber-400)' : 'var(--sapphire-400)',
                    borderColor: 'rgba(59, 130, 246, 0.3)',
                  }}
                >
                  {delta > 0 ? `+${delta}` : delta}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active conditions pills + toggleable picker */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Activity size={12} /> Condições ({activeConditionIds.size})
          </span>
          {canEditStats && (
            <button
              type="button"
              onClick={() => setShowConditions((v) => !v)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--gold-400)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--gold-soft)',
              }}
            >
              {showConditions ? 'Fechar' : '+ Alterar'}
            </button>
          )}
        </div>

        {activeConditionIds.size > 0 && !showConditions && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Array.from(activeConditionIds).map((id) => {
              const info = CONDITION_CATALOG.find((c) => c.id === id);
              return (
                <span
                  key={id}
                  onClick={() => info && canEditStats && toggleCondition(info)}
                  title={info ? `${info.name}: ${info.description}` : id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 7px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(255,255,255,0.08)',
                    border: `1px solid ${info?.color ?? 'var(--border-default)'}`,
                    color: 'var(--text-primary)',
                    cursor: canEditStats ? 'pointer' : 'default',
                  }}
                >
                  <span>{info?.emoji ?? '•'}</span>
                  <span>{info?.name ?? id}</span>
                </span>
              );
            })}
          </div>
        )}

        {showConditions && canEditStats && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 4,
              maxHeight: 140,
              overflowY: 'auto',
              padding: 4,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-obsidian)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {CONDITION_CATALOG.map((cond) => {
              const active = activeConditionIds.has(cond.id);
              return (
                <button
                  key={cond.id}
                  type="button"
                  onClick={() => toggleCondition(cond)}
                  title={cond.description}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 7px',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    textAlign: 'left',
                    background: active ? 'rgba(212, 168, 79, 0.2)' : 'transparent',
                    border: `1px solid ${active ? cond.color : 'transparent'}`,
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <span>{cond.emoji}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cond.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {token.characterId && (
          <button
            type="button"
            className="mesa-btn mesa-btn--gold mesa-btn--sm"
            style={{ flex: 1 }}
            onClick={() => onOpenCharacterSheet(token.characterId!)}
          >
            <FileText size={13} />
            <span>Abrir Ficha</span>
          </button>
        )}

        {character && (
          <button
            type="button"
            className={`mesa-btn mesa-btn--sm ${isTarget ? 'mesa-btn--danger' : ''}`}
            onClick={() => setTargetCharacterId(isTarget ? null : character.id)}
            title={isTarget ? 'Remover alvo selecionado' : 'Marcar como alvo de combate'}
          >
            <Crosshair size={13} />
            <span>{isTarget ? 'Alvo' : 'Mirar'}</span>
          </button>
        )}

        {isGm && (
          <>
            <button
              type="button"
              className="mesa-btn mesa-btn--sm"
              onClick={toggleLayer}
              title={token.layer === 'gm' ? 'Revelar token aos jogadores' : 'Ocultar token (somente Mestre)'}
              style={{
                borderColor: token.layer === 'gm' ? 'rgba(192, 132, 252, 0.5)' : undefined,
                color: token.layer === 'gm' ? 'var(--amethyst-400)' : undefined,
              }}
            >
              {token.layer === 'gm' ? <Eye size={13} /> : <EyeOff size={13} />}
              <span>{token.layer === 'gm' ? 'Revelar' : 'Ocultar'}</span>
            </button>

            <button
              type="button"
              className="mesa-btn mesa-btn--sm"
              onClick={cycleSize}
              title="Alterar tamanho do token (1x / 2x / 3x)"
            >
              <span>{token.size}×{token.size}</span>
            </button>

            <button
              type="button"
              className="mesa-btn mesa-btn--danger mesa-btn--sm"
              onClick={handleDelete}
              title="Remover token do mapa"
              aria-label="Remover token do mapa"
              style={{ padding: '4px 8px' }}
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default TokenPopover;

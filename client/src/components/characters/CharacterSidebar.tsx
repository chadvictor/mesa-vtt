import React, { useMemo, useState } from 'react';
import {
  Crosshair,
  Crown,
  MapPin,
  MessageSquare,
  Plus,
  Shield,
  Skull,
  UserPlus,
  Zap,
} from 'lucide-react';
import { getSystemEngine } from '@systems/registry';
import type { Character } from '@systems/types';
import type { CharacterSidebarProps } from '@/lib/componentProps';
import { useCampaignStore, useVoice } from '@/lib/store';
import { CombatTracker } from './CombatTracker';
import { MightyBladeWizard } from './MightyBladeWizard';
import { TagmarWizard } from './TagmarWizard';

export function CharacterSidebar({
  onOpenSheet,
  selectedTargetId,
  onSelectTarget,
  compact = false,
}: CharacterSidebarProps) {
  const {
    campaign,
    characters,
    activeCharacterId,
    setActiveCharacterId,
    activeScene,
    isGm,
    user,
    createCharacter,
    createToken,
    pushToast,
  } = useCampaignStore();

  const voice = useVoice();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [tagmarWizardOpen, setTagmarWizardOpen] = useState(false);
  const [quickCreatorKind, setQuickCreatorKind] = useState<'pc' | 'npc' | null>(null);
  const [quickName, setQuickName] = useState('');
  const [quickRole, setQuickRole] = useState('');

  const systemId = campaign?.systemId ?? 'mighty-blade-3e';
  const isMightyBlade = systemId === 'mighty-blade-3e';
  const isTagmar = systemId === 'tagmar-3';
  const engine = useMemo(() => getSystemEngine(systemId), [systemId]);

  const speakingUserIds = useMemo(() => {
    const set = new Set<string>();
    if (voice.speaking) set.add(user.id);
    for (const [uid, isSpeaking] of Object.entries(voice.remoteSpeaking)) {
      if (isSpeaking) set.add(uid);
    }
    for (const p of voice.activeChannel?.participants ?? []) {
      if (p.speaking) set.add(p.userId);
    }
    return set;
  }, [voice.speaking, voice.remoteSpeaking, voice.activeChannel, user.id]);

  const pcs = useMemo(() => characters.filter((c) => c.kind === 'pc'), [characters]);
  const npcs = useMemo(() => characters.filter((c) => c.kind !== 'pc'), [characters]);

  const handlePlaceOnMap = (char: Character) => {
    if (!activeScene) {
      pushToast('Nenhuma cena ativa no mapa.', 'warning');
      return;
    }
    const isCharTagmar = char.systemId === 'tagmar-3';
    const hp = isCharTagmar ? char.resources?.eh : (char.resources?.pv ?? char.resources?.hp);
    const mp = isCharTagmar ? char.resources?.ef : (char.resources?.pm ?? char.resources?.mp);
    const cx = Math.max(1, Math.floor((activeScene.grid.cols || 24) / 2) + Math.floor(Math.random() * 3 - 1));
    const cy = Math.max(1, Math.floor((activeScene.grid.rows || 18) / 2) + Math.floor(Math.random() * 3 - 1));

    createToken(activeScene.id, {
      characterId: char.id,
      name: char.name,
      imageUrl: char.portraitUrl,
      x: cx,
      y: cy,
      size: 1,
      rotation: 0,
      color: char.kind === 'pc' ? '#22c55e' : '#ef4444',
      layer: 'tokens',
      showBars: true,
      hp: hp?.current,
      hpMax: hp?.max,
      mp: mp?.current,
      mpMax: mp?.max,
      conditions: char.conditions.map((c) => c.id),
      controlledByUserIds: char.ownerUserId ? [char.ownerUserId] : [],
    });
    pushToast(`${char.name} colocado na cena "${activeScene.name}"!`, 'success');
  };

  const handleQuickCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCreatorKind) return;
    const trimmed = quickName.trim();
    if (!trimmed) {
      pushToast('Informe um nome.', 'warning');
      return;
    }
    const draft = engine.createCharacterFromWizard({
      name: trimmed,
      kind: quickCreatorKind,
      archetype: quickRole.trim() || (quickCreatorKind === 'npc' ? 'NPC' : 'Aventureiro'),
      raceId: 'humano',
      classId: 'guerreiro',
      professionId: 'guerreiro',
      portraitUrl:
        quickCreatorKind === 'npc'
          ? './assets/portraits/gm-avatar.svg'
          : './assets/portraits/human-warrior.svg',
      ownerUserId: quickCreatorKind === 'pc' ? user.id : null,
    });
    draft.kind = quickCreatorKind;
    if (quickRole.trim()) {
      draft.subtitle = quickRole.trim();
    }
    const created = await createCharacter(draft);
    if (created) {
      pushToast(`"${created.name}" criado!`, 'success');
      if (quickCreatorKind === 'pc') setActiveCharacterId(created.id);
      onOpenSheet(created.id);
    }
    setQuickName('');
    setQuickRole('');
    setQuickCreatorKind(null);
  };

  const renderCard = (char: Character) => {
    const isCharTagmar = char.systemId === 'tagmar-3';
    const hp = char.resources?.pv ?? char.resources?.hp;
    const mp = char.resources?.pm ?? char.resources?.mp;
    const hpPct = hp && hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0;
    const mpPct = mp && mp.max > 0 ? Math.max(0, Math.min(100, (mp.current / mp.max) * 100)) : 0;

    const eh = char.resources?.eh;
    const ef = char.resources?.ef;
    const karma = char.resources?.karma;
    const ehPct = eh && eh.max > 0 ? Math.max(0, Math.min(100, (eh.current / eh.max) * 100)) : 0;
    const efPct = ef && ef.max > 0 ? Math.max(0, Math.min(100, (ef.current / ef.max) * 100)) : 0;
    const karmaPct =
      karma && karma.max > 0 ? Math.max(0, Math.min(100, (karma.current / karma.max) * 100)) : 0;

    const isActiveSpeaker = activeCharacterId === char.id;
    const isTarget = selectedTargetId === char.id;
    const isOwnerTalking = Boolean(char.ownerUserId && speakingUserIds.has(char.ownerUserId));

    const bloqueio = char.computed?.bloqueio as number | undefined;
    const esquiva = char.computed?.esquiva as number | undefined;
    const defesa = char.computed?.defesa as number | undefined;
    const defesaAtiva = char.computed?.defesaAtiva as number | undefined;
    const defesaPassiva = char.computed?.defesaPassiva as number | undefined;
    const absorcao = char.computed?.absorcao as number | undefined;

    const canPlaceOnMap = isGm || char.ownerUserId === user.id || char.controlledByUserIds?.includes(user.id);

    return (
      <div
        key={char.id}
        style={{
          background: isActiveSpeaker
            ? 'linear-gradient(145deg, rgba(212, 168, 79, 0.12) 0%, var(--bg-elevated) 65%)'
            : 'var(--bg-elevated)',
          border: `1px solid ${
            isTarget
              ? 'rgba(239, 68, 68, 0.65)'
              : isActiveSpeaker
                ? 'var(--border-gold)'
                : 'var(--border-subtle)'
          }`,
          borderRadius: 'var(--radius-md)',
          padding: compact ? 10 : 9,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          transition: 'border-color 140ms ease',
        }}
      >
        {/* Top Row: Portrait + Name + Def Badges */}
        <div
          onClick={() => onOpenSheet(char.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onOpenSheet(char.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              border: `2px solid ${
                isOwnerTalking
                  ? 'var(--emerald-400)'
                  : isActiveSpeaker
                    ? 'var(--gold-400)'
                    : 'var(--border-default)'
              }`,
              boxShadow: isOwnerTalking ? 'var(--emerald-glow)' : undefined,
              animation: isOwnerTalking ? 'voiceRingPulse 1.4s infinite' : undefined,
              flexShrink: 0,
              background: 'var(--bg-obsidian)',
            }}
          >
            <img
              src={char.portraitUrl || './assets/portraits/human-warrior.svg'}
              alt={char.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 13.5,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {char.name}
              </span>
              {isTarget && (
                <span className="mesa-badge mesa-badge--crimson" style={{ fontSize: 9.5, padding: '1px 5px' }}>
                  ALVO
                </span>
              )}
            </div>

            {char.subtitle && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {char.subtitle}
              </div>
            )}

            {/* Quick Defense Badges */}
            <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
              {isCharTagmar ? (
                <>
                  <span className="mesa-badge mesa-badge--gold" style={{ fontSize: 10, padding: '1px 6px' }}>
                    <Shield size={9} /> DA {defesaAtiva ?? 0} / DP {defesaPassiva ?? 0}
                  </span>
                  {absorcao !== undefined && absorcao > 0 && (
                    <span className="mesa-badge mesa-badge--emerald" style={{ fontSize: 10, padding: '1px 6px' }}>
                      Abs {absorcao}
                    </span>
                  )}
                </>
              ) : bloqueio !== undefined && esquiva !== undefined && char.systemId === 'mighty-blade-3e' ? (
                <>
                  <span className="mesa-badge" style={{ fontSize: 10, padding: '1px 6px' }}>
                    <Shield size={9} style={{ color: 'var(--gold-400)' }} /> Bloq {bloqueio}
                  </span>
                  <span className="mesa-badge" style={{ fontSize: 10, padding: '1px 6px' }}>
                    <Zap size={9} style={{ color: 'var(--emerald-400)' }} /> Esq {esquiva}
                  </span>
                </>
              ) : defesa !== undefined ? (
                <span className="mesa-badge" style={{ fontSize: 10, padding: '1px 6px' }}>
                  <Shield size={9} style={{ color: 'var(--gold-400)' }} /> Def {defesa}
                </span>
              ) : null}

              {char.conditions.slice(0, 2).map((cond) => (
                <span
                  key={cond.id}
                  className="mesa-badge mesa-badge--amethyst"
                  style={{ fontSize: 9.5, padding: '1px 5px' }}
                >
                  {cond.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Resource Bars: Tagmar (EH / EF / Karma) vs Mighty Blade & Generic (PV / PM) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {isCharTagmar ? (
            <>
              {eh && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold-400)', width: 22 }}>
                    EH
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 7,
                      borderRadius: 99,
                      background: 'rgba(0,0,0,0.45)',
                      border: '1px solid var(--border-subtle)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${ehPct}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #eab308, #22c55e)',
                        transition: 'width 200ms ease',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      color: 'var(--text-secondary)',
                      minWidth: 42,
                      textAlign: 'right',
                    }}
                  >
                    {eh.current}/{eh.max}
                  </span>
                </div>
              )}

              {ef && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--crimson-400)', width: 22 }}>
                    EF
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 7,
                      borderRadius: 99,
                      background: 'rgba(0,0,0,0.45)',
                      border: '1px solid var(--border-subtle)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${efPct}%`,
                        height: '100%',
                        background:
                          ef.current <= 0
                            ? '#991b1b'
                            : 'linear-gradient(90deg, #dc2626, #f87171)',
                        transition: 'width 200ms ease',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      color: ef.current <= 0 ? 'var(--crimson-400)' : 'var(--text-secondary)',
                      minWidth: 42,
                      textAlign: 'right',
                    }}
                  >
                    {ef.current}/{ef.max}
                  </span>
                </div>
              )}

              {karma && karma.max > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#38bdf8', width: 22 }}>
                    KM
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 99,
                      background: 'rgba(0,0,0,0.45)',
                      border: '1px solid var(--border-subtle)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${karmaPct}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #0284c7, #38bdf8)',
                        transition: 'width 200ms ease',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      color: 'var(--text-secondary)',
                      minWidth: 42,
                      textAlign: 'right',
                    }}
                  >
                    {karma.current}/{karma.max}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              {hp && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--emerald-400)', width: 20 }}>
                    PV
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 99,
                      background: 'rgba(0,0,0,0.45)',
                      border: '1px solid var(--border-subtle)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${hpPct}%`,
                        height: '100%',
                        background:
                          hp.current <= 0
                            ? 'var(--crimson-600)'
                            : hpPct <= 30
                              ? 'linear-gradient(90deg, #dc2626, #f87171)'
                              : 'linear-gradient(90deg, #16a34a, #4ade80)',
                        transition: 'width 200ms ease',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      color: hp.current <= 0 ? 'var(--crimson-400)' : 'var(--text-secondary)',
                      minWidth: 42,
                      textAlign: 'right',
                    }}
                  >
                    {hp.current}/{hp.max}
                  </span>
                </div>
              )}

              {mp && mp.max > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--sapphire-400)', width: 20 }}>
                    PM
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 7,
                      borderRadius: 99,
                      background: 'rgba(0,0,0,0.45)',
                      border: '1px solid var(--border-subtle)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${mpPct}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #2563eb, #60a5fa)',
                        transition: 'width 200ms ease',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      color: 'var(--text-secondary)',
                      minWidth: 42,
                      textAlign: 'right',
                    }}
                  >
                    {mp.current}/{mp.max}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Quick Actions Footer */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`mesa-btn mesa-btn--sm ${isActiveSpeaker ? 'mesa-btn--gold' : ''}`}
            onClick={() => setActiveCharacterId(isActiveSpeaker ? null : char.id)}
            style={{ flex: 1, minHeight: 28, padding: '2px 6px', fontSize: 11 }}
            title="Falar em personagem como este ator"
          >
            <MessageSquare size={11} />
            {isActiveSpeaker ? 'Falando' : 'Falar como'}
          </button>

          <button
            type="button"
            className={`mesa-btn mesa-btn--sm ${isTarget ? 'mesa-btn--danger' : ''}`}
            onClick={() => onSelectTarget(isTarget ? null : char.id)}
            style={{ minHeight: 28, padding: '2px 7px', fontSize: 11 }}
            title="Marcar como alvo de ataques e magias"
          >
            <Crosshair size={11} />
          </button>

          {canPlaceOnMap && (
            <button
              type="button"
              className="mesa-btn mesa-btn--sm"
              onClick={() => handlePlaceOnMap(char)}
              style={{ minHeight: 28, padding: '2px 7px', fontSize: 11 }}
              title="Colocar token no mapa ativo"
            >
              <MapPin size={11} />
            </button>
          )}

          <button
            type="button"
            className="mesa-btn mesa-btn--sm"
            onClick={() => onOpenSheet(char.id)}
            style={{ minHeight: 28, padding: '2px 8px', fontSize: 11 }}
          >
            Ficha
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-surface)',
      }}
    >
      {/* Top Action Buttons */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          className={`mesa-btn ${isTagmar ? 'mesa-btn--emerald' : 'mesa-btn--gold'} mesa-btn--sm`}
          style={{ flex: 1 }}
          onClick={() =>
            isTagmar
              ? setTagmarWizardOpen(true)
              : isMightyBlade
                ? setWizardOpen(true)
                : setQuickCreatorKind('pc')
          }
        >
          <Crown size={13} />
          {isTagmar
            ? '+ Novo Herói (Tagmar 3.0)'
            : isMightyBlade
              ? '+ Novo Herói'
              : '+ Novo Personagem'}
        </button>

        {isGm && (
          <button
            type="button"
            className="mesa-btn mesa-btn--sm"
            onClick={() => setQuickCreatorKind('npc')}
          >
            <UserPlus size={13} />
            + NPC
          </button>
        )}
      </div>

      {/* Scrollable Sidebar Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '10px 10px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Combat Tracker */}
        <CombatTracker
          onOpenSheet={onOpenSheet}
          selectedTargetId={selectedTargetId}
          onSelectTarget={onSelectTarget}
        />

        {/* Inline Quick Creator (Generic PC or NPC) */}
        {quickCreatorKind && (
          <form
            onSubmit={handleQuickCreate}
            style={{
              padding: 10,
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-gold)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-400)' }}>
              {quickCreatorKind === 'npc' ? 'Criar Novo NPC / Criatura' : 'Novo Personagem (RPG Genérico)'}
            </div>
            <input
              type="text"
              className="mesa-input"
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
              placeholder="Nome (ex: Barnabé, Capitão da Guarda...)"
              style={{ padding: '6px 9px', fontSize: 12 }}
              autoFocus
            />
            <input
              type="text"
              className="mesa-input"
              value={quickRole}
              onChange={(e) => setQuickRole(e.target.value)}
              placeholder="Título / Arquétipo (ex: Taverneiro, Mercenário)"
              style={{ padding: '6px 9px', fontSize: 12 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button
                type="button"
                className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                onClick={() => setQuickCreatorKind(null)}
              >
                Cancelar
              </button>
              <button type="submit" className="mesa-btn mesa-btn--gold mesa-btn--sm">
                <Plus size={12} /> Criar
              </button>
            </div>
          </form>
        )}

        {/* Hero PCs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--gold-400)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            <span>Heróis ({pcs.length})</span>
          </div>
          {pcs.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 2px' }}>
              Nenhum herói criado ainda. Clique em <strong>+ Novo Herói</strong>!
            </div>
          ) : (
            pcs.map(renderCard)
          )}
        </div>

        {/* NPCs & Monsters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            <Skull size={12} />
            <span>NPCs & Monstros ({npcs.length})</span>
          </div>
          {npcs.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 2px' }}>
              Use o <strong>Bestiário</strong> na Biblioteca ou <strong>+ NPC</strong> para adicionar criaturas.
            </div>
          ) : (
            npcs.map(renderCard)
          )}
        </div>
      </div>

      {/* Mighty Blade 3e Hero Creator Wizard */}
      <MightyBladeWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(created) => onOpenSheet(created.id)}
      />

      {/* Tagmar 3.0 Hero Creator Wizard */}
      <TagmarWizard
        open={tagmarWizardOpen}
        onClose={() => setTagmarWizardOpen(false)}
        onCreated={(created) => onOpenSheet(created.id)}
      />
    </div>
  );
}

export default CharacterSidebar;

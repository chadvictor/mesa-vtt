import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Crown,
  Dices,
  KeyRound,
  Loader2,
  LogOut,
  Mic,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sword,
  Users,
} from 'lucide-react';
import { joinCampaign, listCampaigns } from '@/lib/api';
import type { Campaign, MemberRole, UserIdentity } from '@systems/types';
import { CreateCampaignModal } from './CreateCampaignModal';
import { JoinByCodeModal } from './JoinByCodeModal';

interface CampaignLobbyProps {
  user: UserIdentity;
  localAuthEnabled: boolean;
  onEnterCampaign: (campaign: Campaign, role: MemberRole) => void;
  onSignOut?: () => void;
}

type SystemFilter = 'all' | 'mighty-blade-3e' | 'tagmar-3' | 'generic-rpg';

const SYSTEM_META: Record<string, { label: string; badgeClass: string }> = {
  'mighty-blade-3e': { label: 'Mighty Blade 3ª Ed.', badgeClass: 'mesa-badge--gold' },
  'tagmar-3': { label: 'Tagmar 3.0', badgeClass: 'mesa-badge--emerald' },
  'generic-rpg': { label: 'RPG Genérico', badgeClass: 'mesa-badge--sapphire' },
};

export function CampaignLobby({
  user,
  localAuthEnabled,
  onEnterCampaign,
  onSignOut,
}: CampaignLobbyProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [systemFilter, setSystemFilter] = useState<SystemFilter>('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCampaigns();
      setCampaigns(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao listar campanhas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const drakonDemo = useMemo(
    () =>
      campaigns.find((c) => c.inviteCode?.toUpperCase() === 'DRAKON') ??
      campaigns.find((c) => c.systemId === 'mighty-blade-3e') ??
      null,
    [campaigns]
  );

  const tagmarDemo = useMemo(
    () =>
      campaigns.find((c) => c.inviteCode?.toUpperCase() === 'TAGMAR') ??
      campaigns.find((c) => c.systemId === 'tagmar-3') ??
      null,
    [campaigns]
  );

  const showcaseDemos = useMemo(() => {
    const list: Campaign[] = [];
    if (drakonDemo) list.push(drakonDemo);
    if (tagmarDemo && tagmarDemo.id !== drakonDemo?.id) list.push(tagmarDemo);
    if (list.length === 0 && campaigns[0]) list.push(campaigns[0]);
    return list;
  }, [drakonDemo, tagmarDemo, campaigns]);

  const filteredCampaigns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (systemFilter !== 'all' && c.systemId !== systemFilter) return false;
      if (q) {
        const hay = `${c.name} ${c.description} ${c.inviteCode} ${c.gmName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [campaigns, systemFilter, search]);

  const handleJoinCampaign = async (campaign: Campaign, desiredRole: MemberRole) => {
    setJoiningId(`${campaign.id}:${desiredRole}`);
    setError(null);
    try {
      const res = await joinCampaign({
        inviteCode: campaign.inviteCode,
        desiredRole,
      });
      onEnterCampaign(res.campaign ?? campaign, res.member?.role ?? desiredRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar na campanha.');
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="lobby-page">
      <header className="lobby-header">
        <div className="lobby-brand">
          <div className="lobby-brand__emblem">
            <Dices size={20} />
          </div>
          <div>
            <h1 className="lobby-brand__title">Mesa VTT</h1>
            <div className="lobby-brand__tag">Virtual Tabletop Open Source</div>
          </div>
        </div>

        <div className="lobby-header__actions">
          <button
            type="button"
            className="mesa-btn"
            onClick={() => setJoinCodeOpen(true)}
          >
            <KeyRound size={15} />
            Entrar por Código
          </button>

          <button
            type="button"
            className="mesa-btn mesa-btn--gold"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={15} />
            Criar Campanha
          </button>

          <div className="lobby-user-pill" title={user.displayName}>
            <img
              src={user.avatarUrl || './assets/portraits/human-warrior.svg'}
              alt={user.displayName}
            />
            <span>{user.displayName}</span>
            {onSignOut && user.source === 'local' && (
              <button
                type="button"
                className="mesa-btn mesa-btn--ghost"
                style={{ minHeight: 26, padding: '2px 5px' }}
                onClick={onSignOut}
                title="Trocar perfil"
                aria-label="Trocar perfil"
              >
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="lobby-main">
        {/* Featured Hero Banner — Multisystem Showcase (Mighty Blade 3e & Tagmar 3.0) */}
        <section className="lobby-hero" style={{ minHeight: 280 }}>
          <img
            className="lobby-hero__bg"
            src="./assets/banner-mesa-rpg.svg"
            alt="Mesa VTT — Mighty Blade 3ª Edição & Tagmar 3.0"
          />
          <div className="lobby-hero__scrim" />
          <div className="lobby-hero__content" style={{ maxWidth: '100%', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="mesa-badge mesa-badge--gold">
                <Shield size={12} />
                Mighty Blade 3ª Ed.
              </span>
              <span className="mesa-badge mesa-badge--emerald">
                <Shield size={12} />
                Tagmar 3.0 + Expansões
              </span>
              <span className="mesa-badge mesa-badge--sapphire">
                <Mic size={12} />
                Voz Estilo Discord Integrada
              </span>
            </div>

            <h2 className="lobby-hero__title">
              Sua Mesa de RPG Brasileira, <span>Completa e Automatizada</span>
            </h2>

            <p className="lobby-hero__desc" style={{ maxWidth: 680 }}>
              Mapa tático com Névoa de Guerra, dados 3D sincronizados, fichas automatizadas de{' '}
              <strong>Mighty Blade 3ª Edição</strong> e <strong>Tagmar 3.0</strong> (com Tabela de
              Resolução colorida, Resistências RF/RM e expansões oficiais), pastas do Mestre e
              canal de voz em 1 toque.
            </p>

            {showcaseDemos.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
                  gap: 12,
                  marginTop: 6,
                }}
              >
                {showcaseDemos.map((demo) => {
                  const isTagmar = demo.systemId === 'tagmar-3';
                  const sysInfo = SYSTEM_META[demo.systemId] ?? {
                    label: demo.systemId,
                    badgeClass: 'mesa-badge--gold',
                  };
                  return (
                    <div
                      key={demo.id}
                      style={{
                        background: isTagmar
                          ? 'linear-gradient(145deg, rgba(34, 197, 94, 0.14) 0%, rgba(12, 15, 20, 0.88) 72%)'
                          : 'linear-gradient(145deg, rgba(212, 168, 79, 0.14) 0%, rgba(12, 15, 20, 0.88) 72%)',
                        border: `1px solid ${
                          isTagmar ? 'rgba(74, 222, 128, 0.42)' : 'var(--border-gold)'
                        }`,
                        borderRadius: 'var(--radius-md)',
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        backdropFilter: 'blur(8px)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                        <span className={`mesa-badge ${sysInfo.badgeClass}`}>
                          <Shield size={11} />
                          {sysInfo.label}
                        </span>
                        <span
                          className="mesa-badge"
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}
                        >
                          Código: {demo.inviteCode}
                        </span>
                      </div>

                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 700,
                          fontSize: 15,
                          color: isTagmar ? 'var(--emerald-400)' : 'var(--gold-400)',
                          lineHeight: 1.25,
                        }}
                      >
                        {demo.name}
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                        <button
                          type="button"
                          className={`mesa-btn mesa-btn--sm ${
                            isTagmar ? 'mesa-btn--emerald' : 'mesa-btn--gold'
                          }`}
                          disabled={joiningId !== null}
                          onClick={() => handleJoinCampaign(demo, 'player')}
                        >
                          {joiningId === `${demo.id}:player` ? (
                            <Loader2 size={14} className="mesa-spin" />
                          ) : (
                            <Sword size={14} />
                          )}
                          Jogar ({demo.inviteCode})
                        </button>

                        {(localAuthEnabled || demo.ownerUserId === user.id) && (
                          <button
                            type="button"
                            className="mesa-btn mesa-btn--sm"
                            disabled={joiningId !== null}
                            onClick={() => handleJoinCampaign(demo, 'gm')}
                          >
                            {joiningId === `${demo.id}:gm` ? (
                              <Loader2 size={14} className="mesa-spin" />
                            ) : (
                              <Crown size={14} color={isTagmar ? '#4ade80' : '#f2cc7b'} />
                            )}
                            Mestrar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="lobby-hero__cta">
                <button
                  type="button"
                  className="mesa-btn mesa-btn--gold"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus size={15} />
                  Criar Primeira Campanha
                </button>
              </div>
            )}
          </div>
        </section>

        {error && <div className="voice-error-banner">{error}</div>}

        {/* Filter & Search Toolbar */}
        <section className="lobby-toolbar">
          <div className="lobby-pills" role="tablist" aria-label="Filtrar por sistema">
            {(
              [
                ['all', 'Todos'],
                ['mighty-blade-3e', 'Mighty Blade 3ª Ed.'],
                ['tagmar-3', 'Tagmar 3.0'],
                ['generic-rpg', 'RPG Genérico'],
              ] as Array<[SystemFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={systemFilter === key}
                className={`lobby-pill ${systemFilter === key ? 'lobby-pill--active' : ''}`}
                onClick={() => setSystemFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 1 320px', width: '100%' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search
                size={15}
                style={{
                  position: 'absolute',
                  left: 11,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="search"
                className="mesa-input"
                placeholder="Buscar campanha ou código..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 34 }}
              />
            </div>

            <button
              type="button"
              className="mesa-btn mesa-btn--icon"
              onClick={() => void loadCampaigns()}
              title="Atualizar lista"
              aria-label="Atualizar lista"
            >
              <RefreshCw size={15} className={loading ? 'mesa-spin' : ''} />
            </button>
          </div>
        </section>

        {/* Campaign Grid */}
        {loading && campaigns.length === 0 ? (
          <div className="table-status-screen" style={{ minHeight: 220 }}>
            <Loader2 size={28} className="mesa-spin" color="#f2cc7b" />
            <span>Carregando mesas abertas...</span>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div
            className="table-status-screen"
            style={{
              minHeight: 200,
              border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <p style={{ fontSize: 15, color: 'var(--text-primary)' }}>
              Nenhuma campanha encontrada com este filtro.
            </p>
            <button
              type="button"
              className="mesa-btn mesa-btn--gold"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={15} />
              Criar Nova Campanha
            </button>
          </div>
        ) : (
          <section className="campaign-grid">
            {filteredCampaigns.map((camp) => {
              const isOwner = camp.ownerUserId === user.id;
              const canGm = isOwner || localAuthEnabled;
              const sysInfo = SYSTEM_META[camp.systemId] ?? {
                label: camp.systemId,
                badgeClass: 'mesa-badge--gold',
              };
              return (
                <article key={camp.id} className="campaign-card">
                  <div className="campaign-card__cover">
                    <img
                      src={camp.coverUrl || './assets/banner-mesa-rpg.svg'}
                      alt={camp.name}
                    />
                    <div className="campaign-card__cover-badges">
                      <span className={`mesa-badge ${sysInfo.badgeClass}`}>{sysInfo.label}</span>
                      <span
                        className="mesa-badge"
                        style={{ fontFamily: 'var(--font-mono)', background: 'rgba(12,15,20,0.82)' }}
                      >
                        {camp.inviteCode}
                      </span>
                    </div>
                  </div>

                  <div className="campaign-card__body">
                    <h3 className="campaign-card__title">{camp.name}</h3>
                    <p className="campaign-card__desc">{camp.description}</p>

                    <div className="campaign-card__meta">
                      {camp.gmName && (
                        <span className="campaign-card__meta-item">
                          <Crown size={13} color="#d4a84f" />
                          {camp.gmName}
                        </span>
                      )}
                      <span className="campaign-card__meta-item">
                        <Users size={13} />
                        {camp.memberCount ?? 1} na mesa
                      </span>
                      {(camp.voiceActiveCount ?? 0) > 0 && (
                        <span
                          className="campaign-card__meta-item"
                          style={{ color: 'var(--emerald-400)' }}
                        >
                          <Mic size={13} />
                          {camp.voiceActiveCount} na voz
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="campaign-card__actions">
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--gold mesa-btn--sm"
                      disabled={joiningId !== null}
                      onClick={() => handleJoinCampaign(camp, isOwner ? 'gm' : 'player')}
                    >
                      {joiningId === `${camp.id}:${isOwner ? 'gm' : 'player'}` ? (
                        <Loader2 size={14} className="mesa-spin" />
                      ) : isOwner ? (
                        <Crown size={14} />
                      ) : (
                        <Sword size={14} />
                      )}
                      {isOwner ? 'Mestrar' : 'Jogar'}
                    </button>

                    {canGm && !isOwner && (
                      <button
                        type="button"
                        className="mesa-btn mesa-btn--sm"
                        disabled={joiningId !== null}
                        onClick={() => handleJoinCampaign(camp, 'gm')}
                      >
                        {joiningId === `${camp.id}:gm` ? (
                          <Loader2 size={14} className="mesa-spin" />
                        ) : (
                          <Crown size={14} color="#f2cc7b" />
                        )}
                        Mestre
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>

      <CreateCampaignModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(camp) => {
          setCreateOpen(false);
          onEnterCampaign(camp, 'gm');
        }}
      />

      <JoinByCodeModal
        open={joinCodeOpen}
        localAuthEnabled={localAuthEnabled}
        onClose={() => setJoinCodeOpen(false)}
        onJoined={(camp, joinedRole) => {
          setJoinCodeOpen(false);
          onEnterCampaign(camp, joinedRole);
        }}
      />
    </div>
  );
}

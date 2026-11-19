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

type SystemFilter = 'all' | 'mighty-blade-3e' | 'generic-rpg';

const SYSTEM_LABELS: Record<string, string> = {
  'mighty-blade-3e': 'Mighty Blade 3ª Ed.',
  'generic-rpg': 'RPG Genérico',
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

  const demoCampaign = useMemo(
    () =>
      campaigns.find((c) => c.inviteCode?.toUpperCase() === 'DRAKON') ??
      campaigns[0] ??
      null,
    [campaigns]
  );

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
        {/* Featured Hero Banner */}
        <section className="lobby-hero">
          <img
            className="lobby-hero__bg"
            src="./assets/banner-mesa-rpg.svg"
            alt="Crônicas de Drakon — Mesa VTT"
          />
          <div className="lobby-hero__scrim" />
          <div className="lobby-hero__content">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="mesa-badge mesa-badge--gold">
                <Shield size={12} />
                Mighty Blade 3ª Edição
              </span>
              <span className="mesa-badge mesa-badge--emerald">
                <Mic size={12} />
                Voz Estilo Discord Integrada
              </span>
              {demoCampaign && (
                <span className="mesa-badge" style={{ fontFamily: 'var(--font-mono)' }}>
                  Código: {demoCampaign.inviteCode}
                </span>
              )}
            </div>

            <h2 className="lobby-hero__title">
              {demoCampaign ? (
                <>
                  <span>Crônicas de Drakon</span> — A Estalagem do Javali Dourado
                </>
              ) : (
                <>
                  Sua Mesa de RPG, <span>Onde Você Estiver</span>
                </>
              )}
            </h2>

            <p className="lobby-hero__desc">
              Mapa tático com Névoa de Guerra, dados 3D sincronizados, fichas automatizadas de
              Mighty Blade 3ª Edição, pastas com permissões de Mestre e canal de voz em 1 toque —
              no computador ou no celular.
            </p>

            <div className="lobby-hero__cta">
              {demoCampaign ? (
                <>
                  <button
                    type="button"
                    className="mesa-btn mesa-btn--gold"
                    disabled={joiningId !== null}
                    onClick={() => handleJoinCampaign(demoCampaign, 'player')}
                  >
                    {joiningId === `${demoCampaign.id}:player` ? (
                      <Loader2 size={15} className="mesa-spin" />
                    ) : (
                      <Sword size={15} />
                    )}
                    Entrar como Jogador
                  </button>

                  {(localAuthEnabled || demoCampaign.ownerUserId === user.id) && (
                    <button
                      type="button"
                      className="mesa-btn"
                      disabled={joiningId !== null}
                      onClick={() => handleJoinCampaign(demoCampaign, 'gm')}
                    >
                      {joiningId === `${demoCampaign.id}:gm` ? (
                        <Loader2 size={15} className="mesa-spin" />
                      ) : (
                        <Crown size={15} color="#f2cc7b" />
                      )}
                      Entrar como Mestre
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="mesa-btn mesa-btn--gold"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus size={15} />
                  Criar Primeira Campanha
                </button>
              )}
            </div>
          </div>
        </section>

        {error && <div className="voice-error-banner">{error}</div>}

        {/* Filter & Search Toolbar */}
        <section className="lobby-toolbar">
          <div className="lobby-pills" role="tablist" aria-label="Filtrar por sistema">
            {(
              [
                ['all', 'Todos os Sistemas'],
                ['mighty-blade-3e', 'Mighty Blade 3ª Ed.'],
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
              const sysLabel = SYSTEM_LABELS[camp.systemId] ?? camp.systemId;
              return (
                <article key={camp.id} className="campaign-card">
                  <div className="campaign-card__cover">
                    <img
                      src={camp.coverUrl || './assets/banner-mesa-rpg.svg'}
                      alt={camp.name}
                    />
                    <div className="campaign-card__cover-badges">
                      <span className="mesa-badge mesa-badge--gold">{sysLabel}</span>
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

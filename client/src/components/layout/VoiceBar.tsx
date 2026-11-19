import React from 'react';
import {
  AlertTriangle,
  ChevronDown,
  HeadphoneOff,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
} from 'lucide-react';
import { useCampaignStore, useVoice } from '@/lib/store';

interface VoiceBarProps {
  /** Compact inline mode for Desktop TopBar vs full-width persistent Mobile bar */
  variant?: 'mobile-bar' | 'topbar-pill';
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function VoiceBar({ variant = 'mobile-bar' }: VoiceBarProps) {
  const { user, campaign } = useCampaignStore();
  const voice = useVoice();

  const isConnected = voice.status === 'connected' || voice.status === 'reconnecting';
  const isJoining = voice.status === 'joining';

  const activeChannel =
    voice.activeChannel ?? voice.channels.find((c) => c.isDefault) ?? voice.channels[0] ?? null;
  const totalInVoice = voice.channels.reduce((acc, ch) => acc + ch.participants.length, 0);

  const visibleParticipants = (activeChannel?.participants ?? []).map((p) => {
    const isMe = p.userId === user.id;
    return {
      ...p,
      speaking: isMe ? voice.speaking : p.speaking || Boolean(voice.remoteSpeaking[p.userId]),
      muted: isMe ? voice.muted : p.muted,
      deafened: isMe ? voice.deafened : p.deafened,
    };
  });

  // Ensure local user avatar appears immediately even before voice.state echoes back
  if (
    isConnected &&
    !visibleParticipants.some((p) => p.userId === user.id)
  ) {
    visibleParticipants.unshift({
      userId: user.id,
      displayName: user.displayName,
      portraitUrl: user.avatarUrl,
      muted: voice.muted,
      deafened: voice.deafened,
      speaking: voice.speaking,
    });
  }

  const handleQuickJoin = () => {
    voice.unlockAudio();
    void voice.joinVoice(activeChannel?.id);
  };

  if (variant === 'topbar-pill') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {!isConnected && !isJoining ? (
          <button
            type="button"
            className="voice-ctrl-btn voice-ctrl-btn--join"
            onClick={handleQuickJoin}
            title="Entrar no canal de voz da mesa"
          >
            <Volume2 size={15} />
            <span>Voz{totalInVoice > 0 ? ` (${totalInVoice})` : ''}</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              className="voice-bar__channel-btn"
              onClick={() => voice.setVoicePanelOpen(true)}
              title="Abrir painel de canais de voz e volumes"
              style={{
                borderColor: 'rgba(34, 197, 94, 0.45)',
                background: 'rgba(34, 197, 94, 0.1)',
              }}
            >
              <span
                className="conn-dot conn-dot--connected"
                style={{
                  boxShadow: voice.speaking
                    ? '0 0 0 3px rgba(34,197,94,0.4), 0 0 12px #22c55e'
                    : undefined,
                }}
              />
              <span className="voice-bar__channel-name">
                {activeChannel?.name ?? 'Mesa Principal'}
              </span>
              <span style={{ color: 'var(--emerald-400)', fontSize: 11 }}>
                {visibleParticipants.length}
              </span>
              <ChevronDown size={13} />
            </button>

            <button
              type="button"
              className={`voice-ctrl-btn ${
                voice.muted || voice.listenOnly ? 'voice-ctrl-btn--active-danger' : ''
              }`}
              onClick={voice.toggleMute}
              title={
                voice.listenOnly
                  ? 'Microfone indisponível — clique para tentar novamente'
                  : voice.muted
                  ? 'Ativar microfone'
                  : 'Mutar microfone'
              }
              aria-label={voice.muted ? 'Ativar microfone' : 'Mutar microfone'}
            >
              {voice.muted || voice.listenOnly ? <MicOff size={15} /> : <Mic size={15} />}
            </button>

            <button
              type="button"
              className={`voice-ctrl-btn ${voice.deafened ? 'voice-ctrl-btn--active-danger' : ''}`}
              onClick={voice.toggleDeafen}
              title={voice.deafened ? 'Voltar a ouvir a mesa' : 'Ensurdecer (silenciar áudio e mic)'}
              aria-label={voice.deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
            >
              {voice.deafened ? <HeadphoneOff size={15} /> : <Headphones size={15} />}
            </button>

            <button
              type="button"
              className="voice-ctrl-btn voice-ctrl-btn--active-danger"
              onClick={voice.leaveVoice}
              title="Desconectar da voz"
              aria-label="Desconectar da voz"
            >
              <PhoneOff size={15} />
            </button>
          </>
        )}
      </div>
    );
  }

  // Persistent Mobile Discord Voice Bar (always mounted at top of TableShell)
  return (
    <div
      className={`voice-bar ${isConnected ? 'voice-bar--connected' : ''}`}
      role="region"
      aria-label="Canal de Voz da Campanha"
    >
      <div className="voice-bar__left">
        <button
          type="button"
          className="voice-bar__channel-btn"
          onClick={() => voice.setVoicePanelOpen(true)}
          aria-label="Abrir canais de voz"
        >
          {isConnected ? (
            <span className="conn-dot conn-dot--connected" />
          ) : (
            <Volume2 size={14} color="#d4a84f" />
          )}
          <span className="voice-bar__channel-name">
            {isConnected
              ? activeChannel?.name ?? 'Mesa Principal'
              : campaign?.name ?? 'Voz da Mesa'}
          </span>
          {!isConnected && totalInVoice > 0 && (
            <span className="mesa-badge mesa-badge--emerald" style={{ padding: '0 6px' }}>
              {totalInVoice}
            </span>
          )}
          <ChevronDown size={13} />
        </button>

        {isConnected && (
          <div className="voice-bar__avatars">
            {visibleParticipants.slice(0, 4).map((p) => (
              <div
                key={p.userId}
                className={`voice-avatar ${p.speaking ? 'voice-avatar--speaking' : ''} ${
                  p.muted ? 'voice-avatar--muted' : ''
                }`}
                title={`${p.displayName}${p.speaking ? ' (falando)' : ''}${
                  p.muted ? ' (mutado)' : ''
                }`}
              >
                {p.portraitUrl ? (
                  <img src={p.portraitUrl} alt={p.displayName} />
                ) : (
                  initialsOf(p.displayName)
                )}
              </div>
            ))}
            {visibleParticipants.length > 4 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                +{visibleParticipants.length - 4}
              </span>
            )}
          </div>
        )}

        {voice.listenOnly && isConnected && (
          <button
            type="button"
            className="mesa-badge"
            style={{
              background: 'var(--amber-soft)',
              borderColor: 'rgba(245,158,11,0.5)',
              color: '#fde68a',
            }}
            onClick={() => voice.setVoicePanelOpen(true)}
            title={voice.micError ?? 'Modo Ouvinte'}
          >
            <AlertTriangle size={11} />
            Ouvinte
          </button>
        )}
      </div>

      <div className="voice-bar__controls">
        {!isConnected && !isJoining ? (
          <button
            type="button"
            className="voice-ctrl-btn voice-ctrl-btn--join"
            onClick={handleQuickJoin}
          >
            <Mic size={15} />
            <span>Entrar na Voz</span>
          </button>
        ) : isJoining ? (
          <button type="button" className="voice-ctrl-btn" disabled>
            <Loader2 size={15} className="mesa-spin" />
            <span>Conectando...</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              className={`voice-ctrl-btn ${
                voice.muted || voice.listenOnly ? 'voice-ctrl-btn--active-danger' : ''
              }`}
              onClick={voice.toggleMute}
              aria-label={voice.muted ? 'Ativar microfone' : 'Mutar microfone'}
            >
              {voice.muted || voice.listenOnly ? <MicOff size={16} /> : <Mic size={16} />}
            </button>

            <button
              type="button"
              className={`voice-ctrl-btn ${voice.deafened ? 'voice-ctrl-btn--active-danger' : ''}`}
              onClick={voice.toggleDeafen}
              aria-label={voice.deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
            >
              {voice.deafened ? <HeadphoneOff size={16} /> : <Headphones size={16} />}
            </button>

            <button
              type="button"
              className="voice-ctrl-btn voice-ctrl-btn--active-danger"
              onClick={voice.leaveVoice}
              aria-label="Sair do canal de voz"
            >
              <PhoneOff size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import {
  AlertTriangle,
  HeadphoneOff,
  Headphones,
  Lock,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  RefreshCw,
  Trash2,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from 'lucide-react';
import { useCampaignStore, useVoice } from '@/lib/store';

interface VoicePanelProps {
  /** Whether rendered inside a dismissible sheet/modal vs docked permanently in sidebar */
  onClose?: () => void;
  compact?: boolean;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function VoicePanel({ onClose, compact = false }: VoicePanelProps) {
  const { user, isGm } = useCampaignStore();
  const voice = useVoice();

  const [creating, setCreating] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelLocked, setNewChannelLocked] = useState(false);
  const [expandedPeerId, setExpandedPeerId] = useState<string | null>(null);

  const isConnected = voice.status === 'connected' || voice.status === 'reconnecting';

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newChannelName.trim();
    if (!trimmed) return;
    await voice.createVoiceChannel(trimmed, newChannelLocked);
    setNewChannelName('');
    setNewChannelLocked(false);
    setCreating(false);
  };

  return (
    <div className="voice-panel" style={compact ? { padding: 10, gap: 8 } : undefined}>
      <div className="voice-panel__header">
        <div className="voice-panel__title">
          <Volume2 size={14} color={isConnected ? '#4ade80' : '#d4a84f'} />
          <span>Canais de Voz</span>
          {isConnected && (
            <span className="mesa-badge mesa-badge--emerald" style={{ fontSize: 10 }}>
              Conectado
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isGm && (
            <button
              type="button"
              className="mesa-btn mesa-btn--ghost mesa-btn--sm"
              style={{ minHeight: 28, padding: '2px 7px' }}
              onClick={() => setCreating((v) => !v)}
              title="Criar novo canal de voz (Mestre)"
            >
              <Plus size={14} />
              {!compact && <span>Canal</span>}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="mesa-btn mesa-btn--ghost mesa-btn--icon"
              style={{ width: 30, height: 30, minWidth: 30 }}
              onClick={onClose}
              aria-label="Fechar painel de voz"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Friendly Portuguese Mic Error / Listen-Only Banner */}
      {voice.micError && (
        <div className="voice-error-banner" role="alert">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{voice.micError}</span>
          </div>
          <button
            type="button"
            className="mesa-btn mesa-btn--sm"
            style={{ alignSelf: 'flex-start', borderColor: 'rgba(245,158,11,0.5)' }}
            onClick={() => void voice.retryMic()}
          >
            <RefreshCw size={12} />
            Tentar ativar microfone
          </button>
        </div>
      )}

      {/* GM Create Voice Channel Form */}
      {creating && isGm && (
        <form
          onSubmit={handleCreateChannel}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 10,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-obsidian)',
            border: '1px solid var(--border-gold)',
          }}
        >
          <input
            type="text"
            className="mesa-input"
            placeholder="Nome do canal (ex: Sussurro do Mestre)"
            value={newChannelName}
            onChange={(e) => setNewChannelName(e.target.value)}
            maxLength={40}
            autoFocus
          />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={newChannelLocked}
              onChange={(e) => setNewChannelLocked(e.target.checked)}
            />
            <span>Trancado para jogadores (sala privada do Mestre)</span>
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              type="button"
              className="mesa-btn mesa-btn--ghost mesa-btn--sm"
              onClick={() => setCreating(false)}
            >
              Cancelar
            </button>
            <button type="submit" className="mesa-btn mesa-btn--gold mesa-btn--sm">
              Criar Canal
            </button>
          </div>
        </form>
      )}

      {/* Channel List */}
      <div className="voice-channel-list">
        {voice.channels.map((ch) => {
          const isActiveChannel = voice.activeChannelId === ch.id && isConnected;
          const lockedOut = Boolean(ch.lockedForPlayers) && !isGm;

          const participants = ch.participants.map((p) => {
            const isMe = p.userId === user.id;
            return {
              ...p,
              speaking: isMe
                ? voice.speaking
                : p.speaking || Boolean(voice.remoteSpeaking[p.userId]),
              muted: isMe ? voice.muted : p.muted,
              deafened: isMe ? voice.deafened : p.deafened,
            };
          });

          if (isActiveChannel && !participants.some((p) => p.userId === user.id)) {
            participants.unshift({
              userId: user.id,
              displayName: user.displayName,
              portraitUrl: user.avatarUrl,
              muted: voice.muted,
              deafened: voice.deafened,
              speaking: voice.speaking,
            });
          }

          return (
            <div
              key={ch.id}
              className={`voice-channel-card ${isActiveChannel ? 'voice-channel-card--active' : ''}`}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  type="button"
                  className="voice-channel-row"
                  disabled={lockedOut}
                  onClick={() => {
                    voice.unlockAudio();
                    if (!isActiveChannel) {
                      void voice.switchVoiceChannel(ch.id);
                    }
                  }}
                >
                  <span className="voice-channel-row__name">
                    {ch.lockedForPlayers ? (
                      <Lock size={14} color="#c084fc" />
                    ) : (
                      <Volume2 size={14} color={isActiveChannel ? '#4ade80' : '#7f8ba3'} />
                    )}
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ch.name}
                    </span>
                  </span>

                  <span
                    style={{
                      fontSize: 11,
                      color: isActiveChannel ? 'var(--emerald-400)' : 'var(--text-muted)',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {isActiveChannel
                      ? 'Na sala'
                      : lockedOut
                      ? 'Restrito'
                      : participants.length > 0
                      ? `${participants.length} online`
                      : 'Entrar'}
                  </span>
                </button>

                {isGm && !ch.isDefault && (
                  <button
                    type="button"
                    className="mesa-btn mesa-btn--ghost"
                    style={{ minHeight: 30, padding: '0 8px', color: 'var(--text-muted)' }}
                    onClick={() => void voice.deleteVoiceChannel(ch.id)}
                    title="Remover canal de voz"
                    aria-label={`Remover canal ${ch.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {participants.length > 0 && (
                <div className="voice-participant-list">
                  {participants.map((p) => {
                    const isMe = p.userId === user.id;
                    const vol = voice.peerVolumes[p.userId] ?? 1;
                    const peerStatus = voice.peerStatuses[p.userId];
                    const showSlider =
                      !isMe && isActiveChannel && (!compact || expandedPeerId === p.userId);

                    return (
                      <div key={p.userId} className="voice-participant-item">
                        <div className="voice-participant-item__top">
                          <div
                            className="voice-participant-item__id"
                            style={{ cursor: !isMe && isActiveChannel ? 'pointer' : 'default' }}
                            onClick={() => {
                              if (!isMe && isActiveChannel && compact) {
                                setExpandedPeerId((prev) => (prev === p.userId ? null : p.userId));
                              }
                            }}
                          >
                            <div
                              className={`voice-avatar ${
                                p.speaking ? 'voice-avatar--speaking' : ''
                              } ${p.muted ? 'voice-avatar--muted' : ''}`}
                              style={{ width: 24, height: 24, fontSize: 10 }}
                            >
                              {p.portraitUrl ? (
                                <img src={p.portraitUrl} alt={p.displayName} />
                              ) : (
                                initialsOf(p.displayName)
                              )}
                            </div>
                            <span className="voice-participant-item__name">
                              {p.displayName}
                              {isMe ? ' (você)' : ''}
                            </span>
                          </div>

                          <div className="voice-participant-item__icons">
                            {!isMe && peerStatus && (
                              <span
                                title={`Conexão P2P: ${peerStatus}`}
                                style={{
                                  color:
                                    peerStatus === 'connected'
                                      ? 'var(--emerald-400)'
                                      : peerStatus === 'failed'
                                      ? 'var(--crimson-400)'
                                      : 'var(--amber-400)',
                                }}
                              >
                                <Wifi size={12} />
                              </span>
                            )}
                            {p.muted && <MicOff size={13} color="#f87171" />}
                            {p.deafened && <HeadphoneOff size={13} color="#f87171" />}
                          </div>
                        </div>

                        {showSlider && (
                          <div className="voice-volume-row">
                            {vol <= 0.01 ? <VolumeX size={12} /> : <Volume2 size={12} />}
                            <input
                              type="range"
                              className="voice-volume-slider"
                              min={0}
                              max={200}
                              step={5}
                              value={Math.round(vol * 100)}
                              onChange={(e) =>
                                voice.setPeerVolume(p.userId, Number(e.target.value) / 100)
                              }
                              aria-label={`Volume de ${p.displayName}`}
                            />
                            <span style={{ minWidth: 34, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                              {Math.round(vol * 100)}%
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Live Local Mic Input Level Bar */}
      {isConnected && !voice.listenOnly && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--text-muted)',
            }}
          >
            <span>{voice.muted ? 'Microfone mutado' : voice.speaking ? 'Falando...' : 'Microfone ativo'}</span>
            <span>{voice.deafened ? 'Áudio silenciado' : 'WebRTC P2P'}</span>
          </div>
          <div className="voice-mic-meter">
            <div
              className="voice-mic-meter__fill"
              style={{
                width: `${voice.muted || voice.deafened ? 0 : Math.round(voice.micLevel * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 1-Tap Discord Controls */}
      <div className="voice-footer-controls">
        {!isConnected ? (
          <button
            type="button"
            className="voice-ctrl-btn voice-ctrl-btn--join"
            onClick={() => {
              voice.unlockAudio();
              void voice.joinVoice();
            }}
          >
            <Mic size={15} />
            <span>Entrar na Voz</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              className={`voice-ctrl-btn ${
                voice.muted || voice.listenOnly ? 'voice-ctrl-btn--active-danger' : ''
              }`}
              onClick={voice.toggleMute}
              title={voice.muted ? 'Ativar microfone' : 'Mutar microfone'}
            >
              {voice.muted || voice.listenOnly ? <MicOff size={15} /> : <Mic size={15} />}
              {!compact && <span>{voice.muted ? 'Desmutar' : 'Mutar'}</span>}
            </button>

            <button
              type="button"
              className={`voice-ctrl-btn ${voice.deafened ? 'voice-ctrl-btn--active-danger' : ''}`}
              onClick={voice.toggleDeafen}
              title={voice.deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
            >
              {voice.deafened ? <HeadphoneOff size={15} /> : <Headphones size={15} />}
              {!compact && <span>{voice.deafened ? 'Ouvir' : 'Silenciar'}</span>}
            </button>

            <button
              type="button"
              className="voice-ctrl-btn voice-ctrl-btn--active-danger"
              onClick={voice.leaveVoice}
              title="Desconectar da voz"
            >
              <PhoneOff size={15} />
              {!compact && <span>Sair</span>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

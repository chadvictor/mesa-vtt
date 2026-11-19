import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Dices,
  Lock,
  MessageSquare,
  ScrollText,
  Sparkles,
  Swords,
  X,
} from 'lucide-react';
import type { ChatMessage } from '@systems/types';
import type { ChatPanelProps } from '@/lib/componentProps';
import { useCampaignStore } from '@/lib/store';
import { RollCard } from './RollCard';

type ChatFilter = 'all' | 'ic' | 'rolls' | 'whispers';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDayGroup(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `Hoje · ${formatTime(iso)}`;
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ` · ${formatTime(iso)}`;
}

function shouldShowGroupHeader(prev: ChatMessage | undefined, curr: ChatMessage): boolean {
  if (!prev) return true;
  const t1 = new Date(prev.createdAt).getTime();
  const t2 = new Date(curr.createdAt).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) return false;
  return t2 - t1 > 5 * 60 * 1000;
}

/** Renders simple inline formatting (*italic*, **bold**) and embedded handout images safely */
function renderMessageContent(content: string): React.ReactNode {
  const imgMatch = content.match(/!\[([^\]]*)\]\(([^)]+)\)/);
  const textWithoutImg = imgMatch ? content.replace(imgMatch[0], '').trim() : content;

  const lines = textWithoutImg.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const parts: React.ReactNode[] = [];
        const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(line)) !== null) {
          if (match.index > lastIndex) {
            parts.push(line.slice(lastIndex, match.index));
          }
          const token = match[0];
          if (token.startsWith('**') && token.endsWith('**')) {
            parts.push(
              <strong key={`${i}-${match.index}`} style={{ color: 'var(--text-primary)' }}>
                {token.slice(2, -2)}
              </strong>
            );
          } else {
            parts.push(
              <em key={`${i}-${match.index}`} style={{ color: 'var(--gold-400)' }}>
                {token.slice(1, -1)}
              </em>
            );
          }
          lastIndex = regex.lastIndex;
        }
        if (lastIndex < line.length) {
          parts.push(line.slice(lastIndex));
        }
        return (
          <React.Fragment key={i}>
            {parts}
            {i < lines.length - 1 && <br />}
          </React.Fragment>
        );
      })}
      {imgMatch && (
        <div style={{ marginTop: 8 }}>
          <img
            src={imgMatch[2]}
            alt={imgMatch[1] || 'Handout'}
            style={{
              maxWidth: '100%',
              maxHeight: 240,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-gold)',
              display: 'block',
            }}
          />
        </div>
      )}
    </>
  );
}

export function ChatPanel({ compact = false, floating = false, onCloseFloating }: ChatPanelProps) {
  const { messages, members, characters, setOpenSheetCharacterId, user } = useCampaignStore();
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [stickToBottom, setStickToBottom] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevLenRef = useRef(messages.length);

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.userId, m.displayName);
    return map;
  }, [members]);

  const charById = useMemo(() => {
    const map = new Map(characters.map((c) => [c.id, c]));
    return map;
  }, [characters]);

  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (filter === 'all') return true;
      if (filter === 'ic') return msg.kind === 'ic' || msg.kind === 'narration';
      if (filter === 'rolls') return msg.kind === 'roll' || msg.kind === 'combat_action';
      if (filter === 'whispers') {
        return (
          msg.kind === 'whisper' ||
          msg.visibility === 'gm_only' ||
          msg.visibility === 'specific_players'
        );
      }
      return true;
    });
  }, [messages, filter]);

  const scrollToBottom = (smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setStickToBottom(true);
    setPendingCount(0);
  };

  useEffect(() => {
    const newMessages = messages.length - prevLenRef.current;
    prevLenRef.current = messages.length;
    if (stickToBottom) {
      scrollToBottom(newMessages > 0 && newMessages <= 3);
    } else if (newMessages > 0) {
      setPendingCount((c) => c + newMessages);
    }
  }, [messages.length, filter, stickToBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 48;
    setStickToBottom(nearBottom);
    if (nearBottom) setPendingCount(0);
  };

  const tabs: Array<{ id: ChatFilter; label: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'ic', label: 'Em Personagem' },
    { id: 'rolls', label: 'Rolagens' },
    { id: 'whispers', label: 'Sussurros' },
  ];

  const formatRecipients = (msg: ChatMessage): string => {
    if (msg.visibility === 'gm_only') return 'Mestre';
    const ids = (msg.visibleToUserIds ?? []).filter((id) => id !== msg.senderUserId);
    if (ids.length === 0) return 'Privado';
    return ids.map((id) => memberNameById.get(id) ?? 'Jogador').join(', ');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        position: 'relative',
      }}
    >
      {/* Header / Filter Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: compact || floating ? '6px 10px' : '7px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'rgba(20, 25, 34, 0.92)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          {tabs.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                style={{
                  padding: compact ? '4px 8px' : '4px 10px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  background: active ? 'var(--gold-soft)' : 'transparent',
                  border: `1px solid ${active ? 'var(--border-gold)' : 'transparent'}`,
                  color: active ? 'var(--gold-400)' : 'var(--text-muted)',
                  transition: 'all 120ms ease',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {floating && onCloseFloating && (
          <button
            type="button"
            className="mesa-btn mesa-btn--ghost mesa-btn--sm"
            onClick={onCloseFloating}
            aria-label="Minimizar chat"
            style={{ padding: '4px 6px', minHeight: 26 }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Scrollable Message Stream */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: compact ? '10px 10px 14px' : '12px 14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {filteredMessages.length === 0 && (
          <div
            style={{
              margin: 'auto',
              textAlign: 'center',
              padding: '28px 16px',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <MessageSquare size={26} style={{ opacity: 0.45, color: 'var(--gold-500)' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {filter === 'all'
                ? 'A taverna está silenciosa...'
                : 'Nenhuma mensagem neste filtro.'}
            </div>
            <div style={{ fontSize: 12 }}>
              Escreva em personagem ou role dados usando <code style={{ color: 'var(--gold-400)' }}>/r 2d6+3</code>
            </div>
          </div>
        )}

        {filteredMessages.map((msg, index) => {
          const prev = index > 0 ? filteredMessages[index - 1] : undefined;
          const showGroup = shouldShowGroupHeader(prev, msg);
          const linkedChar = msg.characterId ? charById.get(msg.characterId) : undefined;
          const portrait = msg.portraitUrl ?? linkedChar?.portraitUrl;
          const isMe = msg.senderUserId === user.id;

          return (
            <React.Fragment key={msg.id}>
              {showGroup && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    margin: '4px 0 2px',
                  }}
                >
                  <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {formatDayGroup(msg.createdAt)}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
                </div>
              )}

              {/* Narration Banner */}
              {msg.kind === 'narration' && (
                <div
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(44, 36, 23, 0.85) 0%, rgba(28, 25, 20, 0.94) 100%)',
                    border: '1px solid var(--parchment-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    textAlign: 'center',
                    boxShadow: 'inset 0 0 24px rgba(212, 168, 79, 0.06)',
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 10,
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      color: 'var(--gold-400)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      marginBottom: 5,
                    }}
                  >
                    <ScrollText size={11} />
                    <span>Narração · {msg.senderName}</span>
                  </div>
                  <div
                    style={{
                      fontFamily: 'Georgia, "Palatino Linotype", serif',
                      fontStyle: 'italic',
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: '#f3ead8',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {renderMessageContent(msg.content)}
                  </div>
                </div>
              )}

              {/* System / Combat Action Notice */}
              {(msg.kind === 'system' || msg.kind === 'combat_action') && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '5px 12px',
                    borderRadius: 'var(--radius-full)',
                    background:
                      msg.kind === 'combat_action'
                        ? 'rgba(212, 168, 79, 0.1)'
                        : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${
                      msg.kind === 'combat_action' ? 'var(--border-gold)' : 'var(--border-subtle)'
                    }`,
                    color: msg.kind === 'combat_action' ? 'var(--gold-400)' : 'var(--text-muted)',
                    fontSize: 12,
                    alignSelf: 'center',
                    maxWidth: '94%',
                    textAlign: 'center',
                  }}
                >
                  {msg.kind === 'combat_action' ? <Swords size={12} /> : <Sparkles size={12} />}
                  <span>{msg.content}</span>
                </div>
              )}

              {/* Whisper Message */}
              {msg.kind === 'whisper' && (
                <div
                  style={{
                    background: 'rgba(168, 85, 247, 0.1)',
                    border: '1px solid rgba(168, 85, 247, 0.36)',
                    borderLeft: '3px solid var(--amethyst-400)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '9px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="mesa-badge mesa-badge--amethyst">
                        <Lock size={10} />
                        Sussurro
                      </span>
                      <span style={{ fontWeight: 700, fontSize: 12, color: '#e9d5ff' }}>
                        {msg.characterName ?? msg.senderName}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--amethyst-400)' }}>
                        → {formatRecipients(msg)}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {formatTime(msg.createdAt)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: '#f3e8ff',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {renderMessageContent(msg.content)}
                  </div>
                </div>
              )}

              {/* In-Character (IC) Message */}
              {msg.kind === 'ic' && (
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '9px 11px',
                    borderRadius: 'var(--radius-md)',
                    background: isMe
                      ? 'linear-gradient(135deg, rgba(212, 168, 79, 0.08) 0%, rgba(20, 25, 34, 0.92) 60%)'
                      : 'rgba(20, 25, 34, 0.85)',
                    border: '1px solid var(--border-subtle)',
                    borderLeft: '3px solid var(--gold-500)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => msg.characterId && setOpenSheetCharacterId(msg.characterId)}
                    title={msg.characterName ? `Abrir ficha de ${msg.characterName}` : undefined}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                      border: '1px solid var(--border-gold)',
                      background: 'var(--bg-elevated)',
                      flexShrink: 0,
                      cursor: msg.characterId ? 'pointer' : 'default',
                    }}
                  >
                    {portrait ? (
                      <img
                        src={portrait}
                        alt={msg.characterName ?? msg.senderName}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <span
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 700,
                          color: 'var(--gold-400)',
                          fontSize: 15,
                        }}
                      >
                        {(msg.characterName ?? msg.senderName).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </button>

                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: 13,
                            color: 'var(--gold-400)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {msg.characterName ?? msg.senderName}
                        </span>
                        {msg.characterName && msg.characterName !== msg.senderName && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            ({msg.senderName})
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {formatTime(msg.createdAt)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 13.5,
                        color: 'var(--text-primary)',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {renderMessageContent(msg.content)}
                    </div>
                  </div>
                </div>
              )}

              {/* Out-of-Character (OOC) Message */}
              {msg.kind === 'ooc' && (
                <div
                  style={{
                    padding: '7px 11px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: 'var(--bg-elevated)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        OOC
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {msg.senderName}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {formatTime(msg.createdAt)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {renderMessageContent(msg.content)}
                  </div>
                </div>
              )}

              {/* Roll Card Message */}
              {msg.kind === 'roll' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '0 2px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {portrait ? (
                        <img
                          src={portrait}
                          alt={msg.characterName ?? msg.senderName}
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            objectFit: 'cover',
                            border: '1px solid var(--border-gold)',
                          }}
                        />
                      ) : (
                        <Dices size={13} style={{ color: 'var(--gold-400)' }} />
                      )}
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-400)' }}>
                        {msg.characterName ?? msg.senderName}
                      </span>
                      {msg.visibility === 'gm_only' && (
                        <span className="mesa-badge mesa-badge--amethyst" style={{ fontSize: 10 }}>
                          <Lock size={9} /> Secreto (GM)
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {formatTime(msg.createdAt)}
                    </span>
                  </div>
                  <RollCard message={msg} compact={compact} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Scroll-to-bottom floating pill when user scrolled up */}
      {!stickToBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          style={{
            position: 'absolute',
            bottom: 12,
            right: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 12px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--gold-500)',
            color: 'var(--text-inverse)',
            fontSize: 12,
            fontWeight: 700,
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <ArrowDown size={13} />
          {pendingCount > 0 ? `${pendingCount} nova(s)` : 'Ir ao fim'}
        </button>
      )}
    </div>
  );
}

export default ChatPanel;

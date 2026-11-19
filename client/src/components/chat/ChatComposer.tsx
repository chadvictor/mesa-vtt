import React, { useMemo, useState } from 'react';
import {
  Dices,
  Lock,
  MessageCircle,
  ScrollText,
  Send,
  User,
} from 'lucide-react';
import { interpolateFormula } from '@systems/sandbox';
import type { ChatComposerProps } from '@/lib/componentProps';
import { useCampaignStore } from '@/lib/store';

type ComposerMode = 'ic' | 'ooc' | 'narration' | 'whisper';

const SLASH_HINTS = [
  { cmd: '/r 2d6+3', desc: 'Rolar dados (ex: /r 2d6+@forca # Espada)' },
  { cmd: '/gm 2d6', desc: 'Rolagem secreta visível apenas ao Mestre' },
  { cmd: '/me ', desc: 'Descrever ação em cena' },
  { cmd: '/w ', desc: 'Sussurrar para um jogador' },
  { cmd: '/ooc ', desc: 'Falar fora de personagem' },
];

export function ChatComposer({
  activeCharacter,
  onSelectActiveCharacter,
  compact = false,
}: ChatComposerProps) {
  const {
    user,
    isGm,
    members,
    characters,
    targetCharacter,
    sendChat,
    rollDice,
    pushToast,
  } = useCampaignStore();

  const [mode, setMode] = useState<ComposerMode>('ic');
  const [text, setText] = useState('');
  const [whisperTargetId, setWhisperTargetId] = useState<string>('gm');

  // Characters the user can speak as
  const speakableCharacters = useMemo(() => {
    if (isGm) return characters;
    return characters.filter(
      (c) =>
        c.ownerUserId === user.id ||
        c.controlledByUserIds?.includes(user.id) ||
        c.kind === 'pc'
    );
  }, [characters, isGm, user.id]);

  const otherMembers = useMemo(
    () => members.filter((m) => m.userId !== user.id),
    [members, user.id]
  );

  const showSlashHints = text.startsWith('/') && !text.includes(' ');

  const parseAndRoll = (rawArgs: string, secretGm: boolean) => {
    const trimmed = rawArgs.trim();
    if (!trimmed) {
      pushToast('Informe uma fórmula de dados, ex: /r 2d6+3', 'warning');
      return;
    }

    // Optional `# Label` and optional `dif 10`
    let formulaPart = trimmed;
    let label = secretGm ? 'Rolagem Secreta (GM)' : 'Rolagem no Chat';
    const hashIdx = trimmed.indexOf('#');
    if (hashIdx !== -1) {
      formulaPart = trimmed.slice(0, hashIdx).trim();
      const customLabel = trimmed.slice(hashIdx + 1).trim();
      if (customLabel) label = customLabel;
    }

    let difficulty: number | undefined;
    const difMatch = formulaPart.match(/\b(?:dif|dc|cd)\s*(\d+)\b/i);
    if (difMatch) {
      difficulty = Number(difMatch[1]);
      formulaPart = formulaPart.replace(difMatch[0], '').trim();
    }

    const interpolated = interpolateFormula(formulaPart, {
      character: activeCharacter ?? undefined,
      target: targetCharacter ?? undefined,
      user,
    });

    rollDice({
      formula: interpolated,
      label,
      characterId: activeCharacter?.id,
      visibility: secretGm ? 'gm_only' : 'all_players',
      difficulty,
      targetCharacterId: targetCharacter?.id,
      systemMeta: { kind: 'custom', difficulty },
    });
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const raw = text.trim();
    if (!raw) return;

    // Slash commands
    if (raw.startsWith('/')) {
      const spaceIdx = raw.indexOf(' ');
      const cmd = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)).toLowerCase();
      const rest = spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1).trim();

      if (cmd === '/r' || cmd === '/roll' || cmd === '/rolar') {
        parseAndRoll(rest, false);
        setText('');
        return;
      }

      if (cmd === '/gm' || cmd === '/gmroll' || cmd === '/secreto') {
        parseAndRoll(rest, true);
        setText('');
        return;
      }

      if (cmd === '/me' || cmd === '/acao' || cmd === '/ação') {
        if (!rest) return;
        const actorName = activeCharacter?.name ?? user.displayName;
        sendChat({
          kind: mode === 'narration' && isGm ? 'narration' : 'ic',
          content: `*${actorName} ${rest}*`,
          characterId: activeCharacter?.id,
          visibility: 'all_players',
        });
        setText('');
        return;
      }

      if (cmd === '/ooc') {
        if (!rest) return;
        sendChat({
          kind: 'ooc',
          content: rest,
          visibility: 'all_players',
        });
        setText('');
        return;
      }

      if (cmd === '/w' || cmd === '/whisper' || cmd === '/sussurro') {
        const firstSpace = rest.indexOf(' ');
        if (firstSpace === -1) {
          pushToast('Uso: /w <nome> <mensagem>', 'warning');
          return;
        }
        const targetToken = rest.slice(0, firstSpace).toLowerCase();
        const body = rest.slice(firstSpace + 1).trim();
        if (!body) return;

        if (targetToken === 'gm' || targetToken === 'mestre') {
          const gmMember = members.find((m) => m.role === 'gm');
          sendChat({
            kind: 'whisper',
            content: body,
            characterId: activeCharacter?.id,
            visibility: gmMember ? 'specific_players' : 'gm_only',
            visibleToUserIds: gmMember ? [user.id, gmMember.userId] : [user.id],
          });
          setText('');
          return;
        }

        const matchedMember = otherMembers.find((m) =>
          m.displayName.toLowerCase().startsWith(targetToken)
        );
        if (!matchedMember) {
          pushToast(`Jogador "${targetToken}" não encontrado na mesa.`, 'warning');
          return;
        }
        sendChat({
          kind: 'whisper',
          content: body,
          characterId: activeCharacter?.id,
          visibility: 'specific_players',
          visibleToUserIds: [user.id, matchedMember.userId],
        });
        setText('');
        return;
      }
    }

    // Standard mode dispatch
    if (mode === 'whisper') {
      if (whisperTargetId === 'gm') {
        const gmMember = members.find((m) => m.role === 'gm');
        sendChat({
          kind: 'whisper',
          content: raw,
          characterId: activeCharacter?.id,
          visibility: gmMember ? 'specific_players' : 'gm_only',
          visibleToUserIds: gmMember ? [user.id, gmMember.userId] : [user.id],
        });
      } else {
        sendChat({
          kind: 'whisper',
          content: raw,
          characterId: activeCharacter?.id,
          visibility: 'specific_players',
          visibleToUserIds: [user.id, whisperTargetId],
        });
      }
    } else if (mode === 'narration' && isGm) {
      sendChat({
        kind: 'narration',
        content: raw,
        visibility: 'all_players',
      });
    } else if (mode === 'ooc') {
      sendChat({
        kind: 'ooc',
        content: raw,
        visibility: 'all_players',
      });
    } else {
      sendChat({
        kind: activeCharacter ? 'ic' : 'ooc',
        content: raw,
        characterId: activeCharacter?.id,
        visibility: 'all_players',
      });
    }

    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: compact ? '6px 8px 8px' : '8px 10px 10px',
        position: 'relative',
      }}
    >
      {/* Slash command helper popover */}
      {showSlashHints && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: '100%',
            marginBottom: 4,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-gold)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-lg)',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 30,
          }}
        >
          {SLASH_HINTS.filter((h) => h.cmd.startsWith(text.toLowerCase())).map((hint) => (
            <button
              key={hint.cmd}
              type="button"
              onClick={() => setText(hint.cmd)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                textAlign: 'left',
                fontSize: 12,
                color: 'var(--text-primary)',
              }}
            >
              <code style={{ color: 'var(--gold-400)', fontWeight: 700 }}>{hint.cmd}</code>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{hint.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Mode Switcher + Context Selector */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: 'var(--bg-obsidian)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-xs)',
            padding: 2,
            gap: 2,
          }}
        >
          <button
            type="button"
            onClick={() => setMode('ic')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 700,
              background: mode === 'ic' ? 'var(--gold-soft)' : 'transparent',
              color: mode === 'ic' ? 'var(--gold-400)' : 'var(--text-muted)',
            }}
          >
            <User size={11} />
            IC
          </button>

          <button
            type="button"
            onClick={() => setMode('ooc')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 700,
              background: mode === 'ooc' ? 'var(--bg-elevated)' : 'transparent',
              color: mode === 'ooc' ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            <MessageCircle size={11} />
            OOC
          </button>

          {isGm && (
            <button
              type="button"
              onClick={() => setMode('narration')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 700,
                background: mode === 'narration' ? 'rgba(212, 168, 79, 0.22)' : 'transparent',
                color: mode === 'narration' ? '#fde68a' : 'var(--text-muted)',
              }}
            >
              <ScrollText size={11} />
              Narração
            </button>
          )}

          <button
            type="button"
            onClick={() => setMode('whisper')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 700,
              background: mode === 'whisper' ? 'var(--amethyst-soft)' : 'transparent',
              color: mode === 'whisper' ? 'var(--amethyst-400)' : 'var(--text-muted)',
            }}
          >
            <Lock size={11} />
            Sussurro
          </button>
        </div>

        {/* IC Active Character Selector */}
        {mode === 'ic' && speakableCharacters.length > 0 && (
          <select
            aria-label="Personagem ativo para falar"
            value={activeCharacter?.id ?? ''}
            onChange={(e) => onSelectActiveCharacter(e.target.value || null)}
            style={{
              flex: 1,
              minWidth: 120,
              maxWidth: 220,
              background: 'var(--bg-obsidian)',
              border: '1px solid var(--border-gold)',
              borderRadius: 'var(--radius-xs)',
              padding: '4px 8px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--gold-400)',
            }}
          >
            <option value="">Falar como {user.displayName}</option>
            {speakableCharacters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {/* Whisper Recipient Selector */}
        {mode === 'whisper' && (
          <select
            aria-label="Destinatário do sussurro"
            value={whisperTargetId}
            onChange={(e) => setWhisperTargetId(e.target.value)}
            style={{
              flex: 1,
              minWidth: 120,
              maxWidth: 220,
              background: 'var(--bg-obsidian)',
              border: '1px solid rgba(168, 85, 247, 0.5)',
              borderRadius: 'var(--radius-xs)',
              padding: '4px 8px',
              fontSize: 11,
              fontWeight: 600,
              color: '#e9d5ff',
            }}
          >
            <option value="gm">Para: Mestre (GM)</option>
            {otherMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                Para: {m.displayName} {m.role === 'gm' ? '(GM)' : ''}
              </option>
            ))}
          </select>
        )}

        {/* Quick /r shortcut button */}
        <button
          type="button"
          onClick={() => setText((prev) => (prev.startsWith('/r ') ? prev : `/r 2d6+`))}
          title="Atalho para rolar dados (/r)"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 7px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--bg-obsidian)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-muted)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <Dices size={12} style={{ color: 'var(--gold-400)' }} />
          /r
        </button>
      </div>

      {/* Input Row */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === 'ic'
              ? activeCharacter
                ? `Falar como ${activeCharacter.name}... ou /r 2d6+3`
                : 'Escreva no chat ou /r 2d6+3...'
              : mode === 'narration'
                ? 'Descreva a cena para os jogadores...'
                : mode === 'whisper'
                  ? 'Mensagem secreta...'
                  : 'Conversar fora de personagem (OOC)...'
          }
          className="mesa-input"
          style={{
            flex: 1,
            minHeight: compact ? 38 : 42,
            maxHeight: 110,
            padding: '9px 11px',
            resize: 'none',
            lineHeight: 1.35,
            fontSize: 13.5,
            borderColor:
              mode === 'whisper'
                ? 'rgba(168, 85, 247, 0.45)'
                : mode === 'narration'
                  ? 'var(--border-gold)'
                  : undefined,
          }}
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="mesa-btn mesa-btn--gold"
          aria-label="Enviar mensagem"
          style={{
            minHeight: compact ? 38 : 42,
            minWidth: compact ? 42 : 46,
            padding: '0 12px',
            flexShrink: 0,
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </form>
  );
}

export default ChatComposer;

import React, { useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Edit3,
  Eye,
  Globe,
  Image as ImageIcon,
  Lock,
  Save,
  Send,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import type { Document, DocumentKind, Visibility } from '@systems/types';
import { useCampaignStore } from '@/lib/store';

export interface DocumentModalProps {
  document: Document | null;
  isNew?: boolean;
  initialFolderId?: string | null;
  onClose: () => void;
}

const KIND_LABELS: Record<DocumentKind, string> = {
  note: 'Anotação',
  handout: 'Handout / Carta',
  lore: 'História & Lore',
  item: 'Item / Relíquia',
  npc_bio: 'Biografia de NPC',
};

/** Safe pure-React Markdown renderer (zero dangerouslySetInnerHTML) */
function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split('\n');

  const renderInline = (text: string): React.ReactNode => {
    const nodes: React.ReactNode[] = [];
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) nodes.push(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith('**')) {
        nodes.push(
          <strong key={m.index} style={{ color: 'var(--text-primary)' }}>
            {tok.slice(2, -2)}
          </strong>
        );
      } else if (tok.startsWith('`')) {
        nodes.push(
          <code
            key={m.index}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              background: 'rgba(255,255,255,0.08)',
              padding: '1px 5px',
              borderRadius: 4,
              color: 'var(--gold-400)',
            }}
          >
            {tok.slice(1, -1)}
          </code>
        );
      } else {
        nodes.push(
          <em key={m.index} style={{ color: '#f2cc7b' }}>
            {tok.slice(1, -1)}
          </em>
        );
      }
      last = regex.lastIndex;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, lineHeight: 1.6 }}>
      {lines.map((rawLine, idx) => {
        const line = rawLine.trimEnd();
        if (!line.trim()) return <div key={idx} style={{ height: 4 }} />;
        if (line.startsWith('### ')) {
          return (
            <h4
              key={idx}
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 15,
                color: 'var(--gold-400)',
                marginTop: 6,
              }}
            >
              {renderInline(line.slice(4))}
            </h4>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <h3
              key={idx}
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 17,
                color: 'var(--gold-400)',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: 4,
                marginTop: 8,
              }}
            >
              {renderInline(line.slice(3))}
            </h3>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <h2
              key={idx}
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                color: 'var(--gold-400)',
                marginTop: 4,
              }}
            >
              {renderInline(line.slice(2))}
            </h2>
          );
        }
        if (line.startsWith('> ')) {
          return (
            <blockquote
              key={idx}
              style={{
                margin: 0,
                padding: '8px 12px',
                borderLeft: '3px solid var(--gold-500)',
                background: 'rgba(212, 168, 79, 0.08)',
                borderRadius: '0 var(--radius-xs) var(--radius-xs) 0',
                fontStyle: 'italic',
                color: '#f3ead8',
              }}
            >
              {renderInline(line.slice(2))}
            </blockquote>
          );
        }
        if (line === '---' || line === '***') {
          return <hr key={idx} style={{ border: 'none', borderTop: '1px solid var(--border-gold)' }} />;
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={idx} style={{ display: 'flex', gap: 8, paddingLeft: 6, color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--gold-400)' }}>•</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        return (
          <p key={idx} style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}

export function DocumentModal({
  document,
  isNew = false,
  initialFolderId = null,
  onClose,
}: DocumentModalProps) {
  const {
    user,
    isGm,
    folders,
    members,
    upsertDocument,
    deleteDocument,
    sendChat,
    uploadImage,
    pushToast,
  } = useCampaignStore();

  const canEdit = isNew || isGm || document?.createdBy === user.id;
  const [editing, setEditing] = useState(isNew);

  const [title, setTitle] = useState(document?.title ?? '');
  const [kind, setKind] = useState<DocumentKind>(document?.kind ?? 'handout');
  const [folderId, setFolderId] = useState<string | null>(
    document?.folderId ?? initialFolderId ?? null
  );
  const [content, setContent] = useState(document?.content ?? '');
  const [imageUrl, setImageUrl] = useState(document?.imageUrl ?? '');
  const [visibility, setVisibility] = useState<Visibility>(
    document?.visibility ?? (isGm ? 'all_players' : 'all_players')
  );
  const [visibleToUserIds, setVisibleToUserIds] = useState<string[]>(
    document?.visibleToUserIds ?? []
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const nonGmMembers = useMemo(
    () => members.filter((m) => m.role !== 'gm'),
    [members]
  );

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await uploadImage(file);
    setUploading(false);
    if (url) {
      setImageUrl(url);
      pushToast('Imagem carregada no documento!', 'success');
    }
  };

  const toggleUserAccess = (uid: string) => {
    setVisibleToUserIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      pushToast('Informe um título para o documento.', 'warning');
      return;
    }
    setSaving(true);
    await upsertDocument({
      id: document?.id,
      folderId,
      kind,
      title: trimmed,
      content,
      imageUrl: imageUrl.trim() || undefined,
      visibility: isGm ? visibility : 'all_players',
      visibleToUserIds:
        isGm && visibility === 'specific_players' ? visibleToUserIds : undefined,
    });
    setSaving(false);
    pushToast(isNew ? 'Documento criado!' : 'Documento salvo!', 'success');
    if (isNew) {
      onClose();
    } else {
      setEditing(false);
    }
  };

  const handleSendHandoutToChat = () => {
    const excerpt = content.trim().slice(0, 500);
    const imgMarkdown = imageUrl.trim() ? `\n![${title}](${imageUrl.trim()})` : '';
    sendChat({
      kind: 'narration',
      content: `**📜 ${title || 'Handout'}**\n${excerpt}${content.length > 500 ? '…' : ''}${imgMarkdown}`,
      visibility: isGm && visibility === 'specific_players' ? 'specific_players' : 'all_players',
      visibleToUserIds:
        isGm && visibility === 'specific_players'
          ? Array.from(new Set([user.id, ...visibleToUserIds]))
          : undefined,
    });
    pushToast('Handout enviado no chat da mesa!', 'success');
  };

  const handleDelete = async () => {
    if (!document?.id) return;
    await deleteDocument(document.id);
    pushToast(`Documento "${document.title}" removido.`, 'info');
    onClose();
  };

  return (
    <div className="mesa-modal-backdrop" onClick={onClose}>
      <div
        className="mesa-modal"
        style={{ maxWidth: 680 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mesa-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <BookOpen size={18} style={{ color: 'var(--gold-400)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <h3 className="mesa-modal__title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isNew ? 'Novo Documento / Handout' : title || document?.title}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span className="mesa-badge">{KIND_LABELS[kind]}</span>
                {visibility === 'gm_only' && (
                  <span className="mesa-badge mesa-badge--amethyst">
                    <Lock size={10} /> Só Mestre
                  </span>
                )}
                {visibility === 'all_players' && (
                  <span className="mesa-badge mesa-badge--emerald">
                    <Globe size={10} /> Todos
                  </span>
                )}
                {visibility === 'specific_players' && (
                  <span className="mesa-badge mesa-badge--gold">
                    <UserCheck size={10} /> Selecionados ({visibleToUserIds.length})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {canEdit && !isNew && (
              <button
                type="button"
                className="mesa-btn mesa-btn--sm"
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? <Eye size={13} /> : <Edit3 size={13} />}
                {editing ? 'Visualizar' : 'Editar'}
              </button>
            )}
            <button
              type="button"
              className="mesa-btn mesa-btn--ghost mesa-btn--icon"
              onClick={onClose}
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="mesa-modal__body">
          {editing ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
                <div>
                  <label className="mesa-label">Título</label>
                  <input
                    type="text"
                    className="mesa-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: Carta do Lorde Aldric, Mapa da Cripta..."
                  />
                </div>
                <div>
                  <label className="mesa-label">Tipo</label>
                  <select
                    className="mesa-select"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as DocumentKind)}
                  >
                    <option value="handout">Handout / Carta</option>
                    <option value="lore">História & Lore</option>
                    <option value="note">Anotação</option>
                    <option value="item">Item / Relíquia</option>
                    <option value="npc_bio">Biografia NPC</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isGm ? '1fr 1fr' : '1fr', gap: 10 }}>
                <div>
                  <label className="mesa-label">Pasta</label>
                  <select
                    className="mesa-select"
                    value={folderId ?? ''}
                    onChange={(e) => setFolderId(e.target.value || null)}
                  >
                    <option value="">Raiz da Biblioteca</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>

                {isGm && (
                  <div>
                    <label className="mesa-label">Visibilidade (Firecast)</label>
                    <select
                      className="mesa-select"
                      value={visibility}
                      onChange={(e) => setVisibility(e.target.value as Visibility)}
                    >
                      <option value="all_players">🌐 Todos os Jogadores</option>
                      <option value="gm_only">🔒 Só Mestre (Oculto)</option>
                      <option value="specific_players">👤 Jogadores Selecionados</option>
                    </select>
                  </div>
                )}
              </div>

              {isGm && visibility === 'specific_players' && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-obsidian)',
                    border: '1px solid var(--border-gold)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gold-400)' }}>
                    Selecione quem pode abrir este documento:
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {nonGmMembers.length === 0 ? (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Nenhum jogador na campanha além do Mestre.
                      </span>
                    ) : (
                      nonGmMembers.map((m) => (
                        <label
                          key={m.userId}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={visibleToUserIds.includes(m.userId)}
                            onChange={() => toggleUserAccess(m.userId)}
                          />
                          {m.displayName}
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="mesa-label">Imagem do Handout (opcional)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="mesa-input"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="./assets/maps/tavern.svg ou URL de imagem..."
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleUploadFile}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="mesa-btn"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} />
                    {uploading ? 'Enviando...' : 'Upload'}
                  </button>
                </div>
                {imageUrl && (
                  <div style={{ marginTop: 8 }}>
                    <img
                      src={imageUrl}
                      alt="Prévia do handout"
                      style={{
                        maxHeight: 160,
                        maxWidth: '100%',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-gold)',
                      }}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="mesa-label">
                  Conteúdo (suporta Markdown: # Títulos, **negrito**, *itálico*, &gt; citações, - listas)
                </label>
                <textarea
                  className="mesa-textarea"
                  rows={9}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Escreva a história, pista, carta ou anotação da campanha..."
                  style={{ fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}
                />
              </div>
            </>
          ) : (
            <div
              style={{
                background: 'var(--parchment-bg)',
                border: '1px solid var(--parchment-border)',
                borderRadius: 'var(--radius-md)',
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {imageUrl && (
                <div style={{ textAlign: 'center' }}>
                  <img
                    src={imageUrl}
                    alt={title}
                    style={{
                      maxWidth: '100%',
                      maxHeight: 320,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-gold)',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  />
                </div>
              )}

              {content.trim() ? (
                <MarkdownPreview content={content} />
              ) : (
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontStyle: 'italic',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <ImageIcon size={16} />
                  <span>Este documento ainda não possui texto.</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mesa-modal__footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isNew && (
              <button
                type="button"
                className="mesa-btn mesa-btn--sm"
                onClick={handleSendHandoutToChat}
              >
                <Send size={13} />
                Enviar Handout no Chat
              </button>
            )}
            {!isNew && canEdit && (
              <button
                type="button"
                className="mesa-btn mesa-btn--danger mesa-btn--sm"
                onClick={() => void handleDelete()}
              >
                <Trash2 size={13} />
                Excluir
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="mesa-btn mesa-btn--ghost" onClick={onClose}>
              Fechar
            </button>
            {editing && (
              <button
                type="button"
                className="mesa-btn mesa-btn--gold"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                <Save size={14} />
                {saving ? 'Salvando...' : 'Salvar Documento'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DocumentModal;

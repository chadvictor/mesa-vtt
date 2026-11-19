import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit3,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Globe,
  Image as ImageIcon,
  Lock,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import type { Document, DocumentKind, Folder, Visibility } from '@systems/types';
import { useCampaignStore } from '@/lib/store';

export interface FolderTreeProps {
  onSelectDocument: (doc: Document) => void;
  onCreateDocument: (folderId: string | null) => void;
  compact?: boolean;
}

function VisibilityPill({
  visibility,
  count,
}: {
  visibility: Visibility;
  count?: number;
}) {
  if (visibility === 'gm_only') {
    return (
      <span
        title="Visível apenas para o Mestre"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '1px 6px',
          borderRadius: 'var(--radius-full)',
          fontSize: 10,
          fontWeight: 600,
          background: 'var(--amethyst-soft)',
          border: '1px solid rgba(168, 85, 247, 0.35)',
          color: 'var(--amethyst-400)',
          flexShrink: 0,
        }}
      >
        <Lock size={9} />
        Só Mestre
      </span>
    );
  }
  if (visibility === 'specific_players') {
    return (
      <span
        title="Visível para jogadores selecionados"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '1px 6px',
          borderRadius: 'var(--radius-full)',
          fontSize: 10,
          fontWeight: 600,
          background: 'var(--gold-soft)',
          border: '1px solid var(--border-gold)',
          color: 'var(--gold-400)',
          flexShrink: 0,
        }}
      >
        <UserCheck size={9} />
        {count ? `Sel. (${count})` : 'Selecionados'}
      </span>
    );
  }
  return (
    <span
      title="Visível para todos os jogadores"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 6px',
        borderRadius: 'var(--radius-full)',
        fontSize: 10,
        fontWeight: 600,
        background: 'rgba(34, 197, 94, 0.1)',
        border: '1px solid rgba(34, 197, 94, 0.28)',
        color: 'var(--emerald-400)',
        flexShrink: 0,
      }}
    >
      <Globe size={9} />
      Todos
    </span>
  );
}

function getDocIcon(kind: DocumentKind) {
  switch (kind) {
    case 'handout':
      return <ImageIcon size={14} style={{ color: 'var(--gold-400)', flexShrink: 0 }} />;
    case 'lore':
      return <BookOpen size={14} style={{ color: 'var(--sapphire-400)', flexShrink: 0 }} />;
    case 'item':
      return <Sparkles size={14} style={{ color: 'var(--amber-400)', flexShrink: 0 }} />;
    case 'npc_bio':
      return <Users size={14} style={{ color: 'var(--emerald-400)', flexShrink: 0 }} />;
    default:
      return <FileText size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />;
  }
}

export function FolderTree({
  onSelectDocument,
  onCreateDocument,
  compact = false,
}: FolderTreeProps) {
  const {
    folders,
    documents,
    members,
    isGm,
    upsertFolder,
    deleteFolder,
    pushToast,
  } = useCampaignStore();

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editingFolder, setEditingFolder] = useState<{
    id?: string;
    name: string;
    parentId: string | null;
    visibility: Visibility;
    visibleToUserIds: string[];
  } | null>(null);

  const normQuery = query.trim().toLowerCase();

  const nonGmMembers = useMemo(
    () => members.filter((m) => m.role !== 'gm'),
    [members]
  );

  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [folders]
  );

  const filteredDocuments = useMemo(() => {
    if (!normQuery) return documents;
    return documents.filter(
      (d) =>
        d.title.toLowerCase().includes(normQuery) ||
        d.content.toLowerCase().includes(normQuery) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(normQuery))
    );
  }, [documents, normQuery]);

  const toggleCollapse = (folderId: string) => {
    setCollapsed((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const handleSaveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFolder) return;
    const trimmed = editingFolder.name.trim();
    if (!trimmed) {
      pushToast('Digite um nome para a pasta.', 'warning');
      return;
    }
    await upsertFolder({
      id: editingFolder.id,
      name: trimmed,
      parentId: editingFolder.parentId,
      visibility: editingFolder.visibility,
      visibleToUserIds:
        editingFolder.visibility === 'specific_players'
          ? editingFolder.visibleToUserIds
          : undefined,
    });
    pushToast(editingFolder.id ? 'Pasta atualizada.' : `Pasta "${trimmed}" criada.`, 'success');
    setEditingFolder(null);
  };

  const handleDeleteFolder = async (folder: Folder) => {
    await deleteFolder(folder.id);
    pushToast(`Pasta "${folder.name}" removida.`, 'info');
  };

  const togglePlayerAccess = (userId: string) => {
    if (!editingFolder) return;
    const exists = editingFolder.visibleToUserIds.includes(userId);
    setEditingFolder({
      ...editingFolder,
      visibleToUserIds: exists
        ? editingFolder.visibleToUserIds.filter((id) => id !== userId)
        : [...editingFolder.visibleToUserIds, userId],
    });
  };

  const renderFolderBranch = (parentId: string | null, depth: number): React.ReactNode => {
    const childFolders = sortedFolders.filter((f) => (f.parentId ?? null) === parentId);
    const childDocs = filteredDocuments.filter((d) => (d.folderId ?? null) === parentId);

    return (
      <>
        {childFolders.map((folder) => {
          const isCollapsed = !normQuery && Boolean(collapsed[folder.id]);
          const folderDocCount = filteredDocuments.filter((d) => d.folderId === folder.id).length;
          const hasSubFolders = sortedFolders.some((f) => f.parentId === folder.id);

          return (
            <div key={folder.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: compact ? '7px 8px' : '6px 8px',
                  paddingLeft: 8 + depth * 14,
                  borderRadius: 'var(--radius-xs)',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid transparent',
                  minHeight: compact ? 42 : 34,
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleCollapse(folder.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flex: 1,
                    minWidth: 0,
                    textAlign: 'left',
                    color: 'var(--text-primary)',
                  }}
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  ) : (
                    <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  )}
                  {isCollapsed ? (
                    <FolderIcon size={15} style={{ color: 'var(--gold-400)', flexShrink: 0 }} />
                  ) : (
                    <FolderOpen size={15} style={{ color: 'var(--gold-400)', flexShrink: 0 }} />
                  )}
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {folder.name}
                  </span>
                </button>

                <VisibilityPill
                  visibility={folder.visibility}
                  count={folder.visibleToUserIds?.length}
                />

                {isGm && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <button
                      type="button"
                      title="Novo documento nesta pasta"
                      onClick={() => onCreateDocument(folder.id)}
                      style={{ padding: 4, color: 'var(--text-muted)' }}
                    >
                      <Plus size={13} />
                    </button>
                    <button
                      type="button"
                      title="Editar pasta e permissões"
                      onClick={() =>
                        setEditingFolder({
                          id: folder.id,
                          name: folder.name,
                          parentId: folder.parentId ?? null,
                          visibility: folder.visibility,
                          visibleToUserIds: folder.visibleToUserIds ?? [],
                        })
                      }
                      style={{ padding: 4, color: 'var(--text-muted)' }}
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      type="button"
                      title="Remover pasta"
                      onClick={() => void handleDeleteFolder(folder)}
                      style={{ padding: 4, color: 'var(--crimson-400)' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>

              {!isCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {renderFolderBranch(folder.id, depth + 1)}
                  {folderDocCount === 0 && !hasSubFolders && (
                    <div
                      style={{
                        padding: '4px 8px',
                        paddingLeft: 28 + depth * 14,
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        fontStyle: 'italic',
                      }}
                    >
                      Pasta vazia
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {childDocs.map((doc) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => onSelectDocument(doc)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              width: '100%',
              textAlign: 'left',
              padding: compact ? '8px 10px' : '6px 8px',
              paddingLeft: 14 + depth * 14,
              borderRadius: 'var(--radius-xs)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              minHeight: compact ? 44 : 32,
              transition: 'background 120ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 }}>
              {getDocIcon(doc.kind)}
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {doc.title}
              </span>
            </div>
            <VisibilityPill
              visibility={doc.visibility}
              count={doc.visibleToUserIds?.length}
            />
          </button>
        ))}
      </>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Search + Action Bar */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          flexShrink: 0,
        }}
      >
        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 9,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar pastas, notas, handouts..."
            className="mesa-input"
            style={{ padding: '6px 10px 6px 30px', fontSize: 12 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {isGm && (
            <button
              type="button"
              className="mesa-btn mesa-btn--sm"
              style={{ flex: 1 }}
              onClick={() =>
                setEditingFolder({
                  name: '',
                  parentId: null,
                  visibility: 'all_players',
                  visibleToUserIds: [],
                })
              }
            >
              <FolderPlus size={13} />
              Nova Pasta
            </button>
          )}
          <button
            type="button"
            className="mesa-btn mesa-btn--gold mesa-btn--sm"
            style={{ flex: 1 }}
            onClick={() => onCreateDocument(null)}
          >
            <Plus size={13} />
            {isGm ? 'Novo Doc' : 'Nova Nota'}
          </button>
        </div>
      </div>

      {/* Inline Folder Create/Edit Form */}
      {editingFolder && (
        <form
          onSubmit={handleSaveFolder}
          style={{
            margin: '8px 10px 0',
            padding: 10,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-gold)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-400)' }}>
            {editingFolder.id ? 'Editar Pasta' : 'Nova Pasta da Biblioteca'}
          </div>
          <input
            type="text"
            value={editingFolder.name}
            onChange={(e) => setEditingFolder({ ...editingFolder, name: e.target.value })}
            placeholder="Ex: Segredos do Mestre, Handouts..."
            className="mesa-input"
            style={{ padding: '6px 9px', fontSize: 12 }}
            autoFocus
          />

          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={editingFolder.parentId ?? ''}
              onChange={(e) =>
                setEditingFolder({ ...editingFolder, parentId: e.target.value || null })
              }
              className="mesa-select"
              style={{ padding: '5px 8px', fontSize: 11, flex: 1 }}
            >
              <option value="">Raiz (sem pasta pai)</option>
              {sortedFolders
                .filter((f) => f.id !== editingFolder.id)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    Dentro de: {f.name}
                  </option>
                ))}
            </select>

            <select
              value={editingFolder.visibility}
              onChange={(e) =>
                setEditingFolder({
                  ...editingFolder,
                  visibility: e.target.value as Visibility,
                })
              }
              className="mesa-select"
              style={{ padding: '5px 8px', fontSize: 11, flex: 1 }}
            >
              <option value="all_players">🌐 Todos os Jogadores</option>
              <option value="gm_only">🔒 Só Mestre</option>
              <option value="specific_players">👤 Selecionados</option>
            </select>
          </div>

          {editingFolder.visibility === 'specific_players' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: 7,
                borderRadius: 'var(--radius-xs)',
                background: 'var(--bg-obsidian)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Quem pode ver esta pasta:
              </span>
              {nonGmMembers.length === 0 ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Nenhum jogador conectado ainda.
                </span>
              ) : (
                nonGmMembers.map((m) => (
                  <label
                    key={m.userId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={editingFolder.visibleToUserIds.includes(m.userId)}
                      onChange={() => togglePlayerAccess(m.userId)}
                    />
                    <span>{m.displayName}</span>
                  </label>
                ))
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              type="button"
              className="mesa-btn mesa-btn--ghost mesa-btn--sm"
              onClick={() => setEditingFolder(null)}
            >
              Cancelar
            </button>
            <button type="submit" className="mesa-btn mesa-btn--gold mesa-btn--sm">
              Salvar
            </button>
          </div>
        </form>
      )}

      {/* Tree Content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '8px 8px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        {folders.length === 0 && filteredDocuments.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '28px 12px',
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
          >
            Nenhum documento encontrado. Crie uma pasta ou anotação para organizar a campanha!
          </div>
        ) : (
          renderFolderBranch(null, 0)
        )}
      </div>
    </div>
  );
}

export default FolderTree;

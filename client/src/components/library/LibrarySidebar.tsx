import React, { useState } from 'react';
import { BookOpen, FolderTree as FolderTreeIcon, Headphones, Zap } from 'lucide-react';
import type { Document } from '@systems/types';
import type { LibrarySidebarProps, LibraryTab } from '@/lib/componentProps';
import { CompendiumPanel } from './CompendiumPanel';
import { DocumentModal } from './DocumentModal';
import { FolderTree } from './FolderTree';
import { MacroPanel } from './MacroPanel';

export function LibrarySidebar({
  activeTab,
  onTabChange,
  onOpenDocument,
  voicePanelNode,
  compact = false,
}: LibrarySidebarProps) {
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [creatingInFolder, setCreatingInFolder] = useState<string | null | undefined>(undefined);

  const tabs: Array<{ id: LibraryTab; label: string; icon: React.ReactNode }> = [
    { id: 'folders', label: 'Pastas', icon: <FolderTreeIcon size={13} /> },
    { id: 'compendium', label: 'Compêndio', icon: <BookOpen size={13} /> },
    { id: 'macros', label: 'Macros', icon: <Zap size={13} /> },
  ];

  if (voicePanelNode) {
    tabs.push({ id: 'voice', label: 'Voz', icon: <Headphones size={13} /> });
  }

  const handleOpenDoc = (doc: Document) => {
    setCreatingInFolder(undefined);
    setSelectedDoc(doc);
    onOpenDocument?.(doc);
  };

  const handleCreateDoc = (folderId: string | null) => {
    setSelectedDoc(null);
    setCreatingInFolder(folderId);
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
      {/* Segmented Tabs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
          gap: 3,
          padding: compact ? '6px 8px' : '7px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-obsidian)',
          flexShrink: 0,
        }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                padding: compact ? '7px 6px' : '6px 6px',
                borderRadius: 'var(--radius-xs)',
                fontSize: 11.5,
                fontWeight: 700,
                background: active ? 'var(--bg-elevated)' : 'transparent',
                border: `1px solid ${active ? 'var(--border-gold)' : 'transparent'}`,
                color: active ? 'var(--gold-400)' : 'var(--text-muted)',
                transition: 'all 120ms ease',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Tab Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {activeTab === 'folders' && (
          <FolderTree
            onSelectDocument={handleOpenDoc}
            onCreateDocument={handleCreateDoc}
            compact={compact}
          />
        )}
        {activeTab === 'compendium' && <CompendiumPanel compact={compact} />}
        {activeTab === 'macros' && <MacroPanel compact={compact} />}
        {activeTab === 'voice' && voicePanelNode}
      </div>

      {/* Document Viewer / Editor Modal */}
      {(selectedDoc || creatingInFolder !== undefined) && (
        <DocumentModal
          document={selectedDoc}
          isNew={creatingInFolder !== undefined}
          initialFolderId={creatingInFolder ?? null}
          onClose={() => {
            setSelectedDoc(null);
            setCreatingInFolder(undefined);
          }}
        />
      )}
    </div>
  );
}

export default LibrarySidebar;

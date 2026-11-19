import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Dices,
  Loader2,
  MessageSquare,
  RefreshCw,
  X,
} from 'lucide-react';
import type { IceServerConfig, MemberRole, UserIdentity } from '@systems/types';
import { CampaignProvider, useCampaignStore, useVoice } from '@/lib/store';
import { TopBar } from './TopBar';
import { VoiceBar } from './VoiceBar';
import { VoicePanel } from './VoicePanel';
import { MobileBottomNav } from './MobileBottomNav';

// Feature components owned by @ui-dice-map and @ui-sheets-chat (contracts in @/lib/componentProps)
import { TacticalCanvas } from '../map/TacticalCanvas';
import { MapToolbar } from '../map/MapToolbar';
import { DiceOverlay3D } from '../dice/DiceOverlay3D';
import { QuickDiceBar } from '../dice/QuickDiceBar';
import { LibrarySidebar } from '../library/LibrarySidebar';
import { ChatPanel } from '../chat/ChatPanel';
import { ChatComposer } from '../chat/ChatComposer';
import { CharacterSidebar } from '../characters/CharacterSidebar';
import { CharacterSheetModal } from '../characters/CharacterSheetModal';

export interface TableShellProps {
  campaignId: string;
  user: UserIdentity;
  initialRole: MemberRole;
  iceServers?: IceServerConfig[];
  onBackToLobby: () => void;
}

function useIsMobile(breakpointPx = 1024): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpointPx;
  });

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpointPx]);

  return isMobile;
}

function TableShellInner({ onBackToLobby }: { onBackToLobby: () => void }) {
  const store = useCampaignStore();
  const voice = useVoice();
  const isMobile = useIsMobile(1024);

  // Resizable split ratio (percentage of center stage height devoted to Tactical Map)
  const [mapRatio, setMapRatio] = useState(55);
  const [floatingChatOpen, setFloatingChatOpen] = useState(true);
  const centerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const handleSplitterPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current || !centerRef.current) return;
      const rect = centerRef.current.getBoundingClientRect();
      if (rect.height <= 0) return;
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setMapRatio(Math.max(22, Math.min(78, pct)));
    };

    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const systemId = store.campaign?.systemId ?? 'mighty-blade-3e';

  if (store.loading && !store.campaign) {
    return (
      <div className="table-shell">
        <div className="table-status-screen">
          <Loader2 size={32} className="mesa-spin" color="#f2cc7b" />
          <h2 className="font-display" style={{ color: 'var(--gold-400)', fontSize: 20 }}>
            Preparando a Mesa...
          </h2>
          <p>Carregando cenas, fichas, grimório e canais de voz.</p>
        </div>
      </div>
    );
  }

  if (store.error && !store.campaign) {
    return (
      <div className="table-shell">
        <div className="table-status-screen">
          <AlertTriangle size={34} color="#f87171" />
          <h2 className="font-display" style={{ color: 'var(--text-primary)', fontSize: 20 }}>
            Não foi possível abrir a campanha
          </h2>
          <p>{store.error}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="mesa-btn" onClick={onBackToLobby}>
              <ArrowLeft size={15} />
              Voltar ao Lobby
            </button>
            <button
              type="button"
              className="mesa-btn mesa-btn--gold"
              onClick={() => void store.refreshState()}
            >
              <RefreshCw size={15} />
              Tentar Novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="table-shell">
      {/* ================================================================= */}
      {/* DESKTOP LAYOUT (>= 1024px)                                        */}
      {/* ================================================================= */}
      {!isMobile && (
        <>
          <TopBar onBackToLobby={onBackToLobby} />

          <div className="table-body">
            {/* Left Sidebar: Library (Folders / Compendium / Macros) + Docked Discord Voice */}
            {store.leftSidebarOpen && (
              <aside className="table-sidebar table-sidebar--left" aria-label="Biblioteca e Voz">
                <div className="table-sidebar__main">
                  <LibrarySidebar
                    activeTab={store.libraryTab}
                    onTabChange={store.setLibraryTab}
                    voicePanelNode={<VoicePanel />}
                  />
                </div>
                {store.libraryTab !== 'voice' && (
                  <div className="sidebar-voice-dock">
                    <VoicePanel compact />
                  </div>
                )}
              </aside>
            )}

            {/* Center Stage: Tactical Map + Campaign Chat + 3D Dice Overlay */}
            <main className="table-center" ref={centerRef}>
              {store.viewMode === 'split' && (
                <>
                  <div className="stage-map-pane" style={{ height: `${mapRatio}%`, flexShrink: 0 }}>
                    <TacticalCanvas
                      scene={store.activeScene}
                      activeTool={store.mapTool}
                      activeLayer={store.mapLayer}
                      selectedTokenId={store.selectedTokenId}
                      onSelectToken={store.setSelectedTokenId}
                      onOpenCharacterSheet={(cid: string) => store.setOpenSheetCharacterId(cid)}
                      isGm={store.isGm}
                      pings={store.activePings}
                    />
                    <div className="stage-map-toolbar-slot">
                      <MapToolbar
                        activeTool={store.mapTool}
                        onSelectTool={store.setMapTool}
                        activeLayer={store.mapLayer}
                        onSelectLayer={store.setMapLayer}
                        scene={store.activeScene}
                        isGm={store.isGm}
                      />
                    </div>
                  </div>

                  <div
                    className="stage-splitter"
                    onPointerDown={handleSplitterPointerDown}
                    role="separator"
                    aria-orientation="horizontal"
                    title="Arraste para redimensionar Mapa e Chat"
                  />

                  <div className="stage-chat-pane">
                    <div className="stage-chat-stream">
                      <ChatPanel />
                    </div>
                    <div className="stage-chat-footer">
                      <QuickDiceBar activeCharacter={store.activeCharacter} systemId={systemId} />
                      <ChatComposer
                        activeCharacter={store.activeCharacter}
                        onSelectActiveCharacter={store.setActiveCharacterId}
                      />
                    </div>
                  </div>
                </>
              )}

              {store.viewMode === 'map_overlay' && (
                <div className="stage-map-pane" style={{ flex: 1 }}>
                  <TacticalCanvas
                    scene={store.activeScene}
                    activeTool={store.mapTool}
                    activeLayer={store.mapLayer}
                    selectedTokenId={store.selectedTokenId}
                    onSelectToken={store.setSelectedTokenId}
                    onOpenCharacterSheet={(cid: string) => store.setOpenSheetCharacterId(cid)}
                    isGm={store.isGm}
                    pings={store.activePings}
                  />
                  <div className="stage-map-toolbar-slot">
                    <MapToolbar
                      activeTool={store.mapTool}
                      onSelectTool={store.setMapTool}
                      activeLayer={store.mapLayer}
                      onSelectLayer={store.setMapLayer}
                      scene={store.activeScene}
                      isGm={store.isGm}
                    />
                  </div>

                  {floatingChatOpen ? (
                    <div className="stage-floating-chat">
                      <div className="stage-chat-stream">
                        <ChatPanel
                          floating
                          compact
                          onCloseFloating={() => setFloatingChatOpen(false)}
                        />
                      </div>
                      <div className="stage-chat-footer">
                        <QuickDiceBar
                          activeCharacter={store.activeCharacter}
                          systemId={systemId}
                          compact
                        />
                        <ChatComposer
                          activeCharacter={store.activeCharacter}
                          onSelectActiveCharacter={store.setActiveCharacterId}
                          compact
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mesa-btn mesa-btn--gold stage-floating-chat-toggle"
                      onClick={() => setFloatingChatOpen(true)}
                    >
                      <MessageSquare size={15} />
                      Abrir Chat
                    </button>
                  )}
                </div>
              )}

              {store.viewMode === 'chat_focus' && (
                <div className="stage-chat-pane" style={{ flex: 1 }}>
                  <div className="stage-chat-stream">
                    <ChatPanel />
                  </div>
                  <div className="stage-chat-footer">
                    <QuickDiceBar activeCharacter={store.activeCharacter} systemId={systemId} />
                    <ChatComposer
                      activeCharacter={store.activeCharacter}
                      onSelectActiveCharacter={store.setActiveCharacterId}
                    />
                  </div>
                </div>
              )}

              {/* Authoritative Deterministic 3D Dice Overlay */}
              <div className="stage-dice-layer">
                <DiceOverlay3D
                  enabled={store.dice3DEnabled}
                  activeRoll={store.activeDiceRoll}
                  onAnimationComplete={store.dismissDiceRoll}
                />
              </div>
            </main>

            {/* Right Sidebar: Combat Tracker + PCs & NPCs */}
            {store.rightSidebarOpen && (
              <aside className="table-sidebar table-sidebar--right" aria-label="Personagens e Combate">
                <CharacterSidebar
                  onOpenSheet={(cid: string) => store.setOpenSheetCharacterId(cid)}
                  selectedTargetId={store.targetCharacterId}
                  onSelectTarget={store.setTargetCharacterId}
                />
              </aside>
            )}
          </div>
        </>
      )}

      {/* ================================================================= */}
      {/* MOBILE LAYOUT (< 1024px) — Persistent Voice Bar NEVER unmounts    */}
      {/* ================================================================= */}
      {isMobile && (
        <>
          <VoiceBar variant="mobile-bar" />

          <div className="mobile-tab-viewport">
            {/* Compact contextual subbar */}
            <div className="mobile-subbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <button
                  type="button"
                  className="mesa-btn mesa-btn--ghost mesa-btn--sm"
                  style={{ minHeight: 32, padding: '2px 6px' }}
                  onClick={onBackToLobby}
                  aria-label="Voltar ao Lobby"
                >
                  <ArrowLeft size={16} />
                </button>
                <span className={`conn-dot conn-dot--${store.connectionStatus}`} />

                {store.mobileTab === 'map' && store.scenes.length > 0 ? (
                  <select
                    className="scene-select"
                    style={{ maxWidth: 180, padding: '4px 8px' }}
                    value={store.activeScene?.id ?? ''}
                    disabled={!store.isGm}
                    onChange={(e) => store.isGm && store.activateScene(e.target.value)}
                  >
                    {store.scenes.map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {sc.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 13,
                      fontWeight: 700,
                      color: 'var(--gold-400)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {store.campaign?.name ?? 'Mesa VTT'}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className={`mesa-btn mesa-btn--sm ${store.dice3DEnabled ? 'mesa-btn--gold' : ''}`}
                  style={{ minHeight: 30, padding: '2px 8px' }}
                  onClick={() => store.setDice3DEnabled(!store.dice3DEnabled)}
                  title="Alternar dados 3D"
                >
                  <Dices size={13} />
                  <span>3D</span>
                </button>
              </div>
            </div>

            {/* Active Mobile Tab Content */}
            <div className="mobile-tab-content">
              {store.mobileTab === 'chat' && (
                <div className="stage-chat-pane">
                  <div className="stage-chat-stream">
                    <ChatPanel compact />
                  </div>
                  <div className="stage-chat-footer">
                    <QuickDiceBar
                      activeCharacter={store.activeCharacter}
                      systemId={systemId}
                      compact
                    />
                    <ChatComposer
                      activeCharacter={store.activeCharacter}
                      onSelectActiveCharacter={store.setActiveCharacterId}
                      compact
                    />
                  </div>
                </div>
              )}

              {store.mobileTab === 'map' && (
                <div className="stage-map-pane" style={{ flex: 1 }}>
                  <TacticalCanvas
                    scene={store.activeScene}
                    activeTool={store.mapTool}
                    activeLayer={store.mapLayer}
                    selectedTokenId={store.selectedTokenId}
                    onSelectToken={store.setSelectedTokenId}
                    onOpenCharacterSheet={(cid: string) => store.setOpenSheetCharacterId(cid)}
                    isGm={store.isGm}
                    pings={store.activePings}
                    compact
                  />
                  <div className="stage-map-toolbar-slot">
                    <MapToolbar
                      activeTool={store.mapTool}
                      onSelectTool={store.setMapTool}
                      activeLayer={store.mapLayer}
                      onSelectLayer={store.setMapLayer}
                      scene={store.activeScene}
                      isGm={store.isGm}
                      compact
                    />
                  </div>
                </div>
              )}

              {store.mobileTab === 'sheets' && (
                <CharacterSidebar
                  onOpenSheet={(cid: string) => store.setOpenSheetCharacterId(cid)}
                  selectedTargetId={store.targetCharacterId}
                  onSelectTarget={store.setTargetCharacterId}
                  compact
                />
              )}

              {store.mobileTab === 'library' && (
                <LibrarySidebar
                  activeTab={store.libraryTab}
                  onTabChange={store.setLibraryTab}
                  voicePanelNode={<VoicePanel />}
                  compact
                />
              )}

              {/* 3D Dice Overlay across mobile tabs */}
              <div className="stage-dice-layer">
                <DiceOverlay3D
                  enabled={store.dice3DEnabled}
                  activeRoll={store.activeDiceRoll}
                  onAnimationComplete={store.dismissDiceRoll}
                />
              </div>
            </div>
          </div>

          <MobileBottomNav />
        </>
      )}

      {/* ================================================================= */}
      {/* GLOBAL OVERLAYS (Sheets, Voice Bottom-Sheet/Modal, Toasts)        */}
      {/* ================================================================= */}
      {store.openSheetCharacterId && (
        <CharacterSheetModal
          characterId={store.openSheetCharacterId}
          onClose={() => store.setOpenSheetCharacterId(null)}
          isMobile={isMobile}
        />
      )}

      {voice.voicePanelOpen && (
        <div
          className="voice-sheet-backdrop"
          onClick={() => voice.setVoicePanelOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Painel de Canais de Voz"
        >
          <div className="voice-sheet-drawer" onClick={(e) => e.stopPropagation()}>
            <VoicePanel onClose={() => voice.setVoicePanelOpen(false)} />
          </div>
        </div>
      )}

      {store.toasts.length > 0 && (
        <div className="mesa-toast-stack" role="status" aria-live="polite">
          {store.toasts.map((t) => (
            <div key={t.id} className={`mesa-toast mesa-toast--${t.tone}`}>
              <span>{t.message}</span>
              <button
                type="button"
                className="mesa-btn mesa-btn--ghost"
                style={{ minHeight: 24, padding: 2 }}
                onClick={() => store.dismissToast(t.id)}
                aria-label="Dispensar aviso"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TableShell({
  campaignId,
  user,
  initialRole,
  iceServers,
  onBackToLobby,
}: TableShellProps) {
  return (
    <CampaignProvider
      campaignId={campaignId}
      user={user}
      initialRole={initialRole}
      iceServers={iceServers}
    >
      <TableShellInner onBackToLobby={onBackToLobby} />
    </CampaignProvider>
  );
}

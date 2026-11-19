import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Columns2,
  Copy,
  Crown,
  Dices,
  Map as MapIcon,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Sword,
} from 'lucide-react';
import { useCampaignStore } from '@/lib/store';
import type { CenterViewMode } from '@/lib/componentProps';
import { VoiceBar } from './VoiceBar';

interface TopBarProps {
  onBackToLobby: () => void;
}

export function TopBar({ onBackToLobby }: TopBarProps) {
  const store = useCampaignStore();
  const [copied, setCopied] = useState(false);

  const handleCopyInvite = async () => {
    const code = store.campaign?.inviteCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      store.pushToast(`Código "${code}" copiado!`, 'success');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      store.pushToast(`Código da campanha: ${code}`, 'info');
    }
  };

  const viewModes: Array<{ id: CenterViewMode; label: string; icon: React.ReactNode }> = [
    { id: 'split', label: 'Mapa+Chat', icon: <Columns2 size={13} /> },
    { id: 'map_overlay', label: 'Mapa', icon: <MapIcon size={13} /> },
    { id: 'chat_focus', label: 'Chat', icon: <MessageSquare size={13} /> },
  ];

  const connLabel =
    store.connectionStatus === 'connected'
      ? 'Conectado em tempo real'
      : store.connectionStatus === 'reconnecting'
      ? 'Reconectando...'
      : store.connectionStatus === 'connecting'
      ? 'Conectando...'
      : 'Offline';

  return (
    <header className="table-topbar">
      {/* Left: Lobby return, Campaign title, Invite code, Role */}
      <div className="table-topbar__group">
        <button
          type="button"
          className="mesa-btn mesa-btn--ghost mesa-btn--sm"
          onClick={onBackToLobby}
          title="Voltar ao Lobby de Campanhas"
        >
          <ArrowLeft size={15} />
          <span>Lobby</span>
        </button>

        <button
          type="button"
          className="mesa-btn mesa-btn--ghost mesa-btn--icon"
          style={{ width: 32, height: 32, minWidth: 32 }}
          onClick={() => store.setLeftSidebarOpen(!store.leftSidebarOpen)}
          title={store.leftSidebarOpen ? 'Recolher Biblioteca' : 'Expandir Biblioteca'}
          aria-label="Alternar barra esquerda"
        >
          {store.leftSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>

        <span
          className={`conn-dot conn-dot--${store.connectionStatus}`}
          title={connLabel}
          aria-label={connLabel}
        />

        <span className="table-topbar__title" title={store.campaign?.name}>
          {store.campaign?.name ?? 'Mesa VTT'}
        </span>

        {store.campaign?.inviteCode && (
          <button
            type="button"
            className="invite-code-btn"
            onClick={() => void handleCopyInvite()}
            title="Clique para copiar o código de convite"
          >
            <span>{store.campaign.inviteCode}</span>
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}

        <span className={`mesa-badge ${store.isGm ? 'mesa-badge--gold' : 'mesa-badge--sapphire'}`}>
          {store.isGm ? <Crown size={11} /> : <Sword size={11} />}
          {store.isGm ? 'Mestre' : 'Jogador'}
        </span>
      </div>

      {/* Center: Scene Selector + View Mode */}
      <div className="table-topbar__group">
        {store.scenes.length > 0 && (
          <select
            className="scene-select"
            value={store.activeScene?.id ?? ''}
            onChange={(e) => {
              if (store.isGm) {
                store.activateScene(e.target.value);
              }
            }}
            disabled={!store.isGm}
            title={
              store.isGm
                ? 'Selecionar cena ativa para toda a mesa'
                : 'Cena ativa (controlada pelo Mestre)'
            }
            aria-label="Cena ativa"
          >
            {store.scenes.map((sc) => (
              <option key={sc.id} value={sc.id}>
                Cena: {sc.name}
                {sc.visibility === 'gm_only' ? ' (Oculta GM)' : ''}
              </option>
            ))}
          </select>
        )}

        <div className="view-mode-segmented" role="group" aria-label="Modo do palco central">
          {viewModes.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`view-mode-segmented__btn ${
                store.viewMode === m.id ? 'view-mode-segmented__btn--active' : ''
              }`}
              onClick={() => store.setViewMode(m.id)}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: 3D Dice toggle + Voice Quick Pill + Right Sidebar Toggle */}
      <div className="table-topbar__group">
        <button
          type="button"
          className={`mesa-btn mesa-btn--sm ${store.dice3DEnabled ? 'mesa-btn--gold' : ''}`}
          onClick={() => store.setDice3DEnabled(!store.dice3DEnabled)}
          title="Ativar ou desativar dados 3D"
        >
          <Dices size={14} />
          <span>3D: {store.dice3DEnabled ? 'ON' : 'OFF'}</span>
        </button>

        <VoiceBar variant="topbar-pill" />

        <button
          type="button"
          className="mesa-btn mesa-btn--ghost mesa-btn--icon"
          style={{ width: 32, height: 32, minWidth: 32 }}
          onClick={() => store.setRightSidebarOpen(!store.rightSidebarOpen)}
          title={store.rightSidebarOpen ? 'Recolher Fichas e Combate' : 'Expandir Fichas e Combate'}
          aria-label="Alternar barra direita"
        >
          {store.rightSidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
    </header>
  );
}

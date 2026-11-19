import React from 'react';
import { BookOpen, Map as MapIcon, MessageSquare, Shield } from 'lucide-react';
import { useCampaignStore } from '@/lib/store';
import type { MobileTab } from '@/lib/componentProps';

export function MobileBottomNav() {
  const store = useCampaignStore();

  const tabs: Array<{
    id: MobileTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    dot?: boolean;
  }> = [
    {
      id: 'chat',
      label: 'Chat',
      icon: <MessageSquare size={20} />,
      badge: store.mobileTab !== 'chat' ? store.unreadChatCount : 0,
    },
    {
      id: 'map',
      label: 'Mapa',
      icon: <MapIcon size={20} />,
    },
    {
      id: 'sheets',
      label: 'Fichas',
      icon: <Shield size={20} />,
      dot: store.combat.active,
    },
    {
      id: 'library',
      label: 'Biblioteca',
      icon: <BookOpen size={20} />,
    },
  ];

  return (
    <nav className="mobile-bottom-nav" aria-label="Navegação da Mesa">
      {tabs.map((tab) => {
        const active = store.mobileTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className={`mobile-nav-btn ${active ? 'mobile-nav-btn--active' : ''}`}
            onClick={() => store.setMobileTab(tab.id)}
            aria-current={active ? 'page' : undefined}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge && tab.badge > 0 ? (
              <span className="mobile-nav-badge">{tab.badge > 99 ? '99+' : tab.badge}</span>
            ) : null}
            {tab.dot ? <span className="mobile-nav-dot" title="Combate ativo" /> : null}
          </button>
        );
      })}
    </nav>
  );
}

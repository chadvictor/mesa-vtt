/**
 * Shared UI Prop Contracts between `TableShell` (@client-core) and feature panels
 * owned by `@ui-dice-map` and `@ui-sheets-chat`.
 *
 * All child components also have full access to `useCampaignStore()` and `useVoice()`
 * from `@/lib/store`. Props listed here represent the exact interface `TableShell.tsx`
 * passes when mounting each component.
 */

import type {
  Character,
  DiceResultEvent,
  Document,
  Scene,
} from '@systems/types';

export type CenterViewMode = 'split' | 'map_overlay' | 'chat_focus';
export type MobileTab = 'chat' | 'map' | 'sheets' | 'library';
export type LibraryTab = 'folders' | 'compendium' | 'macros' | 'voice';
export type MapTool = 'select' | 'pan' | 'ruler' | 'ping' | 'fog_reveal' | 'fog_hide';
export type MapLayerMode = 'tokens' | 'gm';

export interface ActiveMapPing {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  color: string;
  userId: string;
  displayName: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// @ui-dice-map Component Props
// ---------------------------------------------------------------------------

export interface TacticalCanvasProps {
  scene: Scene | null;
  activeTool: MapTool;
  activeLayer: MapLayerMode;
  selectedTokenId: string | null;
  onSelectToken: (tokenId: string | null) => void;
  onOpenCharacterSheet: (characterId: string) => void;
  isGm: boolean;
  pings: ActiveMapPing[];
  compact?: boolean;
}

export interface MapToolbarProps {
  activeTool: MapTool;
  onSelectTool: (tool: MapTool) => void;
  activeLayer: MapLayerMode;
  onSelectLayer: (layer: MapLayerMode) => void;
  scene: Scene | null;
  isGm: boolean;
  compact?: boolean;
}

export interface DiceOverlay3DProps {
  enabled: boolean;
  activeRoll: DiceResultEvent | null;
  onAnimationComplete: (rollId: string) => void;
}

export interface QuickDiceBarProps {
  activeCharacter: Character | null;
  systemId: string;
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// @ui-sheets-chat Component Props
// ---------------------------------------------------------------------------

export interface LibrarySidebarProps {
  activeTab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  onOpenDocument?: (doc: Document) => void;
  /** Optional embedded slot rendered inside the "Voz" tab or bottom dock */
  voicePanelNode?: React.ReactNode;
  compact?: boolean;
}

export interface ChatPanelProps {
  compact?: boolean;
  floating?: boolean;
  onCloseFloating?: () => void;
}

export interface ChatComposerProps {
  activeCharacter: Character | null;
  onSelectActiveCharacter: (characterId: string | null) => void;
  compact?: boolean;
}

export interface CharacterSidebarProps {
  onOpenSheet: (characterId: string) => void;
  selectedTargetId: string | null;
  onSelectTarget: (characterId: string | null) => void;
  compact?: boolean;
}

export interface CharacterSheetModalProps {
  characterId: string | null;
  onClose: () => void;
  isMobile?: boolean;
}

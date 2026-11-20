import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Campaign,
  CampaignBootstrapState,
  CampaignMember,
  Character,
  ChatMessage,
  ChatMessageKind,
  CombatState,
  Combatant,
  DiceResultEvent,
  Document,
  Folder,
  IceServerConfig,
  InteractiveAction,
  Macro,
  MapPingEvent,
  MemberRole,
  RollResult,
  Scene,
  TagmarResistanceRequest,
  Token,
  UserIdentity,
  Visibility,
  VoiceChannel,
  VoiceParticipant,
  VoiceSignalPayload,
} from '@systems/types';
import * as api from './api';
import { MesaWsClient, type WsConnectionStatus } from './ws';
import { VoiceMeshManager, type VoiceStateSnapshot } from './webrtc';
import type {
  ActiveMapPing,
  CenterViewMode,
  LibraryTab,
  MapLayerMode,
  MapTool,
  MobileTab,
} from './componentProps';

export interface ToastItem {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

export interface SendChatInput {
  kind: ChatMessageKind;
  content: string;
  characterId?: string;
  visibility?: Visibility;
  visibleToUserIds?: string[];
}

export interface RollDiceInput {
  formula: string;
  label?: string;
  characterId?: string;
  visibility?: Visibility;
  visibleToUserIds?: string[];
  difficulty?: number;
  targetCharacterId?: string;
  targetDefense?: number;
  tagmarColumn?: number;
  tagmarResistance?: TagmarResistanceRequest;
  systemMeta?: Record<string, unknown>;
  actions?: InteractiveAction[];
}

export interface VoiceContextValue extends VoiceStateSnapshot {
  channels: VoiceChannel[];
  activeChannel: VoiceChannel | null;
  joinVoice: (channelId?: string) => Promise<void>;
  leaveVoice: () => void;
  switchVoiceChannel: (channelId: string) => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setPeerVolume: (userId: string, volume: number) => void;
  retryMic: () => Promise<void>;
  createVoiceChannel: (name: string, lockedForPlayers?: boolean) => Promise<void>;
  deleteVoiceChannel: (channelId: string) => Promise<void>;
  voicePanelOpen: boolean;
  setVoicePanelOpen: (open: boolean) => void;
  unlockAudio: () => void;
}

export interface CampaignStoreValue {
  // Identity & connection
  user: UserIdentity;
  role: MemberRole;
  isGm: boolean;
  connectionStatus: WsConnectionStatus;
  loading: boolean;
  error: string | null;
  toasts: ToastItem[];
  pushToast: (message: string, tone?: ToastItem['tone']) => void;
  dismissToast: (id: string) => void;

  // Domain state
  campaign: Campaign | null;
  members: CampaignMember[];
  folders: Folder[];
  documents: Document[];
  characters: Character[];
  scenes: Scene[];
  activeSceneId: string | null;
  activeScene: Scene | null;
  messages: ChatMessage[];
  macros: Macro[];
  voiceChannels: VoiceChannel[];
  combat: CombatState;

  // UI & Table state
  viewMode: CenterViewMode;
  setViewMode: (mode: CenterViewMode) => void;
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  libraryTab: LibraryTab;
  setLibraryTab: (tab: LibraryTab) => void;
  leftSidebarOpen: boolean;
  setLeftSidebarOpen: (open: boolean) => void;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: (open: boolean) => void;
  dice3DEnabled: boolean;
  setDice3DEnabled: (enabled: boolean) => void;

  // Selections
  activeCharacterId: string | null;
  setActiveCharacterId: (id: string | null) => void;
  activeCharacter: Character | null;
  targetCharacterId: string | null;
  setTargetCharacterId: (id: string | null) => void;
  targetCharacter: Character | null;
  selectedTokenId: string | null;
  setSelectedTokenId: (id: string | null) => void;
  openSheetCharacterId: string | null;
  setOpenSheetCharacterId: (id: string | null) => void;
  mapTool: MapTool;
  setMapTool: (tool: MapTool) => void;
  mapLayer: MapLayerMode;
  setMapLayer: (layer: MapLayerMode) => void;

  // Ephemeral visual state
  activePings: ActiveMapPing[];
  activeDiceRoll: DiceResultEvent | null;
  dismissDiceRoll: (rollId: string) => void;
  unreadChatCount: number;
  clearUnreadChat: () => void;

  // Actions — Chat & Dice
  sendChat: (input: SendChatInput) => void;
  rollDice: (input: RollDiceInput) => void;
  executeChatAction: (messageId: string, actionId: string) => void;

  // Actions — Characters
  createCharacter: (
    character: Omit<Character, 'id' | 'campaignId' | 'updatedAt'>
  ) => Promise<Character | null>;
  patchCharacter: (characterId: string, patch: Partial<Character>) => void;
  deleteCharacter: (characterId: string) => Promise<void>;

  // Actions — Scenes, Tokens, Fog, Ping
  activateScene: (sceneId: string) => void;
  createScene: (scene: Omit<Scene, 'id' | 'campaignId' | 'updatedAt'>) => Promise<Scene | null>;
  updateScene: (sceneId: string, patch: Partial<Scene>) => Promise<void>;
  deleteScene: (sceneId: string) => Promise<void>;
  createToken: (sceneId: string, token: Omit<Token, 'id'>) => void;
  moveToken: (sceneId: string, tokenId: string, x: number, y: number, rotation?: number) => void;
  updateToken: (sceneId: string, tokenId: string, patch: Partial<Token>) => void;
  deleteToken: (sceneId: string, tokenId: string) => void;
  updateFog: (
    sceneId: string,
    mode: 'reveal' | 'hide' | 'reset' | 'reveal_all',
    cells?: number[]
  ) => void;
  sendMapPing: (sceneId: string, x: number, y: number, color?: string) => void;

  // Actions — Combat
  updateCombat: (
    op: 'start' | 'end' | 'next_turn' | 'prev_turn' | 'add' | 'remove' | 'set_initiative',
    combatant?: Partial<Combatant>
  ) => void;

  // Actions — Library (Folders, Documents, Macros)
  upsertFolder: (folder: Partial<Folder> & { name: string }) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  upsertDocument: (doc: Partial<Document> & { title: string }) => Promise<void>;
  deleteDocument: (docId: string) => Promise<void>;
  upsertMacro: (macro: Partial<Macro> & { name: string; script: string }) => Promise<void>;
  deleteMacro: (macroId: string) => Promise<void>;

  // Utilities
  uploadImage: (file: File) => Promise<string | null>;
  refreshState: () => Promise<void>;
}

const EMPTY_COMBAT: CombatState = {
  active: false,
  round: 1,
  turnIndex: 0,
  combatants: [],
};

const CampaignStoreContext = createContext<CampaignStoreValue | null>(null);
const VoiceContext = createContext<VoiceContextValue | null>(null);

export function useCampaignStore(): CampaignStoreValue {
  const ctx = useContext(CampaignStoreContext);
  if (!ctx) {
    throw new Error('useCampaignStore must be used inside CampaignProvider');
  }
  return ctx;
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) {
    throw new Error('useVoice must be used inside CampaignProvider');
  }
  return ctx;
}

interface CampaignProviderProps {
  campaignId: string;
  user: UserIdentity;
  initialRole?: MemberRole;
  iceServers?: IceServerConfig[];
  children: React.ReactNode;
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = { ...next[idx], ...item };
  return next;
}

export function CampaignProvider({
  campaignId,
  user,
  initialRole = 'player',
  iceServers,
  children,
}: CampaignProviderProps) {
  const [role, setRole] = useState<MemberRole>(initialRole);
  const [connectionStatus, setConnectionStatus] = useState<WsConnectionStatus>('connecting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Core domain state
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [members, setMembers] = useState<CampaignMember[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [voiceChannels, setVoiceChannels] = useState<VoiceChannel[]>([]);

  // UI state
  const [viewMode, setViewMode] = useState<CenterViewMode>('split');
  const [mobileTab, setMobileTabState] = useState<MobileTab>('chat');
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('folders');
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [dice3DEnabled, setDice3DEnabled] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return false;
    }
    return true;
  });

  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [targetCharacterId, setTargetCharacterId] = useState<string | null>(null);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [openSheetCharacterId, setOpenSheetCharacterId] = useState<string | null>(null);
  const [mapTool, setMapTool] = useState<MapTool>('select');
  const [mapLayer, setMapLayer] = useState<MapLayerMode>('tokens');

  const [activePings, setActivePings] = useState<ActiveMapPing[]>([]);
  const [diceQueue, setDiceQueue] = useState<DiceResultEvent[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);

  const mobileTabRef = useRef<MobileTab>(mobileTab);
  mobileTabRef.current = mobileTab;

  const voiceChannelsRef = useRef<VoiceChannel[]>(voiceChannels);
  voiceChannelsRef.current = voiceChannels;

  const wsRef = useRef<MesaWsClient | null>(null);
  const voiceRef = useRef<VoiceMeshManager | null>(null);

  const [voiceSnap, setVoiceSnap] = useState<VoiceStateSnapshot>({
    status: 'idle',
    activeChannelId: null,
    muted: false,
    deafened: false,
    speaking: false,
    micLevel: 0,
    listenOnly: false,
    micError: null,
    peerVolumes: {},
    peerStatuses: {},
    remoteSpeaking: {},
  });

  const pushToast = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const setMobileTab = useCallback((tab: MobileTab) => {
    setMobileTabState(tab);
    if (tab === 'chat') {
      setUnreadChatCount(0);
    }
  }, []);

  const clearUnreadChat = useCallback(() => setUnreadChatCount(0), []);

  const applyBootstrap = useCallback(
    (state: CampaignBootstrapState, memberRole?: MemberRole) => {
      setCampaign(state.campaign);
      setMembers(state.members ?? []);
      setFolders(state.folders ?? []);
      setDocuments(state.documents ?? []);
      setCharacters(state.characters ?? []);
      setScenes(state.scenes ?? []);
      setActiveSceneId(state.activeSceneId ?? state.campaign?.activeSceneId ?? state.scenes?.[0]?.id ?? null);
      setMessages(state.messages ?? []);
      setMacros(state.macros ?? []);
      setVoiceChannels(state.voiceChannels ?? []);

      if (memberRole) {
        setRole(memberRole);
      } else {
        const me = (state.members ?? []).find((m) => m.userId === user.id);
        if (me?.role) {
          setRole(me.role);
        } else if (state.campaign?.ownerUserId === user.id) {
          setRole('gm');
        }
      }

      // Auto-select player's owned PC as active speaking character if none selected
      setActiveCharacterId((prev) => {
        if (prev && (state.characters ?? []).some((c) => c.id === prev)) return prev;
        const ownedPc = (state.characters ?? []).find(
          (c) => c.kind === 'pc' && (c.ownerUserId === user.id || c.controlledByUserIds?.includes(user.id))
        );
        if (ownedPc) return ownedPc.id;
        const firstPc = (state.characters ?? []).find((c) => c.kind === 'pc');
        return firstPc?.id ?? null;
      });

      if (state.voiceChannels) {
        voiceRef.current?.handleVoiceState(state.voiceChannels);
      }
    },
    [user.id]
  );

  const refreshState = useCallback(async () => {
    try {
      const boot = await api.getCampaignState(campaignId);
      applyBootstrap(boot);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar estado da campanha.';
      setError(msg);
    }
  }, [campaignId, applyBootstrap]);

  // Initialize persistent VoiceMeshManager & WebSocket once per campaignId
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const ws = new MesaWsClient(campaignId);
    wsRef.current = ws;

    const voice = new VoiceMeshManager(
      user.id,
      {
        sendVoiceJoin: (channelId) => ws.send('voice.join', { channelId }),
        sendVoiceLeave: () => ws.send('voice.leave', {}),
        sendVoiceStatus: (status) => ws.send('voice.status', status, { queueIfOffline: false }),
        sendVoiceSignal: (signal) => ws.send('voice.signal', signal, { queueIfOffline: false }),
      },
      iceServers
    );
    voiceRef.current = voice;

    const unsubVoice = voice.subscribe((snap) => {
      if (!cancelled) setVoiceSnap(snap);
    });

    let wasEverConnected = false;
    const unsubStatus = ws.onStatus((status) => {
      if (cancelled) return;
      setConnectionStatus(status);
      if (status === 'connected') {
        if (wasEverConnected) {
          voice.handleWsReconnect();
        }
        wasEverConnected = true;
      }
    });

    // Fetch initial REST snapshot immediately so UI renders fast even before WS welcome
    void api
      .getCampaignState(campaignId)
      .then((boot) => {
        if (!cancelled) {
          applyBootstrap(boot);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Erro ao conectar à campanha.';
          setError(msg);
          setLoading(false);
        }
      });

    // Subscribe to all S2C WebSocket events
    const unsubs: Array<() => void> = [];

    unsubs.push(
      ws.on<{ userId?: string; role?: MemberRole; campaignState?: CampaignBootstrapState }>(
        'welcome',
        (payload) => {
          if (payload?.campaignState) {
            applyBootstrap(payload.campaignState, payload.role);
            setLoading(false);
            setError(null);
          } else if (payload?.role) {
            setRole(payload.role);
          }
        }
      )
    );

    unsubs.push(
      ws.on<{ code?: string; message?: string }>('error', (payload) => {
        if (payload?.message) {
          pushToast(payload.message, 'error');
        }
      })
    );

    unsubs.push(
      ws.on<{ members: CampaignMember[] }>('presence.updated', (payload) => {
        if (Array.isArray(payload?.members)) {
          setMembers(payload.members);
        }
      })
    );

    unsubs.push(
      ws.on<{ message: ChatMessage }>('chat.message', (payload) => {
        const msg = payload?.message;
        if (!msg) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev.slice(-199), msg];
        });
        if (mobileTabRef.current !== 'chat' && msg.senderUserId !== user.id) {
          setUnreadChatCount((c) => c + 1);
        }
      })
    );

    unsubs.push(
      ws.on<{ messageId: string; actionId: string; executedBy: string }>(
        'chat.action_executed',
        (payload) => {
          if (!payload?.messageId || !payload?.actionId) return;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== payload.messageId || !m.actions) return m;
              return {
                ...m,
                actions: m.actions.map((a) =>
                  a.id === payload.actionId ? { ...a, executedBy: payload.executedBy } : a
                ),
              };
            })
          );
        }
      )
    );

    unsubs.push(
      ws.on<DiceResultEvent>('dice.result', (payload) => {
        if (!payload?.roll) return;
        setDiceQueue((prev) => [...prev.slice(-4), payload]);
      })
    );

    // Characters
    const handleCharUpsert = (payload: { character?: Character } | Character) => {
      const char = 'character' in payload && payload.character ? payload.character : (payload as Character);
      if (!char?.id) return;
      setCharacters((prev) => upsertById(prev, char));
    };
    unsubs.push(ws.on('character.created', handleCharUpsert));
    unsubs.push(ws.on('character.updated', handleCharUpsert));
    unsubs.push(
      ws.on<{ characterId: string }>('character.deleted', (payload) => {
        if (!payload?.characterId) return;
        setCharacters((prev) => prev.filter((c) => c.id !== payload.characterId));
        setOpenSheetCharacterId((curr) => (curr === payload.characterId ? null : curr));
      })
    );

    // Scenes
    const handleSceneUpsert = (payload: { scene?: Scene } | Scene) => {
      const scene = 'scene' in payload && payload.scene ? payload.scene : (payload as Scene);
      if (!scene?.id) return;
      setScenes((prev) => upsertById(prev, scene));
    };
    unsubs.push(ws.on('scene.created', handleSceneUpsert));
    unsubs.push(ws.on('scene.updated', handleSceneUpsert));
    unsubs.push(
      ws.on<{ sceneId: string }>('scene.activated', (payload) => {
        if (payload?.sceneId) {
          setActiveSceneId(payload.sceneId);
          setSelectedTokenId(null);
          setCampaign((prev) => (prev ? { ...prev, activeSceneId: payload.sceneId } : prev));
        }
      })
    );
    unsubs.push(
      ws.on<{ sceneId: string }>('scene.deleted', (payload) => {
        if (!payload?.sceneId) return;
        setScenes((prev) => prev.filter((s) => s.id !== payload.sceneId));
      })
    );

    // Tokens
    unsubs.push(
      ws.on<{ sceneId: string; token: Token }>('token.created', (payload) => {
        if (!payload?.sceneId || !payload?.token) return;
        setScenes((prev) =>
          prev.map((s) =>
            s.id === payload.sceneId ? { ...s, tokens: upsertById(s.tokens, payload.token) } : s
          )
        );
      })
    );
    unsubs.push(
      ws.on<{ sceneId: string; tokenId: string; x: number; y: number; rotation?: number }>(
        'token.moved',
        (payload) => {
          if (!payload?.sceneId || !payload?.tokenId) return;
          setScenes((prev) =>
            prev.map((s) =>
              s.id === payload.sceneId
                ? {
                    ...s,
                    tokens: s.tokens.map((t) =>
                      t.id === payload.tokenId
                        ? {
                            ...t,
                            x: payload.x,
                            y: payload.y,
                            rotation: payload.rotation ?? t.rotation,
                          }
                        : t
                    ),
                  }
                : s
            )
          );
        }
      )
    );
    unsubs.push(
      ws.on<{ sceneId: string; token: Token }>('token.updated', (payload) => {
        if (!payload?.sceneId || !payload?.token) return;
        setScenes((prev) =>
          prev.map((s) =>
            s.id === payload.sceneId ? { ...s, tokens: upsertById(s.tokens, payload.token) } : s
          )
        );
      })
    );
    unsubs.push(
      ws.on<{ sceneId: string; tokenId: string }>('token.deleted', (payload) => {
        if (!payload?.sceneId || !payload?.tokenId) return;
        setScenes((prev) =>
          prev.map((s) =>
            s.id === payload.sceneId
              ? { ...s, tokens: s.tokens.filter((t) => t.id !== payload.tokenId) }
              : s
          )
        );
        setSelectedTokenId((curr) => (curr === payload.tokenId ? null : curr));
      })
    );

    // Fog & Pings
    unsubs.push(
      ws.on<{ sceneId: string; enabled: boolean; revealedCells: string }>('fog.updated', (payload) => {
        if (!payload?.sceneId) return;
        setScenes((prev) =>
          prev.map((s) =>
            s.id === payload.sceneId
              ? {
                  ...s,
                  fog: {
                    enabled: payload.enabled ?? s.fog.enabled,
                    revealedCells: payload.revealedCells ?? s.fog.revealedCells,
                  },
                }
              : s
          )
        );
      })
    );

    unsubs.push(
      ws.on<MapPingEvent>('map.ping', (payload) => {
        if (!payload?.sceneId) return;
        const ping: ActiveMapPing = {
          ...payload,
          id: `ping_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now(),
        };
        setActivePings((prev) => [...prev.slice(-10), ping]);
        window.setTimeout(() => {
          setActivePings((prev) => prev.filter((p) => p.id !== ping.id));
        }, 3200);
      })
    );

    // Combat
    unsubs.push(
      ws.on<{ combat: CombatState }>('combat.updated', (payload) => {
        if (!payload?.combat) return;
        setCampaign((prev) => (prev ? { ...prev, combat: payload.combat } : prev));
      })
    );

    // Library (Folders, Documents, Macros)
    unsubs.push(
      ws.on<{ folder: Folder }>('folder.updated', (payload) => {
        if (payload?.folder) setFolders((prev) => upsertById(prev, payload.folder));
      })
    );
    unsubs.push(
      ws.on<{ folderId: string }>('folder.deleted', (payload) => {
        if (payload?.folderId) setFolders((prev) => prev.filter((f) => f.id !== payload.folderId));
      })
    );
    unsubs.push(
      ws.on<{ document: Document }>('document.updated', (payload) => {
        if (payload?.document) setDocuments((prev) => upsertById(prev, payload.document));
      })
    );
    unsubs.push(
      ws.on<{ documentId: string }>('document.deleted', (payload) => {
        if (payload?.documentId) setDocuments((prev) => prev.filter((d) => d.id !== payload.documentId));
      })
    );
    unsubs.push(
      ws.on<{ macro: Macro }>('macro.updated', (payload) => {
        if (payload?.macro) setMacros((prev) => upsertById(prev, payload.macro));
      })
    );
    unsubs.push(
      ws.on<{ macroId: string }>('macro.deleted', (payload) => {
        if (payload?.macroId) setMacros((prev) => prev.filter((m) => m.id !== payload.macroId));
      })
    );

    // Voice events (support canonical dotted names and underscore aliases)
    const handleVoiceStateEvt = (payload: { channels?: VoiceChannel[] }) => {
      if (!Array.isArray(payload?.channels)) return;
      setVoiceChannels(payload.channels);
      voice.handleVoiceState(payload.channels);
    };
    unsubs.push(ws.on('voice.state', handleVoiceStateEvt));
    unsubs.push(ws.on('voice_state', handleVoiceStateEvt));

    const handleVoiceParticipantEvt = (payload: {
      channelId: string;
      participant: VoiceParticipant;
    }) => {
      if (!payload?.channelId || !payload?.participant) return;
      setVoiceChannels((prev) =>
        prev.map((ch) => {
          if (ch.id !== payload.channelId) return ch;
          const idx = ch.participants.findIndex((p) => p.userId === payload.participant.userId);
          const nextParticipants =
            idx === -1
              ? [...ch.participants, payload.participant]
              : ch.participants.map((p, i) => (i === idx ? { ...p, ...payload.participant } : p));
          return { ...ch, participants: nextParticipants };
        })
      );
    };
    unsubs.push(ws.on('voice.participant_updated', handleVoiceParticipantEvt));

    const handleVoiceSignalEvt = (payload: VoiceSignalPayload) => {
      void voice.handleSignal(payload);
    };
    unsubs.push(ws.on('voice.signal', handleVoiceSignalEvt));
    unsubs.push(ws.on('voice_signal', handleVoiceSignalEvt));

    ws.connect();

    return () => {
      cancelled = true;
      for (const fn of unsubs) fn();
      unsubStatus();
      unsubVoice();
      voice.destroy();
      ws.disconnect();
      voiceRef.current = null;
      wsRef.current = null;
    };
  }, [campaignId, user.id, applyBootstrap, pushToast]);

  // Keep ICE servers synced if server config arrives asynchronously
  useEffect(() => {
    voiceRef.current?.setIceServers(iceServers);
  }, [iceServers]);

  const isGm = role === 'gm';

  const activeScene = useMemo(
    () => scenes.find((s) => s.id === activeSceneId) ?? scenes[0] ?? null,
    [scenes, activeSceneId]
  );

  const activeCharacter = useMemo(
    () => characters.find((c) => c.id === activeCharacterId) ?? null,
    [characters, activeCharacterId]
  );

  const targetCharacter = useMemo(
    () => characters.find((c) => c.id === targetCharacterId) ?? null,
    [characters, targetCharacterId]
  );

  const combat = campaign?.combat ?? EMPTY_COMBAT;
  const activeDiceRoll = diceQueue[0] ?? null;

  const dismissDiceRoll = useCallback((rollId: string) => {
    setDiceQueue((prev) => prev.filter((item) => item.roll.rollId !== rollId));
  }, []);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const sendChat = useCallback((input: SendChatInput) => {
    wsRef.current?.send('chat.send', input);
  }, []);

  const rollDice = useCallback((input: RollDiceInput) => {
    wsRef.current?.send('dice.roll', input);
  }, []);

  const executeChatAction = useCallback((messageId: string, actionId: string) => {
    wsRef.current?.send('chat.action', { messageId, actionId });
  }, []);

  const createCharacter = useCallback(
    async (character: Omit<Character, 'id' | 'campaignId' | 'updatedAt'>) => {
      try {
        const res = await api.createCharacter(campaignId, character);
        if (res.character) {
          setCharacters((prev) => upsertById(prev, res.character));
          return res.character;
        }
        return null;
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao criar personagem.', 'error');
        return null;
      }
    },
    [campaignId, pushToast]
  );

  const patchCharacter = useCallback((characterId: string, patch: Partial<Character>) => {
    // Optimistic local update for responsive sliders/HP buttons
    setCharacters((prev) =>
      prev.map((c) => (c.id === characterId ? { ...c, ...patch } : c))
    );
    wsRef.current?.send('character.patch', { characterId, patch });
  }, []);

  const deleteCharacter = useCallback(
    async (characterId: string) => {
      try {
        await api.deleteCharacter(campaignId, characterId);
        setCharacters((prev) => prev.filter((c) => c.id !== characterId));
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao remover personagem.', 'error');
      }
    },
    [campaignId, pushToast]
  );

  const activateScene = useCallback((sceneId: string) => {
    setActiveSceneId(sceneId);
    wsRef.current?.send('scene.activate', { sceneId });
  }, []);

  const createScene = useCallback(
    async (scene: Omit<Scene, 'id' | 'campaignId' | 'updatedAt'>) => {
      try {
        const res = await api.createScene(campaignId, scene);
        if (res.scene) {
          setScenes((prev) => upsertById(prev, res.scene));
          return res.scene;
        }
        return null;
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao criar cena.', 'error');
        return null;
      }
    },
    [campaignId, pushToast]
  );

  const updateScene = useCallback(
    async (sceneId: string, patch: Partial<Scene>) => {
      try {
        const res = await api.updateScene(campaignId, sceneId, patch);
        if (res.scene) setScenes((prev) => upsertById(prev, res.scene));
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao atualizar cena.', 'error');
      }
    },
    [campaignId, pushToast]
  );

  const deleteScene = useCallback(
    async (sceneId: string) => {
      try {
        await api.deleteScene(campaignId, sceneId);
        setScenes((prev) => prev.filter((s) => s.id !== sceneId));
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao remover cena.', 'error');
      }
    },
    [campaignId, pushToast]
  );

  const createToken = useCallback((sceneId: string, token: Omit<Token, 'id'>) => {
    wsRef.current?.send('token.create', { sceneId, token });
  }, []);

  const moveToken = useCallback(
    (sceneId: string, tokenId: string, x: number, y: number, rotation?: number) => {
      // Optimistic local move for buttery smooth drag
      setScenes((prev) =>
        prev.map((s) =>
          s.id === sceneId
            ? {
                ...s,
                tokens: s.tokens.map((t) =>
                  t.id === tokenId ? { ...t, x, y, rotation: rotation ?? t.rotation } : t
                ),
              }
            : s
        )
      );
      wsRef.current?.send('token.move', { sceneId, tokenId, x, y, rotation });
    },
    []
  );

  const updateToken = useCallback((sceneId: string, tokenId: string, patch: Partial<Token>) => {
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              tokens: s.tokens.map((t) => (t.id === tokenId ? { ...t, ...patch } : t)),
            }
          : s
      )
    );
    wsRef.current?.send('token.update', { sceneId, tokenId, patch });
  }, []);

  const deleteToken = useCallback((sceneId: string, tokenId: string) => {
    wsRef.current?.send('token.delete', { sceneId, tokenId });
  }, []);

  const updateFog = useCallback(
    (sceneId: string, mode: 'reveal' | 'hide' | 'reset' | 'reveal_all', cells?: number[]) => {
      wsRef.current?.send('fog.update', { sceneId, mode, cells });
    },
    []
  );

  const sendMapPing = useCallback((sceneId: string, x: number, y: number, color?: string) => {
    wsRef.current?.send('map.ping', { sceneId, x, y, color: color ?? '#f2cc7b' });
  }, []);

  const updateCombat = useCallback(
    (
      op: 'start' | 'end' | 'next_turn' | 'prev_turn' | 'add' | 'remove' | 'set_initiative',
      combatant?: Partial<Combatant>
    ) => {
      wsRef.current?.send('combat.update', { op, combatant });
    },
    []
  );

  const upsertFolder = useCallback(
    async (folder: Partial<Folder> & { name: string }) => {
      try {
        if (folder.id) {
          const res = await api.updateFolder(campaignId, folder.id, folder);
          if (res.folder) setFolders((prev) => upsertById(prev, res.folder));
        } else {
          const res = await api.createFolder(campaignId, {
            parentId: folder.parentId ?? null,
            name: folder.name,
            icon: folder.icon ?? 'folder',
            sortOrder: folder.sortOrder ?? folders.length,
            visibility: folder.visibility ?? 'all_players',
            visibleToUserIds: folder.visibleToUserIds,
          });
          if (res.folder) setFolders((prev) => upsertById(prev, res.folder));
        }
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao salvar pasta.', 'error');
      }
    },
    [campaignId, folders.length, pushToast]
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      try {
        await api.deleteFolder(campaignId, folderId);
        setFolders((prev) => prev.filter((f) => f.id !== folderId));
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao remover pasta.', 'error');
      }
    },
    [campaignId, pushToast]
  );

  const upsertDocument = useCallback(
    async (doc: Partial<Document> & { title: string }) => {
      try {
        if (doc.id) {
          const res = await api.updateDocument(campaignId, doc.id, doc);
          if (res.document) setDocuments((prev) => upsertById(prev, res.document));
        } else {
          const res = await api.createDocument(campaignId, {
            folderId: doc.folderId ?? null,
            kind: doc.kind ?? 'note',
            title: doc.title,
            content: doc.content ?? '',
            imageUrl: doc.imageUrl,
            tags: doc.tags,
            visibility: doc.visibility ?? 'all_players',
            visibleToUserIds: doc.visibleToUserIds,
          });
          if (res.document) setDocuments((prev) => upsertById(prev, res.document));
        }
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao salvar documento.', 'error');
      }
    },
    [campaignId, pushToast]
  );

  const deleteDocument = useCallback(
    async (docId: string) => {
      try {
        await api.deleteDocument(campaignId, docId);
        setDocuments((prev) => prev.filter((d) => d.id !== docId));
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao remover documento.', 'error');
      }
    },
    [campaignId, pushToast]
  );

  const upsertMacro = useCallback(
    async (macro: Partial<Macro> & { name: string; script: string }) => {
      try {
        if (macro.id) {
          const res = await api.updateMacro(campaignId, macro.id, macro);
          if (res.macro) setMacros((prev) => upsertById(prev, res.macro));
        } else {
          const res = await api.createMacro(campaignId, {
            name: macro.name,
            icon: macro.icon ?? 'zap',
            color: macro.color ?? '#d4a84f',
            scope: macro.scope ?? 'campaign',
            characterId: macro.characterId,
            script: macro.script,
            visibility: macro.visibility ?? 'all_players',
            visibleToUserIds: macro.visibleToUserIds,
          });
          if (res.macro) setMacros((prev) => upsertById(prev, res.macro));
        }
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao salvar macro.', 'error');
      }
    },
    [campaignId, pushToast]
  );

  const deleteMacro = useCallback(
    async (macroId: string) => {
      try {
        await api.deleteMacro(campaignId, macroId);
        setMacros((prev) => prev.filter((m) => m.id !== macroId));
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao remover macro.', 'error');
      }
    },
    [campaignId, pushToast]
  );

  const uploadImage = useCallback(
    async (file: File) => {
      try {
        const res = await api.uploadCampaignImage(campaignId, file);
        return res.url;
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao enviar imagem.', 'error');
        return null;
      }
    },
    [campaignId, pushToast]
  );

  // -------------------------------------------------------------------------
  // Voice Actions
  // -------------------------------------------------------------------------

  const joinVoice = useCallback(async (channelId?: string) => {
    const channels = voiceChannelsRef.current;
    const target =
      (channelId ? channels.find((c) => c.id === channelId) : null) ??
      channels.find((c) => c.isDefault) ??
      channels[0];
    const targetId = target?.id ?? channelId ?? 'mesa-principal';
    await voiceRef.current?.joinChannel(targetId, target?.participants ?? []);
  }, []);

  const leaveVoice = useCallback(() => {
    voiceRef.current?.leaveChannel();
  }, []);

  const switchVoiceChannel = useCallback(async (channelId: string) => {
    const target = voiceChannelsRef.current.find((c) => c.id === channelId);
    await voiceRef.current?.joinChannel(channelId, target?.participants ?? []);
  }, []);

  const toggleMute = useCallback(() => {
    voiceRef.current?.toggleMute();
  }, []);

  const toggleDeafen = useCallback(() => {
    voiceRef.current?.toggleDeafen();
  }, []);

  const setPeerVolume = useCallback((userId: string, volume: number) => {
    voiceRef.current?.setPeerVolume(userId, volume);
  }, []);

  const retryMic = useCallback(async () => {
    await voiceRef.current?.retryMicrophone();
  }, []);

  const unlockAudio = useCallback(() => {
    voiceRef.current?.unlockAudio();
  }, []);

  const createVoiceChannel = useCallback(
    async (name: string, lockedForPlayers = false) => {
      try {
        const res = await api.createVoiceChannel(campaignId, { name, lockedForPlayers });
        if (res.channel) {
          setVoiceChannels((prev) => upsertById(prev, res.channel));
          pushToast(`Canal de voz "${res.channel.name}" criado.`, 'success');
        }
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao criar canal de voz.', 'error');
      }
    },
    [campaignId, pushToast]
  );

  const deleteVoiceChannel = useCallback(
    async (channelId: string) => {
      try {
        await api.deleteVoiceChannel(campaignId, channelId);
        setVoiceChannels((prev) => prev.filter((c) => c.id !== channelId));
        if (voiceSnap.activeChannelId === channelId) {
          voiceRef.current?.leaveChannel();
        }
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Erro ao remover canal de voz.', 'error');
      }
    },
    [campaignId, pushToast, voiceSnap.activeChannelId]
  );

  const activeVoiceChannel = useMemo(
    () => voiceChannels.find((c) => c.id === voiceSnap.activeChannelId) ?? null,
    [voiceChannels, voiceSnap.activeChannelId]
  );

  const voiceValue: VoiceContextValue = useMemo(
    () => ({
      ...voiceSnap,
      channels: voiceChannels,
      activeChannel: activeVoiceChannel,
      joinVoice,
      leaveVoice,
      switchVoiceChannel,
      toggleMute,
      toggleDeafen,
      setPeerVolume,
      retryMic,
      createVoiceChannel,
      deleteVoiceChannel,
      voicePanelOpen,
      setVoicePanelOpen,
      unlockAudio,
    }),
    [
      voiceSnap,
      voiceChannels,
      activeVoiceChannel,
      joinVoice,
      leaveVoice,
      switchVoiceChannel,
      toggleMute,
      toggleDeafen,
      setPeerVolume,
      retryMic,
      createVoiceChannel,
      deleteVoiceChannel,
      voicePanelOpen,
      unlockAudio,
    ]
  );

  const storeValue: CampaignStoreValue = useMemo(
    () => ({
      user,
      role,
      isGm,
      connectionStatus,
      loading,
      error,
      toasts,
      pushToast,
      dismissToast,

      campaign,
      members,
      folders,
      documents,
      characters,
      scenes,
      activeSceneId,
      activeScene,
      messages,
      macros,
      voiceChannels,
      combat,

      viewMode,
      setViewMode,
      mobileTab,
      setMobileTab,
      libraryTab,
      setLibraryTab,
      leftSidebarOpen,
      setLeftSidebarOpen,
      rightSidebarOpen,
      setRightSidebarOpen,
      dice3DEnabled,
      setDice3DEnabled,

      activeCharacterId,
      setActiveCharacterId,
      activeCharacter,
      targetCharacterId,
      setTargetCharacterId,
      targetCharacter,
      selectedTokenId,
      setSelectedTokenId,
      openSheetCharacterId,
      setOpenSheetCharacterId,
      mapTool,
      setMapTool,
      mapLayer,
      setMapLayer,

      activePings,
      activeDiceRoll,
      dismissDiceRoll,
      unreadChatCount,
      clearUnreadChat,

      sendChat,
      rollDice,
      executeChatAction,
      createCharacter,
      patchCharacter,
      deleteCharacter,
      activateScene,
      createScene,
      updateScene,
      deleteScene,
      createToken,
      moveToken,
      updateToken,
      deleteToken,
      updateFog,
      sendMapPing,
      updateCombat,
      upsertFolder,
      deleteFolder,
      upsertDocument,
      deleteDocument,
      upsertMacro,
      deleteMacro,
      uploadImage,
      refreshState,
    }),
    [
      user,
      role,
      isGm,
      connectionStatus,
      loading,
      error,
      toasts,
      pushToast,
      dismissToast,
      campaign,
      members,
      folders,
      documents,
      characters,
      scenes,
      activeSceneId,
      activeScene,
      messages,
      macros,
      voiceChannels,
      combat,
      viewMode,
      mobileTab,
      setMobileTab,
      libraryTab,
      leftSidebarOpen,
      rightSidebarOpen,
      dice3DEnabled,
      activeCharacterId,
      activeCharacter,
      targetCharacterId,
      targetCharacter,
      selectedTokenId,
      openSheetCharacterId,
      mapTool,
      mapLayer,
      activePings,
      activeDiceRoll,
      dismissDiceRoll,
      unreadChatCount,
      clearUnreadChat,
      sendChat,
      rollDice,
      executeChatAction,
      createCharacter,
      patchCharacter,
      deleteCharacter,
      activateScene,
      createScene,
      updateScene,
      deleteScene,
      createToken,
      moveToken,
      updateToken,
      deleteToken,
      updateFog,
      sendMapPing,
      updateCombat,
      upsertFolder,
      deleteFolder,
      upsertDocument,
      deleteDocument,
      upsertMacro,
      deleteMacro,
      uploadImage,
      refreshState,
    ]
  );

  return React.createElement(
    CampaignStoreContext.Provider,
    { value: storeValue },
    React.createElement(VoiceContext.Provider, { value: voiceValue }, children)
  );
}

// Re-export RollResult so consumers can import from store if convenient
export type { RollResult };

import type {
  Campaign,
  CampaignBootstrapState,
  CampaignMember,
  Character,
  Document,
  Folder,
  Macro,
  MemberRole,
  Scene,
  ServerPublicConfig,
  UserIdentity,
  VoiceChannel,
} from '@systems/types';

const TOKEN_STORAGE_KEY = 'mesa_vtt_session_token';
const USER_STORAGE_KEY = 'mesa_vtt_user_identity';

export interface LaunchParams {
  ticket: string | null;
  serverWsUrl: string | null;
  roomCode: string | null;
  create: boolean;
  returnUrl: string | null;
}

export interface AssetEntry {
  id: string;
  name: string;
  url: string;
  category: 'map' | 'portrait' | 'monster' | 'banner';
  cols?: number;
  rows?: number;
  width?: number;
  height?: number;
  tags?: string[];
}

export interface AssetManifest {
  banner: AssetEntry;
  maps: AssetEntry[];
  portraits: AssetEntry[];
  monsters: AssetEntry[];
}

export const FALLBACK_ASSET_MANIFEST: AssetManifest = {
  banner: {
    id: 'banner-mesa-rpg',
    name: 'Crônicas de Drakon',
    url: './assets/banner-mesa-rpg.svg',
    category: 'banner',
  },
  maps: [
    {
      id: 'tavern',
      name: 'Estalagem do Javali Dourado',
      url: './assets/maps/tavern.svg',
      category: 'map',
      cols: 24,
      rows: 18,
      width: 1600,
      height: 1200,
    },
    {
      id: 'dungeon-crypt',
      name: 'Cripta dos Antigos',
      url: './assets/maps/dungeon-crypt.svg',
      category: 'map',
      cols: 24,
      rows: 18,
      width: 1600,
      height: 1200,
    },
    {
      id: 'forest-road',
      name: 'Estrada da Floresta Sombria',
      url: './assets/maps/forest-road.svg',
      category: 'map',
      cols: 24,
      rows: 18,
      width: 1600,
      height: 1200,
    },
    {
      id: 'castle-courtyard',
      name: 'Pátio do Castelo de Drakon',
      url: './assets/maps/castle-courtyard.svg',
      category: 'map',
      cols: 24,
      rows: 18,
      width: 1600,
      height: 1200,
    },
  ],
  portraits: [
    { id: 'human-warrior', name: 'Guerreiro Humano', url: './assets/portraits/human-warrior.svg', category: 'portrait' },
    { id: 'elf-mage', name: 'Elfa Maga', url: './assets/portraits/elf-mage.svg', category: 'portrait' },
    { id: 'dwarf-paladin', name: 'Anão Paladino', url: './assets/portraits/dwarf-paladin.svg', category: 'portrait' },
    { id: 'faen-ranger', name: 'Faen Patrulheiro', url: './assets/portraits/faen-ranger.svg', category: 'portrait' },
    { id: 'orc-barbarian', name: 'Orc Bárbaro', url: './assets/portraits/orc-barbarian.svg', category: 'portrait' },
    { id: 'goblin-rogue', name: 'Goblin Ladino', url: './assets/portraits/goblin-rogue.svg', category: 'portrait' },
    { id: 'cleric-healer', name: 'Sacerdote Curandeiro', url: './assets/portraits/cleric-healer.svg', category: 'portrait' },
    { id: 'gm-avatar', name: 'Mestre do Jogo', url: './assets/portraits/gm-avatar.svg', category: 'portrait' },
  ],
  monsters: [
    { id: 'goblin-raider', name: 'Goblin Saqueador', url: './assets/monsters/goblin-raider.svg', category: 'monster' },
    { id: 'skeleton-warrior', name: 'Esqueleto Guerreiro', url: './assets/monsters/skeleton-warrior.svg', category: 'monster' },
    { id: 'dire-wolf', name: 'Lobo Atroz', url: './assets/monsters/dire-wolf.svg', category: 'monster' },
    { id: 'ancient-dragon', name: 'Dragão Ancião', url: './assets/monsters/ancient-dragon.svg', category: 'monster' },
  ],
};

export function parseLaunchParams(): LaunchParams {
  if (typeof window === 'undefined') {
    return { ticket: null, serverWsUrl: null, roomCode: null, create: false, returnUrl: null };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    ticket: params.get('ticket'),
    serverWsUrl: params.get('server'),
    roomCode: params.get('room'),
    create: params.get('create') === 'true' || params.get('create') === '1',
    returnUrl: params.get('return'),
  };
}

let cachedServerOriginBase: string | null = null;

function resolveServerBase(): { restBase: string; wsUrl: string } {
  if (typeof window === 'undefined') {
    return { restBase: '/api/v1', wsUrl: 'ws://127.0.0.1:8094/ws' };
  }

  const params = parseLaunchParams();
  if (params.serverWsUrl) {
    cachedServerOriginBase = params.serverWsUrl;
  }

  const rawWs = cachedServerOriginBase;
  if (rawWs) {
    const cleanWs = rawWs.replace(/\/+$/, '');
    const wsUrl = cleanWs.endsWith('/ws') ? cleanWs : `${cleanWs}/ws`;
    const httpBase = wsUrl
      .replace(/^wss:/i, 'https:')
      .replace(/^ws:/i, 'http:')
      .replace(/\/ws$/i, '');
    return { restBase: `${httpBase}/api/v1`, wsUrl };
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    restBase: '/api/v1',
    wsUrl: `${proto}//${window.location.host}/ws`,
  };
}

export function getWsBaseUrl(): string {
  return resolveServerBase().wsUrl;
}

export function getRestBaseUrl(): string {
  return resolveServerBase().restBase;
}

export function getAuthToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, user: UserIdentity): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Ignore private-mode storage failures
  }
}

export function getCachedUser(): UserIdentity | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserIdentity;
  } catch {
    return null;
  }
}

export function clearAuthSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { restBase } = resolveServerBase();
  const url = `${restBase}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (!options.skipAuth) {
    const token = getAuthToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  let data: unknown = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    const text = await res.text();
    data = text ? { message: text } : null;
  }

  if (!res.ok) {
    const errObj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const msg =
      (typeof errObj.error === 'string' && errObj.error) ||
      (typeof errObj.message === 'string' && errObj.message) ||
      `Erro HTTP ${res.status}`;
    const code = typeof errObj.code === 'string' ? errObj.code : undefined;
    throw new ApiError(msg, res.status, code);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Public & Auth Endpoints
// ---------------------------------------------------------------------------

export async function getServerConfig(): Promise<ServerPublicConfig> {
  return apiFetch<ServerPublicConfig>('/config', { method: 'GET', skipAuth: true });
}

export interface AuthResponse {
  token: string;
  user: UserIdentity;
  launchRoomId?: string;
  create?: boolean;
}

export async function authSSOTicket(payload: {
  ticket: string;
  roomId?: string | null;
  create?: boolean;
}): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/sso-ticket', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify(payload),
  });
}

export async function authLocal(payload: {
  displayName: string;
  avatarUrl?: string;
}): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/local', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify(payload),
  });
}

export async function getMe(): Promise<{ user: UserIdentity }> {
  return apiFetch<{ user: UserIdentity }>('/auth/me', { method: 'GET' });
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function listCampaigns(): Promise<Campaign[]> {
  const res = await apiFetch<Campaign[] | { campaigns: Campaign[] }>('/campaigns', { method: 'GET' });
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.campaigns) ? res.campaigns : [];
}

export interface CreateCampaignInput {
  name: string;
  systemId: string;
  description: string;
  coverUrl: string;
  privacy: 'public' | 'invite_only';
  inviteCode?: string;
}

export async function createCampaign(
  input: CreateCampaignInput
): Promise<{ campaign: Campaign; member?: CampaignMember }> {
  const res = await apiFetch<{ campaign: Campaign; member?: CampaignMember } | Campaign>(
    '/campaigns',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  if ('campaign' in res && res.campaign) {
    return res;
  }
  return { campaign: res as Campaign };
}

export async function joinCampaign(payload: {
  inviteCode: string;
  desiredRole?: MemberRole;
}): Promise<{ campaign: Campaign; member: CampaignMember }> {
  return apiFetch<{ campaign: Campaign; member: CampaignMember }>('/campaigns/join', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getCampaignState(campaignId: string): Promise<CampaignBootstrapState> {
  return apiFetch<CampaignBootstrapState>(`/campaigns/${encodeURIComponent(campaignId)}/state`, {
    method: 'GET',
  });
}

export async function updateCampaign(
  campaignId: string,
  patch: Partial<Pick<Campaign, 'name' | 'description' | 'coverUrl' | 'privacy' | 'activeSceneId' | 'settings'>>
): Promise<{ campaign: Campaign }> {
  return apiFetch<{ campaign: Campaign }>(`/campaigns/${encodeURIComponent(campaignId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteCampaign(campaignId: string): Promise<void> {
  await apiFetch<void>(`/campaigns/${encodeURIComponent(campaignId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Folders & Documents
// ---------------------------------------------------------------------------

export async function createFolder(
  campaignId: string,
  folder: Omit<Folder, 'id' | 'campaignId' | 'createdBy'>
): Promise<{ folder: Folder }> {
  return apiFetch<{ folder: Folder }>(`/campaigns/${encodeURIComponent(campaignId)}/folders`, {
    method: 'POST',
    body: JSON.stringify(folder),
  });
}

export async function updateFolder(
  campaignId: string,
  folderId: string,
  patch: Partial<Folder>
): Promise<{ folder: Folder }> {
  return apiFetch<{ folder: Folder }>(
    `/campaigns/${encodeURIComponent(campaignId)}/folders/${encodeURIComponent(folderId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
}

export async function deleteFolder(campaignId: string, folderId: string): Promise<void> {
  await apiFetch<void>(
    `/campaigns/${encodeURIComponent(campaignId)}/folders/${encodeURIComponent(folderId)}`,
    { method: 'DELETE' }
  );
}

export async function createDocument(
  campaignId: string,
  doc: Omit<Document, 'id' | 'campaignId' | 'createdBy' | 'updatedAt'>
): Promise<{ document: Document }> {
  return apiFetch<{ document: Document }>(`/campaigns/${encodeURIComponent(campaignId)}/documents`, {
    method: 'POST',
    body: JSON.stringify(doc),
  });
}

export async function updateDocument(
  campaignId: string,
  docId: string,
  patch: Partial<Document>
): Promise<{ document: Document }> {
  return apiFetch<{ document: Document }>(
    `/campaigns/${encodeURIComponent(campaignId)}/documents/${encodeURIComponent(docId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
}

export async function deleteDocument(campaignId: string, docId: string): Promise<void> {
  await apiFetch<void>(
    `/campaigns/${encodeURIComponent(campaignId)}/documents/${encodeURIComponent(docId)}`,
    { method: 'DELETE' }
  );
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export async function createCharacter(
  campaignId: string,
  character: Omit<Character, 'id' | 'campaignId' | 'updatedAt'>
): Promise<{ character: Character }> {
  return apiFetch<{ character: Character }>(
    `/campaigns/${encodeURIComponent(campaignId)}/characters`,
    {
      method: 'POST',
      body: JSON.stringify(character),
    }
  );
}

export async function updateCharacter(
  campaignId: string,
  characterId: string,
  patch: Partial<Character>
): Promise<{ character: Character }> {
  return apiFetch<{ character: Character }>(
    `/campaigns/${encodeURIComponent(campaignId)}/characters/${encodeURIComponent(characterId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
}

export async function deleteCharacter(campaignId: string, characterId: string): Promise<void> {
  await apiFetch<void>(
    `/campaigns/${encodeURIComponent(campaignId)}/characters/${encodeURIComponent(characterId)}`,
    { method: 'DELETE' }
  );
}

// ---------------------------------------------------------------------------
// Scenes & Macros & Voice Channels
// ---------------------------------------------------------------------------

export async function createScene(
  campaignId: string,
  scene: Omit<Scene, 'id' | 'campaignId' | 'updatedAt'>
): Promise<{ scene: Scene }> {
  return apiFetch<{ scene: Scene }>(`/campaigns/${encodeURIComponent(campaignId)}/scenes`, {
    method: 'POST',
    body: JSON.stringify(scene),
  });
}

export async function updateScene(
  campaignId: string,
  sceneId: string,
  patch: Partial<Scene>
): Promise<{ scene: Scene }> {
  return apiFetch<{ scene: Scene }>(
    `/campaigns/${encodeURIComponent(campaignId)}/scenes/${encodeURIComponent(sceneId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
}

export async function deleteScene(campaignId: string, sceneId: string): Promise<void> {
  await apiFetch<void>(
    `/campaigns/${encodeURIComponent(campaignId)}/scenes/${encodeURIComponent(sceneId)}`,
    { method: 'DELETE' }
  );
}

export async function createMacro(
  campaignId: string,
  macro: Omit<Macro, 'id' | 'campaignId' | 'createdBy'>
): Promise<{ macro: Macro }> {
  return apiFetch<{ macro: Macro }>(`/campaigns/${encodeURIComponent(campaignId)}/macros`, {
    method: 'POST',
    body: JSON.stringify(macro),
  });
}

export async function updateMacro(
  campaignId: string,
  macroId: string,
  patch: Partial<Macro>
): Promise<{ macro: Macro }> {
  return apiFetch<{ macro: Macro }>(
    `/campaigns/${encodeURIComponent(campaignId)}/macros/${encodeURIComponent(macroId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
}

export async function deleteMacro(campaignId: string, macroId: string): Promise<void> {
  await apiFetch<void>(
    `/campaigns/${encodeURIComponent(campaignId)}/macros/${encodeURIComponent(macroId)}`,
    { method: 'DELETE' }
  );
}

export async function createVoiceChannel(
  campaignId: string,
  payload: { name: string; lockedForPlayers?: boolean }
): Promise<{ channel: VoiceChannel }> {
  return apiFetch<{ channel: VoiceChannel }>(
    `/campaigns/${encodeURIComponent(campaignId)}/voice-channels`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteVoiceChannel(campaignId: string, channelId: string): Promise<void> {
  await apiFetch<void>(
    `/campaigns/${encodeURIComponent(campaignId)}/voice-channels/${encodeURIComponent(channelId)}`,
    { method: 'DELETE' }
  );
}

// ---------------------------------------------------------------------------
// Media Upload & Optional AI Image Generation
// ---------------------------------------------------------------------------

export async function uploadCampaignImage(
  campaignId: string,
  file: File
): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<{ url: string }>(`/campaigns/${encodeURIComponent(campaignId)}/upload`, {
    method: 'POST',
    body: form,
  });
}

export async function generateAiImage(
  prompt: string,
  kind: 'map' | 'portrait' | 'monster' | 'handout' = 'portrait'
): Promise<{ url: string }> {
  return apiFetch<{ url: string }>('/ai/generate-image', {
    method: 'POST',
    body: JSON.stringify({ prompt, kind }),
  });
}

// ---------------------------------------------------------------------------
// Static Asset Manifest Loader
// ---------------------------------------------------------------------------

let cachedManifest: AssetManifest | null = null;

function normalizeAssetUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  if (rawUrl.startsWith('./') || rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('data:')) {
    return rawUrl;
  }
  if (rawUrl.startsWith('/assets/')) {
    return `.${rawUrl}`;
  }
  return rawUrl;
}

export async function fetchAssetManifest(): Promise<AssetManifest> {
  if (cachedManifest) return cachedManifest;
  try {
    const res = await fetch('./assets/manifest.json');
    if (!res.ok) throw new Error('manifest not found');
    const raw = (await res.json()) as Record<string, unknown>;
    const normalizeList = (list: unknown, category: AssetEntry['category']): AssetEntry[] => {
      if (!Array.isArray(list)) return [];
      return list.map((item, idx) => {
        const obj = (item ?? {}) as Record<string, unknown>;
        return {
          id: String(obj.id ?? `${category}-${idx}`),
          name: String(obj.name ?? obj.label ?? obj.title ?? `Asset ${idx + 1}`),
          url: normalizeAssetUrl(String(obj.url ?? obj.path ?? '')),
          category,
          cols:
            typeof obj.gridCols === 'number'
              ? obj.gridCols
              : typeof obj.cols === 'number'
              ? obj.cols
              : undefined,
          rows:
            typeof obj.gridRows === 'number'
              ? obj.gridRows
              : typeof obj.rows === 'number'
              ? obj.rows
              : undefined,
          width: typeof obj.width === 'number' ? obj.width : undefined,
          height: typeof obj.height === 'number' ? obj.height : undefined,
          tags: Array.isArray(obj.tags) ? obj.tags.map(String) : undefined,
        };
      });
    };

    const rawBanner = raw.banner as Record<string, unknown> | undefined;
    const banner: AssetEntry = rawBanner
      ? {
          id: String(rawBanner.id ?? 'banner-mesa-rpg'),
          name: String(rawBanner.name ?? 'Mesa VTT'),
          url: normalizeAssetUrl(String(rawBanner.url ?? rawBanner.path ?? './assets/banner-mesa-rpg.svg')),
          category: 'banner',
        }
      : FALLBACK_ASSET_MANIFEST.banner;

    const maps = normalizeList(raw.maps, 'map');
    const portraits = normalizeList(raw.portraits, 'portrait');
    const monsters = normalizeList(raw.monsters, 'monster');

    cachedManifest = {
      banner,
      maps: maps.length > 0 ? maps : FALLBACK_ASSET_MANIFEST.maps,
      portraits: portraits.length > 0 ? portraits : FALLBACK_ASSET_MANIFEST.portraits,
      monsters: monsters.length > 0 ? monsters : FALLBACK_ASSET_MANIFEST.monsters,
    };
    return cachedManifest;
  } catch {
    cachedManifest = FALLBACK_ASSET_MANIFEST;
    return cachedManifest;
  }
}

# Mesa VTT — System Architecture & Technical Specification

> **Repository:** `github.com/chadvictor/mesa-vtt` | **Default Server Port:** `:8094` | **Vite Dev Port:** `3104`  
> **Inspiration:** RRPG Firecast (folders, permissions, rich IC/OOC chat, automated Brazilian RPG sheets) × Foundry VTT (tactical canvas, fog of war, 3D dice, scripted multisystem packages) × Discord (1-tap integrated voice channels).

---

## 1. Executive Summary & Design Invariants

**Mesa VTT** is an open-source, self-hostable, multisystem tabletop RPG Virtual Tabletop (VTT) built for **both desktop browsers and mobile phones**, running cleanly as a **single all-in-one binary or Docker container** with zero external dependencies (or backed by PostgreSQL + optional external SSO for larger deployments).

### Non-Negotiable Architectural Invariants
1. **Wire-Level Visibility Security:** `gm_only` folders, documents, hidden tokens (`layer: "gm"`), hidden scenes, secret rolls, and private whispers **MUST be filtered on the Go server** before serialization. A non-GM player's network stream must never receive secret GM content.
2. **Authoritative Dice & State:** All dice rolls use `crypto/rand` on the Go server. Clients receive the exact rolled die faces and animate 3D Three.js dice deterministically onto those exact faces.
3. **Zero-`eval` CSP Compliance:** Built for strict `script-src 'self'` (no `'unsafe-eval'`). System engines compile as TypeScript modules, and user-defined campaign macros execute inside a pure-TypeScript AST expression sandbox (`systems/sandbox.ts`).
4. **Persistent Mobile-First Voice:** WebRTC audio connections and `<audio>` sinks live at the root of the Campaign Table shell (`TableShell`), never inside tab panels — switching between Chat, Map, Sheets, and Folders on mobile **never disconnects or interrupts voice**.
5. **Zero-Config Local Storage + Optional PostgreSQL:** When `DATABASE_URL` is configured, the Go server persists to PostgreSQL (`mesa_*` tables via `pgx/v5`). When `DATABASE_URL` is empty, it automatically falls back to an atomic JSON file store (`MESA_DATA_FILE`, defaulting to `./.mesa-vtt-data.json` or `/tmp/mesa-vtt-data.json`) and seeds the demo campaign **"Crônicas de Drakon — A Estalagem do Javali Dourado"**.

---

## 2. Repository & Folder Structure

```text
mesa-vtt/
├── README.md                           # Primary documentation (PT-BR)
├── README.en.md                        # English documentation
├── CONTRIBUTING.md                     # Contributor & security guidelines
├── LICENSE                             # MIT License
├── Dockerfile                          # All-in-one multi-stage image (Node 22 + Go 1.26 -> distroless :8094)
├── compose.yaml                        # Standalone Docker Compose (+ optional --profile postgres)
├── .env.example                        # Runtime configuration reference
├── go.mod                              # module github.com/chadvictor/mesa-vtt (Go 1.26)
├── go.sum
├── docs/
│   ├── ARCHITECTURE.md                 # This specification
│   └── CREATING_SYSTEMS.md             # Guide for adding new RPG system modules
├── data/                               # Game system static compendiums (embedded by Go + imported by Vite)
│   ├── embed.go                        # //go:embed mighty-blade/*.json (package data)
│   └── mighty-blade/                   # Mighty Blade 3ª Edição verified JSON datasets
│       ├── rules.json                  # MB 3e core formulas, difficulty table, XP/levels, combat & magic rules
│       ├── races.json                  # MB 3e playable races (Manual Básico + Guia do Herói)
│       ├── classes.json                # MB 3e classes, auto abilities, starting gear
│       ├── conditions.json             # MB 3e conditions with structured automation modifiers
│       ├── abilities.json              # 169 MB 3e class/racial/general abilities with automation hooks
│       ├── spells.json                 # 110 MB 3e spells across 11 Caminhos de Magia
│       ├── equipment.json              # 115 weapons (FN/damage), armor/shields, potions & gear
│       └── bestiary.json               # 42 Drakon creatures & NPC templates ready to drop on map
├── systems/                            # Multisystem Script Engine (shared TS contracts + system bundles)
│   ├── types.ts                        # SystemManifest, SystemSchema, RpgSystemEngine, Action/Roll contracts
│   ├── sandbox.ts                      # Zero-eval safe AST expression & macro interpreter
│   ├── registry.ts                     # System registry (mighty-blade-3e, generic-rpg)
│   ├── systems.test.ts                 # Automated unit test suite for sandbox & engines
│   ├── mighty-blade-3e/
│   │   ├── manifest.json               # System metadata, diceDefaults ("2d6"), medieval dark theme accents
│   │   ├── schema.json                 # Attributes, resources (PV/PM), derived stats, sheet tabs & slots
│   │   ├── compendium.ts               # Compendium hydration & typed lookups
│   │   └── engine.ts                   # Full MB 3e automation (wizard, derived stats, crits/fumbles, combat)
│   └── generic-rpg/
│       ├── manifest.json               # Freeform customizable system metadata
│       ├── schema.json                 # Dynamic attributes, custom bars, flexible dice formulas
│       └── engine.ts                   # Generic RPG automation & macro runner
├── server/                             # Authoritative Go Backend
│   ├── cmd/
│   │   ├── server/main.go              # HTTP/WS entrypoint (:8094), graceful shutdown, static SPA serving
│   │   └── healthcheck/main.go         # Distroless healthcheck binary hitting GET /healthz
│   └── internal/
│       ├── config/config.go            # Env parsing (ports, DB, AUTH_MODE, optional SSO, ICE servers)
│       ├── auth/auth.go                # Local quick login + optional external SSO ticket consumer + HMAC tokens
│       ├── model/models.go             # Domain models, visibility checks, wire sanitization helpers
│       ├── dice/dice.go                # crypto/rand dice parser/evaluator (XdY, kh/kl, MB 2d6 crit/fumble)
│       ├── store/
│       │   ├── store.go                # Store interface
│       │   ├── postgres.go             # PostgreSQL implementation (pgx/v5 + idempotent mesa_* migrations)
│       │   └── filestore.go            # Atomic JSON file store fallback for zero-config deployments
│       ├── seed/seed.go                # Seeds "Crônicas de Drakon — A Estalagem do Javali Dourado"
│       ├── hub/
│       │   ├── hub.go                  # Campaign room manager, client registry, visibility-filtered broadcast
│       │   ├── room.go                 # Single-goroutine campaign actor loop (chat, rolls, scenes, combat)
│       │   └── voice.go                # Voice channel membership + glare-free WebRTC signaling relay
│       └── api/
│           ├── router.go               # HTTP mux, CORS, auth middleware, rate limiting, /healthz, /ws
│           ├── auth_handlers.go        # /api/v1/auth/local, /api/v1/auth/sso-ticket, /api/v1/auth/me
│           ├── campaign_handlers.go    # Campaign CRUD, join by invite code, member role management
│           ├── content_handlers.go     # Folders, documents, macros, compendium read, image upload
│           ├── character_handlers.go   # Character CRUD, sheet patches, wizard creation
│           └── scene_handlers.go       # Scenes, tokens, fog of war snapshots
└── client/                             # React 19 + TypeScript + Vite + Three.js Frontend
    ├── package.json                    # react, react-dom, lucide-react, three, @types/three, vite, typescript
    ├── tsconfig.json                   # Aliases: @/* -> src/*, @systems/* -> ../systems/*, @data/* -> ../data/*
    ├── vite.config.ts                  # base: './', port: 3104, proxy /api & /ws -> :8094, fs.allow: ['..']
    ├── index.html                      # Mobile viewport-fit=cover, dark fantasy meta theme-color
    ├── public/assets/                  # Built-in SVG artwork (maps, portraits, monsters, banner, manifest.json)
    └── src/
        ├── main.tsx
        ├── App.tsx                     # Auth gate -> Campaign Lobby <-> Campaign Table router
        ├── styles/
        │   ├── tokens.css              # Medieval obsidian/parchment/gold/emerald design tokens
        │   ├── global.css              # Base reset, scrollbar, focus rings, safe-area utilities
        │   └── table.css               # Desktop 3-column grid + mobile bottom-nav & bottom-sheets
        ├── lib/
        │   ├── api.ts                  # Typed REST client (same-origin default + optional ?server= override)
        │   ├── ws.ts                   # Auto-reconnecting typed WebSocket client with request/ack & heartbeat
        │   ├── webrtc.ts               # P2P mesh manager, glare-free offer/answer, ICE restart, per-peer gain
        │   ├── vad.ts                  # Web Audio AnalyserNode Voice Activity Detection with hysteresis
        │   └── store.ts                # Reactive campaign state store (React context + reducer)
        └── components/
            ├── lobby/
            │   ├── QuickLoginView.tsx  # Quick local profile entry & optional external SSO ticket bootstrap
            │   ├── CampaignLobby.tsx   # Hero banner, system filter, campaign cards, quick demo launch
            │   ├── CreateCampaignModal.tsx
            │   └── JoinByCodeModal.tsx
            ├── layout/
            │   ├── TableShell.tsx      # Root campaign table (owns persistent VoiceManager & DiceOverlay3D)
            │   ├── TopBar.tsx          # Campaign title, invite code copy, scene selector, view mode toggles
            │   ├── VoiceBar.tsx        # Persistent Discord-style voice strip (always visible on mobile & desktop)
            │   ├── VoicePanel.tsx      # Channel switcher, create channel (GM), peer volume sliders, mic status
            │   └── MobileBottomNav.tsx # Fixed 4-tab bar: Chat | Mapa | Fichas | Biblioteca
            ├── library/
            │   ├── LibrarySidebar.tsx  # Tabs: Pastas | Compêndio | Macros | Voz
            │   ├── FolderTree.tsx      # Nested folders + docs with visibility icons (GM / Todos / Selecionados)
            │   ├── DocumentModal.tsx   # Markdown/rich handout viewer & editor + permission picker
            │   ├── CompendiumPanel.tsx # Searchable MB 3e races, classes, abilities, spells, items, bestiary
            │   └── MacroPanel.tsx      # 1-tap macro buttons + GM sandboxed script/macro editor
            ├── chat/
            │   ├── ChatPanel.tsx       # Scrollable message stream with filter (All / IC / Rolls / Whispers)
            │   ├── ChatComposer.tsx    # Mode selector (IC as Char / OOC / Narração / Sussurro), /roll slash cmds
            │   └── RollCard.tsx        # Rich automated roll card (crit/fumble glow, die breakdown, action buttons)
            ├── map/
            │   ├── TacticalCanvas.tsx  # HTML5 2D Canvas: pan/zoom/pinch, grid, drag tokens, HP/MP bars, fog, pings
            │   ├── MapToolbar.tsx      # Select / Pan / Ruler / Ping / Fog Reveal / Fog Hide / Layer (GM) / Scene
            │   └── TokenPopover.tsx    # Quick HP/MP +/- , conditions, visibility layer, delete, open sheet
            ├── dice/
            │   ├── DiceOverlay3D.tsx   # Transparent Three.js WebGL overlay over center stage
            │   ├── diceGeometry.ts     # Procedural d4/d6/d8/d10/d12/d20/d100 meshes + numbered canvas textures
            │   ├── dicePhysics.ts      # Deterministic pre-simulated bounce physics aligned to server face result
            │   └── QuickDiceBar.tsx    # Compact d4..d100 & 2d6+Attr quick-roll dock
            └── characters/
                ├── CharacterSidebar.tsx # Combat Tracker + PCs + NPCs with quick HP/MP/Defense HUD
                ├── CombatTracker.tsx   # Initiative order, round counter, active turn glow, Next Turn (GM)
                ├── CharacterSheetModal.tsx # Full responsive sheet (modal on desktop, bottom-sheet on mobile)
                └── MightyBladeWizard.tsx   # Guided MB 3e character creator (Race -> Class -> Attrs -> Gear -> Skills)
```

---

## 3. UI & Layout Architecture (Desktop + Mobile)

### 3.1 Mode A — Campaign Lobby
- **Header:** Brand mark, current user identity pill (local profile or external SSO identity), "Entrar por Código" CTA, and primary "Criar Campanha" CTA.
- **Featured Banner:** Uses `./assets/banner-mesa-rpg.svg` (resolved via `./assets/manifest.json`) with quick-launch callout for the seeded demo campaign **"Crônicas de Drakon — A Estalagem do Javali Dourado"** (`DRAKON`).
- **Campaign Grid:** Filterable by system (`Todos`, `Mighty Blade 3ª Ed.`, `RPG Genérico`). Each card displays cover art, system badge, campaign name, GM name, active players count, active voice count, and `Entrar como Jogador` / `Entrar como Mestre` (if GM or open).
- **Create Campaign Modal:** Fields: `name`, `systemId` (`mighty-blade-3e` | `generic-rpg`), `description`, `coverUrl` (picker from asset manifest or URL), `privacy` (`public` | `invite_only`). Generates an uppercase 6-char `inviteCode` (`[A-Z0-9]{6}`).

### 3.2 Mode B — Campaign Table (`TableShell`)

#### Desktop Layout (`>= 1024px`)
```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ TopBar: [← Lobby] Crônicas de Drakon [DRAKON 📋] | Cena: Javali Dourado ▾  │
│         [Mapa+Chat | Mapa | Chat] [Dados 3D: ON] | [🎙️ Mesa Principal ● 3] │
├──────────────────┬───────────────────────────────────────┬──────────────────┤
│ Left Sidebar     │ Center Stage                          │ Right Sidebar    │
│ (280px, collaps.)│                                       │ (300px, collaps.)│
│ [Pastas|Comp|Mac]│  ┌─────────────────────────────────┐  │ ┌──────────────┐ │
│                  │  │ Interactive Tactical Map Canvas │  │ │ Combate Rd 2 │ │
│ ▸ 🔒 Segredos GM │  │ (Grid, Tokens, HP/MP, Fog, Ping)│  │ │ ▶ Aldric  14 │ │
│ ▾ 🌐 Diário      │  │   + DiceOverlay3D (Three.js)    │  │ │   Goblin  11 │ │
│   📄 Rumores     │  └─────────────────────────────────┘  │ └──────────────┘ │
│   📄 Mapa Mundo  │  ┌─────────────────────────────────┐  │                  │
│ ▸ 👤 Cartas      │  │ Rich Campaign Chat & Roll Cards │  │ Personagens (PC) │
│                  │  │ [IC: Aldric] [OOC] [Sussurro]   │  │ • Aldric 60/60   │
│ ──────────────── │  │ [QuickDice: 2d6 d4 d6 d8 d10..] │  │ • Lyra   52/60   │
│ 🔊 Voz (Discord) │  └─────────────────────────────────┘  │                  │
│ • Mesa Principal │                                       │ NPCs & Monstros  │
│   🟢 Aldric  🔊  │                                       │ • Barnabé        │
│   ⚪ Lyra    🔇  │                                       │ • Goblin Saq.    │
│ [🔇][🎧][📞Sair] │                                       │ [+ Novo / Best.] │
└──────────────────┴───────────────────────────────────────┴──────────────────┘
```
- **Center Stage View Modes:**
  1. `split` (default on wide screens): Tactical Map (top 55%, resizable splitter) + Campaign Chat (bottom 45%).
  2. `map_overlay`: Full-height Tactical Map with a translucent collapsible floating Chat drawer on the bottom-left (classic Foundry feel).
  3. `chat_focus`: Full-height Campaign Chat (classic Firecast play-by-post / theater-of-the-mind feel).

#### Mobile Layout (`< 1024px`)
- **Top Persistent Voice Bar (`48px`):** Always mounted. Displays current voice channel or 1-tap `"Entrar na Voz"` pill, live speaker avatar with glowing emerald ring, 1-tap `Mute`, `Deafen`, and `Leave` buttons, plus tap-to-open `VoicePanel` bottom sheet.
- **Main Content Area (`calc(100dvh - 48px - 60px - env(safe-area-inset-bottom))`):** Renders the active mobile tab:
  1. **Chat:** Full-screen chat stream + compact quick-dice strip + IC/OOC/Whisper composer.
  2. **Mapa:** Full-screen touch-optimized tactical canvas (1-finger pan or drag selected token, 2-finger pinch-to-zoom, floating GM tool pill, quick ruler/ping).
  3. **Fichas:** Combat Tracker + PC/NPC cards; tapping a card opens `CharacterSheetModal` as a full-height slide-up sheet.
  4. **Biblioteca:** Folders/Handouts + Compendium + Macros with large ≥44px touch rows.
- **Fixed Bottom Navigation Bar (`60px` + safe area):** 4 tabs (`Chat`, `Mapa`, `Fichas`, `Biblioteca`) with unread chat & active-turn indicator dots.

---

## 4. Core Data Models (TypeScript & Go Wire Contract)

All JSON payloads use `camelCase` keys across both REST and WebSocket messages (Go structs use explicit `json:"camelCase"` tags). Timestamps are RFC3339 UTC strings (`string` in TS, `time.Time` in Go).

### 4.1 Identity & Visibility

```ts
export type MemberRole = "gm" | "player" | "observer";

export type Visibility = "gm_only" | "all_players" | "specific_players";

export interface VisibilityRule {
  visibility: Visibility;
  visibleToUserIds?: string[]; // Required when visibility === "specific_players"
}

export interface UserIdentity {
  id: string;
  displayName: string;
  avatarUrl?: string;
  source: "local" | "sso";
  isAdmin?: boolean;
}
```

**Server-Side Visibility Function (Authoritative):**
```go
func CanView(userID string, role MemberRole, vis Visibility, visibleTo []string) bool {
    if role == RoleGM {
        return true
    }
    switch vis {
    case VisibilityAllPlayers:
        return true
    case VisibilitySpecificPlayers:
        return slices.Contains(visibleTo, userID)
    default: // VisibilityGMOnly
        return false
    }
}
```

### 4.2 Campaigns & Members

```ts
export interface Campaign {
  id: string;
  name: string;
  description: string;
  systemId: string;           // "mighty-blade-3e" | "generic-rpg"
  coverUrl: string;
  inviteCode: string;         // 4-12 uppercase alphanumeric, e.g. "DRAKON"
  privacy: "public" | "invite_only";
  ownerUserId: string;
  activeSceneId: string | null;
  combat: CombatState;
  settings: {
    allowPlayerDice3D: boolean;
    defaultVoiceChannelId: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CampaignMember {
  campaignId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  role: MemberRole;
  online: boolean;
  activeCharacterId?: string;
  joinedAt: string;
}
```

### 4.3 Hierarchical Folders & Documents (Firecast-Style Library)

```ts
export type DocumentKind = "note" | "handout" | "lore" | "item" | "npc_bio";

export interface Folder extends VisibilityRule {
  id: string;
  campaignId: string;
  parentId: string | null;
  name: string;
  icon?: string;              // lucide icon key, e.g. "book-open", "lock", "scroll"
  sortOrder: number;
  createdBy: string;
}

export interface Document extends VisibilityRule {
  id: string;
  campaignId: string;
  folderId: string | null;
  kind: DocumentKind;
  title: string;
  content: string;            // Markdown text
  imageUrl?: string;          // Optional handout illustration
  tags?: string[];
  createdBy: string;
  updatedAt: string;
}
```

### 4.4 Characters (System-Agnostic Core + Typed `systemData`)

```ts
export type CharacterKind = "pc" | "npc" | "monster";

export interface ResourceBar {
  current: number;
  max: number;
  temp?: number;
}

export interface ActiveCondition {
  id: string;                 // Matches conditions.json id (e.g. "queimando", "atordoado")
  name: string;
  icon: string;
  roundsRemaining?: number;   // undefined = manual/indefinite
  notes?: string;
}

export interface Character extends VisibilityRule {
  id: string;
  campaignId: string;
  systemId: string;           // "mighty-blade-3e" | "generic-rpg"
  kind: CharacterKind;
  name: string;
  subtitle?: string;          // e.g. "Guerreiro Humano · Nível 1"
  portraitUrl: string;
  ownerUserId: string | null; // Player who controls this PC (GM always controls all)
  controlledByUserIds: string[];
  resources: Record<string, ResourceBar>; // e.g. { pv: {current:60,max:60}, pm: {current:60,max:60} }
  conditions: ActiveCondition[];
  systemData: Record<string, unknown>;    // Raw editable sheet fields (raceId, classId, attrs, items, abilities, spells, xp, level, notes)
  computed: Record<string, unknown>;      // Cached derived stats (bloqueio, esquiva, determinacao, movement, fnPenalty)
  updatedAt: string;
}
```

### 4.5 Tactical Scenes, Tokens & Fog of War

```ts
export interface Scene extends VisibilityRule {
  id: string;
  campaignId: string;
  name: string;
  imageUrl: string;           // e.g. "./assets/maps/tavern.svg" (or uploaded PNG/JPEG/WebP)
  width: number;              // Canvas logical width in px (default 1600)
  height: number;             // Canvas logical height in px (default 1200)
  grid: {
    enabled: boolean;
    cols: number;             // e.g. 24
    rows: number;             // e.g. 18
    cellMeters: number;       // e.g. 1.5 (Mighty Blade / standard 1.5m square)
    color: string;            // e.g. "rgba(255,255,255,0.16)"
    snap: boolean;
  };
  fog: {
    enabled: boolean;
    /** Row-major boolean grid encoded as compact bitstring ("0" = hidden, "1" = revealed) of length cols * rows */
    revealedCells: string;
  };
  tokens: Token[];
  updatedAt: string;
}

export interface Token {
  id: string;
  characterId: string | null;
  name: string;
  imageUrl: string;
  x: number;                  // Grid cell X (supports fractional for free placement)
  y: number;                  // Grid cell Y
  size: number;               // Grid cells diameter (1 = Medium, 2 = Large, 3 = Huge)
  rotation: number;           // Degrees 0..359
  color: string;              // Ring accent hex
  layer: "tokens" | "gm";     // "gm" tokens are STRIPPED on wire for non-GM players!
  showBars: boolean;
  hp?: number;
  hpMax?: number;
  mp?: number;
  mpMax?: number;
  conditions: string[];       // Condition icons/ids
  controlledByUserIds: string[];
}
```

### 4.6 Combat Tracker

```ts
export interface Combatant {
  id: string;
  characterId: string | null;
  tokenId: string | null;
  name: string;
  portraitUrl: string;
  initiative: number;
  isNpc: boolean;
  hidden: boolean;            // Stripped on wire for non-GM players
  acted: boolean;
}

export interface CombatState {
  active: boolean;
  round: number;
  turnIndex: number;
  combatants: Combatant[];    // Sorted descending by initiative
}
```

### 4.7 Rich Chat, Authoritative Rolls & Interactive Actions

```ts
export type ChatMessageKind =
  | "ic"
  | "ooc"
  | "narration"
  | "whisper"
  | "roll"
  | "system"
  | "combat_action";

export interface RolledDie {
  sides: number;              // 4 | 6 | 8 | 10 | 12 | 20 | 100
  value: number;              // Authoritative crypto/rand face value (1..sides)
  dropped?: boolean;          // For kh/kl rolls
  exploded?: boolean;
}

export interface InteractiveAction {
  id: string;
  label: string;              // e.g. "Aplicar 14 de Dano em Goblin Saqueador"
  style: "damage" | "heal" | "mana" | "condition" | "roll" | "neutral";
  actionType: "apply_damage" | "apply_heal" | "spend_mana" | "apply_condition" | "roll_followup";
  targetCharacterId?: string;
  payload: Record<string, unknown>; // { amount: 14, damageType: "corte" } or { formula: "2d6+3" }
  executedBy?: string;        // Set once clicked so users see confirmation
}

export interface RollResult {
  rollId: string;
  formula: string;            // e.g. "2d6 + 4"
  label: string;              // e.g. "Ataque: Espada Longa"
  dice: RolledDie[];
  modifier: number;
  total: number;
  seed: number;               // Deterministic uint32 seed for synchronized 3D physics replay
  outcome?: {
    kind: "critical" | "fumble" | "success" | "failure" | "info";
    badgeText?: string;       // e.g. "CRÍTICO! (6+6)", "FALHA CRÍTICA (1+1)", "ACERTO vs Bloqueio 11"
    difficulty?: number;
    targetDefense?: number;
    targetName?: string;
    margin?: number;
  };
  systemMeta?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  campaignId: string;
  kind: ChatMessageKind;
  senderUserId: string;
  senderName: string;
  characterId?: string;
  characterName?: string;
  portraitUrl?: string;
  content: string;
  roll?: RollResult;
  actions?: InteractiveAction[];
  visibility: Visibility;     // "all_players" | "gm_only" | "specific_players"
  visibleToUserIds?: string[]; // Populated for whispers / secret player rolls
  createdAt: string;
}
```

### 4.8 Macros & Voice Channels

```ts
export interface Macro extends VisibilityRule {
  id: string;
  campaignId: string;
  name: string;
  icon: string;
  color: string;
  scope: "campaign" | "character";
  characterId?: string;
  script: string;             // Safe sandbox macro script (see Section 7.4)
  createdBy: string;
}

export interface VoiceChannel {
  id: string;
  campaignId: string;
  name: string;               // Default: "Mesa Principal"
  isDefault: boolean;
  lockedForPlayers?: boolean; // Optional GM-only whisper room
  participants: VoiceParticipant[];
}

export interface VoiceParticipant {
  userId: string;
  displayName: string;
  portraitUrl?: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
}
```

---

## 5. REST API & WebSocket Wire Protocol

### 5.1 URL Resolution (Same-Origin Default & Optional External SSO)
- **Standalone / Single-Binary / Vite Dev (`localhost:3104` -> `:8094` or Docker `:8094`):**
  - REST Base: `/api/v1` (same-origin, or proxied to `http://127.0.0.1:8094/api/v1` during Vite dev)
  - WebSocket: `ws(s)://<host>/ws` (same-origin, or proxied to `ws://127.0.0.1:8094/ws` during Vite dev)
- **External SSO Launcher (`/?ticket=<t>&server=<wsUrl>&room=<code|LOBBY>&create=<bool>`):**
  - WebSocket URL: parsed from optional `?server=` query param (e.g. `wss://vtt.example.org/ws`)
  - REST Base: derived from `?server=` by replacing `ws`→`http` and stripping trailing `/ws`
  - CORS headers honor `APP_ORIGIN` when set (and allow cross-origin dev requests when `AUTH_MODE=local` and `APP_ORIGIN` is unset). All authenticated calls use `Authorization: Bearer <mesaSessionToken>` (with optional `HttpOnly` cookie).

### 5.2 REST Endpoints (`/api/v1/...`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/healthz` | Public | Liveness check (`200 {"status":"ok"}`) |
| `GET` | `/api/v1/config` | Public | Returns `{ authMode, localAuthEnabled, iceServers, systems: ["mighty-blade-3e", "generic-rpg"], aiImageEnabled }` |
| `POST` | `/api/v1/auth/local` | Local (default) | Body `{ displayName, avatarUrl? }`. Issues HMAC session token for standalone play. Returns `403` when `AUTH_MODE=sso`. |
| `POST` | `/api/v1/auth/sso-ticket` | Public | Body `{ ticket, roomId, create }`. Consumes one-time external SSO ticket via `EXTERNAL_TICKET_URL` with `EXTERNAL_AUTH_TOKEN`, returning `{ token, user, launchRoomId, create }`. |
| `GET` | `/api/v1/auth/me` | Bearer | Returns `{ user }`. |
| `GET` | `/api/v1/campaigns` | Bearer | Lists campaigns the user belongs to + `public` campaigns (never leaks secrets). |
| `POST` | `/api/v1/campaigns` | Bearer | Creates campaign (`name, systemId, description, coverUrl, privacy, inviteCode?`). Creator becomes `gm`. Creates default scene & `"Mesa Principal"` voice channel. |
| `POST` | `/api/v1/campaigns/join` | Bearer | Body `{ inviteCode, desiredRole? }`. Joins campaign as `player` (or `gm` if creator / `AUTH_MODE=local` / demo campaign `DRAKON`). Returns `{ campaign, member }`. |
| `GET` | `/api/v1/campaigns/{id}/state` | Member | Returns full visibility-filtered campaign bootstrap: `{ campaign, members, folders, documents, characters, scenes, activeSceneId, messages (last 100), macros, voiceChannels }`. |
| `PATCH` | `/api/v1/campaigns/{id}` | GM | Updates campaign metadata, `activeSceneId`, or settings. |
| `DELETE` | `/api/v1/campaigns/{id}` | GM | Deletes campaign. |
| `POST` | `/api/v1/campaigns/{id}/folders` | GM | Creates folder with visibility rules. |
| `PATCH` / `DELETE` | `/api/v1/campaigns/{id}/folders/{fid}` | GM | Updates/deletes folder. |
| `POST` | `/api/v1/campaigns/{id}/documents` | Member* | Creates document (GM can set any visibility; players can create player-shared notes). |
| `PATCH` / `DELETE` | `/api/v1/campaigns/{id}/documents/{did}` | GM/Author | Updates content, handout image, or visibility permissions. |
| `POST` | `/api/v1/campaigns/{id}/characters` | Member | Creates PC/NPC/Monster (players can create their own PC; GM can create any). |
| `PATCH` / `DELETE` | `/api/v1/campaigns/{id}/characters/{cid}` | GM/Owner | Updates character sheet (`systemData`, `computed`, `resources`, `conditions`, `visibility`). |
| `POST` | `/api/v1/campaigns/{id}/scenes` | GM | Creates tactical scene (map URL, grid, initial fog). |
| `PATCH` / `DELETE` | `/api/v1/campaigns/{id}/scenes/{sid}` | GM | Updates scene properties, grid, or visibility. |
| `POST` | `/api/v1/campaigns/{id}/macros` | Member | Creates campaign or character macro. |
| `PATCH` / `DELETE` | `/api/v1/campaigns/{id}/macros/{mid}` | GM/Author | Updates/deletes macro. |
| `POST` | `/api/v1/campaigns/{id}/voice-channels` | GM | Creates an extra voice channel (e.g. `"Sussurro do Mestre"`). |
| `DELETE` | `/api/v1/campaigns/{id}/voice-channels/{vcid}` | GM | Removes non-default voice channel. |
| `POST` | `/api/v1/campaigns/{id}/upload` | Member | Accepts image upload (PNG/JPEG/WebP, max 4 MB) -> returns `{ url }` (data URI or stored asset URL) for custom maps/portraits/handouts. |

### 5.3 WebSocket Envelope & Events (`/ws?token=<bearer>&campaignId=<id>`)

Every WebSocket frame is JSON with max read limit `256 KiB`:
```ts
export interface WsEnvelope<T = unknown> {
  type: string;
  requestId?: string;
  payload: T;
}
```

#### Client → Server (`C2S`) Messages
| `type` | Payload | Authorization & Behavior |
|---|---|---|
| `ping` | `{ clientTime: number }` | Responds `pong` with `serverTime`. |
| `chat.send` | `{ kind, content, characterId?, visibility?, visibleToUserIds? }` | Persists & broadcasts only to permitted recipients. |
| `dice.roll` | `{ formula, label, characterId?, visibility?, visibleToUserIds?, difficulty?, targetCharacterId?, targetDefense?, systemMeta?, actions? }` | Server rolls with `crypto/rand`, computes crit/fumble/success, persists as `roll` chat message, emits `chat.message` + `dice.result` ONLY to permitted users. |
| `chat.action` | `{ messageId, actionId }` | Executes interactive RollCard button (e.g. apply damage/heal/mana/condition to target character, validates GM or owner permission), updates character & token bars, marks action executed, posts concise audit line. |
| `character.patch` | `{ characterId, patch: Partial<Character> }` | GM or owner updates HP/PM/attributes/inventory/conditions; auto-syncs linked tokens on active scene; broadcasts `character.updated` (+ `token.updated`). |
| `scene.activate` | `{ sceneId }` | GM switches active scene; broadcasts `scene.activated`. |
| `token.create` | `{ sceneId, token: Omit<Token, "id"> }` | GM drops PC/NPC/Monster token onto map; broadcasts `token.created` (GM-only if `layer === "gm"`). |
| `token.move` | `{ sceneId, tokenId, x, y, rotation? }` | GM or token controller moves token; broadcasts `token.moved` (throttled live drag or commit). |
| `token.update` | `{ sceneId, tokenId, patch: Partial<Token> }` | GM (or owner for own PC HP/conditions) updates token; if `layer` flips `gm <-> tokens`, server sends `token.created` or `token.deleted` to players accordingly! |
| `token.delete` | `{ sceneId, tokenId }` | GM removes token; broadcasts `token.deleted`. |
| `fog.update` | `{ sceneId, mode: "reveal" \| "hide" \| "reset" \| "reveal_all", cells?: number[] }` | GM only. Mutates `fog.revealedCells` bitstring and broadcasts `fog.updated`. |
| `map.ping` | `{ sceneId, x, y, color? }` | Broadcasts ephemeral ping ripple to all viewers of `sceneId`. |
| `combat.update` | `{ op: "start" \| "end" \| "next_turn" \| "prev_turn" \| "add" \| "remove" \| "set_initiative", combatant? }` | GM only (except player rolling own initiative); broadcasts visibility-filtered `combat.updated`. |
| `folder.upsert` / `folder.delete` | `{ folder }` / `{ folderId }` | GM only; broadcasts filtered `library.sync` / `folder.updated` / `folder.deleted`. |
| `document.upsert` / `document.delete` | `{ document }` / `{ documentId }` | GM or author; broadcasts visibility-filtered `document.updated` (or `document.deleted` if a player lost visibility!). |
| `voice.join` | `{ channelId }` | Joins voice channel, broadcasts `voice.state`, returns existing peer list so joiner initiates WebRTC offers. |
| `voice.leave` | `{}` | Leaves current voice channel, broadcasts `voice.state`. |
| `voice.status` | `{ muted, deafened, speaking }` | Updates participant state (VAD throttled ≤5 Hz), broadcasts `voice.participant_updated`. |
| `voice.signal` | `{ targetUserId, kind: "offer" \| "answer" \| "ice", sdp?, candidate? }` | Relays WebRTC SDP/ICE directly to `targetUserId` if both users are in the same campaign & voice channel. |

#### Server → Client (`S2C`) Messages
- `welcome`: `{ userId, role, serverTime, campaignState }` (full visibility-filtered initial snapshot)
- `pong`: `{ clientTime, serverTime }`
- `error`: `{ requestId?, code, message }`
- `presence.updated`: `{ members: CampaignMember[] }`
- `chat.message`: `{ message: ChatMessage }`
- `chat.action_executed`: `{ messageId, actionId, executedBy }`
- `dice.result`: `{ roll: RollResult, senderUserId, senderName, characterName?, visibility }` (triggers 3D dice overlay!)
- `character.created` / `character.updated` / `character.deleted`
- `scene.created` / `scene.updated` / `scene.activated` / `scene.deleted`
- `token.created` / `token.moved` / `token.updated` / `token.deleted`
- `fog.updated`: `{ sceneId, enabled, revealedCells }`
- `map.ping`: `{ sceneId, x, y, color, userId, displayName }`
- `combat.updated`: `{ combat: CombatState }`
- `folder.updated` / `folder.deleted` / `document.updated` / `document.deleted` / `macro.updated` / `macro.deleted`
- `voice.state`: `{ channels: VoiceChannel[] }`
- `voice.participant_updated`: `{ channelId, participant: VoiceParticipant }`
- `voice.signal`: `{ fromUserId, kind: "offer" | "answer" | "ice", sdp?, candidate? }`

---

## 6. Discord-Style Integrated WebRTC Voice Architecture

### 6.1 Topology & Glare-Free Signaling Protocol
- **Topology:** Full peer-to-peer WebRTC audio mesh (`RTCPeerConnection` per remote peer in the same `VoiceChannel`). For 2–10 tabletop RPG players, mesh requires zero media server CPU/bandwidth on the VPS and achieves <50ms peer latency.
- **Glare-Free Handshake Rule:**
  1. User B clicks **"Entrar na Voz"** (`voice.join { channelId }`).
  2. Server adds B to channel and sends `voice.state` (containing existing members `[A, C]`).
  3. **Joiner always initiates:** User B creates an `RTCPeerConnection` for each existing peer (`A` and `C`), adds its local audio track (if mic granted; or `addTransceiver('audio', { direction: 'recvonly' })` in Listen-Only mode!), creates an SDP offer, and sends `voice.signal { targetUserId, kind: "offer", sdp }`.
  4. Existing peers `A` and `C` receive the offer, create their `RTCPeerConnection` for B, attach their local track, answer with `voice.signal { targetUserId: B, kind: "answer", sdp }`, and trickle ICE candidates (`kind: "ice"`).
  5. Because only the newly joined peer creates initial offers, simultaneous offer glare cannot occur during joins. On ICE restart, the peer with `myUserId < remoteUserId` triggers `restartIce()`.

### 6.2 Audio Graph, VAD & Mobile Compatibility
- **Audio Constraints:** `{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }`.
- **Voice Activity Detection (`vad.ts`):** Local mic stream feeds a Web Audio `AnalyserNode` (`fftSize = 512`). A 100ms interval computes RMS level; hysteresis (`startThreshold = 0.035`, `stopThreshold = 0.02`, `holdMs = 300`) prevents flickering. State transitions emit `voice.status { speaking }` (max 5/sec) to drive the **glowing emerald speaker ring** across all UI surfaces.
- **Mobile Safari & Android Autoplay Unlock:**
  - `AudioContext` is created/resumed synchronously inside the user's `"Entrar na Voz"` tap handler.
  - Each remote peer audio stream binds to an `<audio autoPlay playsInline>` element routed through a Web Audio `GainNode` (supporting `0%..200%` per-peer volume boost; falls back gracefully to `audio.volume` if `createMediaElementSource` is restricted).
  - **Mute** toggles `localTrack.enabled = false` (instant, zero renegotiation).
  - **Deafen** sets all remote peer gains to `0` AND mutes local mic (Discord behavior).
  - **Graceful Mic Failure:** If `getUserMedia` is denied or unavailable, user can still join in **Modo Ouvinte (Listen-Only)** with a clear PT-BR toast explaining how to re-enable mic permission.
- **ICE Servers:** Configured via `MESA_ICE_SERVERS` JSON env var (served by `GET /api/v1/config`), defaulting to:
  ```json
  [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": "stun:stun1.l.google.com:19302" }
  ]
  ```
  Adding a TURN server in production requires only setting `MESA_ICE_SERVERS` without code changes.

---

## 7. 3D Three.js Dice Engine (Authoritative & Deterministic)

- **Rendering:** `DiceOverlay3D.tsx` renders a single full-center-stage transparent Three.js WebGL `<canvas>` (`alpha: true`, `pointer-events: none`, `z-index: 40`). It sleeps completely (`requestAnimationFrame` stopped) when no roll is active, consuming zero GPU/battery during chat or voice.
- **Supported Polyhedra (`diceGeometry.ts`):** `d4`, `d6`, `d8`, `d10`, `d12`, `d20`, and `d100` (pair of `d10` tens `00..90` + `d10` units `0..9`), each with crisp canvas-generated metallic/gold numerals on dark obsidian/emerald/crimson PBR materials (special gold glow trail on Critical Hit, crimson shake on Fumble).
- **Deterministic Face-Aligned Physics (`dicePhysics.ts`):**
  1. When `dice.result` arrives with `dice: RolledDie[]` and `seed: uint32`:
  2. For each die, run a fast (~0.3ms) **pre-simulation** of rigid-body throw + gravity + floor/wall restitution bounce using a seeded Mulberry32 PRNG derived from `seed + dieIndex` until angular & linear velocities settle (`~1.3s`, 78 frames at 60Hz), recording trajectory `pos[t], quat[t]`.
  3. Inspect the resting orientation `quat[last]` to determine which local face normal `n_top` ended up pointing closest to world `+Y (0, 1, 0)`.
  4. Compute the exact mesh-local correction quaternion `q_fix = Quaternion.fromUnitVectors(localNormalOf(targetValue), n_top)` and bake/apply `q_fix` to the die mesh's inner geometry pivot!
  5. Play back `pos[t]` and `quat[t] * q_fix`: the die tumbles, bounces, and settles with **100% authentic physics and zero snapping**, landing strictly on the server-authoritative rolled face every single time!
  6. Fade out smoothly 2.4s after settling (or click-to-dismiss). Users can toggle 3D dice off in the TopBar (automatically respects `prefers-reduced-motion`).

---

## 8. Multisystem Script Engine API Contract (`systems/`)

### 8.1 Bundle Format (`systems/<systemId>/`)
Every RPG system is a self-contained module consisting of:
1. `manifest.json` — system identity, default dice expression, accent theme, feature flags.
2. `schema.json` — declarative attributes, resource bars, derived stat definitions, sheet tabs, equipment slots.
3. `engine.ts` — pure deterministic TypeScript rules engine implementing `RpgSystemEngine`.

### 8.2 TypeScript SDK Interfaces (`systems/types.ts`)

```ts
export interface SystemManifest {
  id: string;                 // "mighty-blade-3e" | "generic-rpg"
  name: string;               // "Mighty Blade 3ª Edição"
  version: string;            // "3.5.0"
  author: string;
  description: string;
  language: string;           // "pt-BR"
  diceDefaults: {
    coreFormula: string;      // "2d6" for MB 3e, "1d20" for generic
    quickDice: number[];      // [6, 4, 8, 10, 12, 20, 100]
  };
  theme: {
    primary: string;
    accent: string;
    badge: string;
  };
  supportsWizard: boolean;
}

export interface SystemSchema {
  attributes: Array<{
    key: string;              // "forca" | "agilidade" | "inteligencia" | "vontade"
    label: string;
    abbr: string;
    min: number;
    max: number;
    defaultValue: number;
  }>;
  resources: Array<{
    key: string;              // "pv" | "pm"
    label: string;
    abbr: string;
    color: string;
  }>;
  derivedStats: Array<{
    key: string;              // "bloqueio" | "esquiva" | "determinacao" | "deslocamento" | "cargaMax"
    label: string;
    formulaHint: string;
  }>;
  sheetTabs: Array<{
    id: string;               // "resumo" | "combate" | "habilidades" | "magias" | "inventario" | "notas"
    label: string;
  }>;
}

export interface RollPlan {
  formula: string;            // e.g. "2d6 + 4"
  label: string;
  difficulty?: number;
  targetCharacterId?: string;
  targetDefense?: number;
  manaCost?: number;
  systemMeta: Record<string, unknown>;
}

export interface RollEvaluation {
  outcome: NonNullable<RollResult["outcome"]>;
  actions: InteractiveAction[];
}

export interface RpgSystemEngine {
  manifest: SystemManifest;
  schema: SystemSchema;

  /** Recomputes derived stats & resource maximums from systemData + active conditions. */
  computeDerivedStats(character: Character): {
    computed: Record<string, unknown>;
    resourceMax: Record<string, number>;
  };

  /** Guided creation (MB 3e wizard) or blank template creation. */
  createCharacterFromWizard(input: Record<string, unknown>): Omit<Character, "id" | "campaignId" | "updatedAt">;

  /** Builds authoritative RollPlans sent to Go server via WS `dice.roll`. */
  planAttributeCheck(character: Character, attrKey: string, opts?: { bonus?: number; difficulty?: number; label?: string }): RollPlan;
  planAttack(character: Character, weaponId: string, target?: Character): RollPlan;
  planAbility(character: Character, abilityId: string, target?: Character): RollPlan;
  planSpell(character: Character, spellId: string, target?: Character): RollPlan;
  planInitiative(character: Character): RollPlan;

  /** Evaluates authoritative server dice faces -> crit/fumble/success + 1-click chat action buttons. */
  evaluateRoll(roll: RollResult, actor?: Character, target?: Character): RollEvaluation;

  /** State mutators returning partial patches ready for `character.patch`. */
  applyDamage(character: Character, amount: number, damageType?: string): Partial<Character>;
  applyHealing(character: Character, amount: number): Partial<Character>;
  spendMana(character: Character, amount: number): { patch?: Partial<Character>; error?: string };
  applyCondition(character: Character, conditionId: string, rounds?: number): Partial<Character>;
  removeCondition(character: Character, conditionId: string): Partial<Character>;
  levelUp(character: Character, choices: Record<string, unknown>): Partial<Character>;
  shortRest(character: Character): Partial<Character>;
  longRest(character: Character): Partial<Character>;

  /** Compendium accessor for Library -> Compendium tab & Bestiary drop-on-map. */
  getCompendium(): Record<string, unknown[]>;
}
```

### 8.3 Flagship System: `mighty-blade-3e` Automation Contract
- Loads all 8 verified JSON datasets from `@data/mighty-blade/` (`rules.json`, `races.json`, `classes.json`, `conditions.json`, `abilities.json`, `spells.json`, `equipment.json`, `bestiary.json`) so rules stay 100% data-driven and verifiable.
- **Character Creation Wizard (`MightyBladeWizard.tsx`):**
  1. Choose **Raça** (from `races.json` — sets base attributes, racial ability, movement/size, portrait suggestion).
  2. Choose **Classe** (from `classes.json` — applies class attribute bonuses, automatic class ability, starting equipment, allowed magic paths).
  3. Distribute **Pontos de Atributo** (per `rules.json` starting point allocation rules) with live preview of `PV`, `PM`, `Bloqueio`, `Esquiva`, `Determinação`, `Deslocamento`.
  4. Pick initial **Habilidades / Magias** (filtered by class & allowed paths from `abilities.json` & `spells.json`).
  5. Confirm name, portrait (from `./assets/portraits/`), and background -> produces a fully populated, automation-ready Mighty Blade 3e sheet!
- **Combat & Magic Automation:**
  - `2d6 + atributo + bônus` rolls automatically detect **Crítico (6+6)** and **Falha Crítica (1+1)** per `rules.json`.
  - Attacking a targeted token automatically reads target's `Bloqueio` / `Esquiva` and produces 1-click `"Aplicar X de Dano"` button on the Roll Card.
  - Casting a spell/ability checks current `PM >= manaCost`, offers 1-click `"Gastar X PM"` (or auto-deducts when configured), evaluates conjuration vs `difficulty`, and emits 1-click Damage / Healing / Condition buttons!
  - Equipped weapons/armor check `FN` (Força Necessária) and apply armor/shield defense bonuses & agility/dodge penalties automatically inside `computeDerivedStats`.

### 8.4 Second System: `generic-rpg`
- Implements `RpgSystemEngine` with user-customizable attribute list, arbitrary resource bars (default `HP`, `MP`, `Energia`), custom skills/attacks with arbitrary dice formulas (`1d20+3`, `3d6`, `2d10+5`, `1d100`), and full macro support — proving the VTT runs any RPG system seamlessly.

### 8.5 Zero-`eval` Sandboxed Macro & Formula Interpreter (`systems/sandbox.ts`)
To stay 100% compliant with `script-src 'self'` and prevent XSS/prototype-pollution:
- Custom tokenizer + recursive descent parser + bounded AST evaluator (`MAX_NODES = 500`, `MAX_STEPS = 200`).
- **Supported Syntax:**
  - Attribute/stat variables: `@forca`, `@agilidade`, `@inteligencia`, `@vontade`, `@nivel`, `@pv`, `@pm`, `@bloqueio`, `@esquiva`, `@target.bloqueio`
  - Arithmetic & conditionals: `+`, `-`, `*`, `/`, `%`, `min()`, `max()`, `floor()`, `ceil()`, `abs()`, `if(cond, a, b)`, comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`)
  - Built-in safe VTT commands (return structured `MacroCommand[]` executed by the UI/WS layer, never mutating DOM directly):
    - `roll("2d6 + @forca + 2", "Ataque Poderoso", { difficulty: 12 })`
    - `spend("pm", 10)`
    - `heal(15)` / `damage(12, "fogo")`
    - `condition("queimando", 3)`
    - `say("Pelo poder de Drakon!")` / `emote("ergue a espada em chamas.")`

---

## 9. Persistence Schema & Built-In Seed Campaign

### 9.1 PostgreSQL Schema (`mesa_*` tables)
Created automatically on startup via idempotent `CREATE TABLE IF NOT EXISTS` inside `server/internal/store/postgres.go` (using `mesa_*` prefixed tables to avoid collisions on shared Postgres databases):

- `mesa_campaigns (id TEXT PK, name TEXT, description TEXT, system_id TEXT, cover_url TEXT, invite_code TEXT UNIQUE, privacy TEXT, owner_user_id TEXT, active_scene_id TEXT, combat_json JSONB, settings_json JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`
- `mesa_members (campaign_id TEXT FK, user_id TEXT, display_name TEXT, avatar_url TEXT, role TEXT, active_character_id TEXT, joined_at TIMESTAMPTZ, PK(campaign_id, user_id))`
- `mesa_folders (id TEXT PK, campaign_id TEXT FK, parent_id TEXT, name TEXT, icon TEXT, sort_order INT, visibility TEXT, visible_to JSONB, created_by TEXT)`
- `mesa_documents (id TEXT PK, campaign_id TEXT FK, folder_id TEXT, kind TEXT, title TEXT, content TEXT, image_url TEXT, tags JSONB, visibility TEXT, visible_to JSONB, created_by TEXT, updated_at TIMESTAMPTZ)`
- `mesa_characters (id TEXT PK, campaign_id TEXT FK, system_id TEXT, kind TEXT, name TEXT, subtitle TEXT, portrait_url TEXT, owner_user_id TEXT, controlled_by JSONB, resources JSONB, conditions JSONB, system_data JSONB, computed JSONB, visibility TEXT, visible_to JSONB, updated_at TIMESTAMPTZ)`
- `mesa_scenes (id TEXT PK, campaign_id TEXT FK, name TEXT, image_url TEXT, width INT, height INT, grid_json JSONB, fog_json JSONB, tokens_json JSONB, visibility TEXT, visible_to JSONB, updated_at TIMESTAMPTZ)`
- `mesa_chat_messages (id TEXT PK, campaign_id TEXT FK, kind TEXT, sender_user_id TEXT, sender_name TEXT, character_id TEXT, character_name TEXT, portrait_url TEXT, content TEXT, roll_json JSONB, actions_json JSONB, visibility TEXT, visible_to JSONB, created_at TIMESTAMPTZ)` (indexed on `(campaign_id, created_at DESC)`)
- `mesa_macros (id TEXT PK, campaign_id TEXT FK, name TEXT, icon TEXT, color TEXT, scope TEXT, character_id TEXT, script TEXT, visibility TEXT, visible_to JSONB, created_by TEXT)`
- `mesa_voice_channels (id TEXT PK, campaign_id TEXT FK, name TEXT, is_default BOOL, locked_for_players BOOL)`

### 9.2 Zero-Config File Store Fallback (`filestore.go`)
When `DATABASE_URL` is unset, `FileStore` holds the full state in memory protected by `sync.RWMutex` and flushes atomically (`write temp + os.Rename`) to `MESA_DATA_FILE` (default `./.mesa-vtt-data.json`, falling back to `/tmp/mesa-vtt-data.json` if cwd is read-only).

### 9.3 Built-In Seed Campaign (`seed.go`)
Auto-seeded on first startup when `ListCampaigns()` is empty (all default asset paths match `client/public/assets/manifest.json` using relative `./assets/...` paths so they work seamlessly behind any base path or reverse proxy):
- **Campaign:** `"Crônicas de Drakon — A Estalagem do Javali Dourado"` | `inviteCode: "DRAKON"` | `systemId: "mighty-blade-3e"` | `privacy: "public"` | `coverUrl: "./assets/banner-mesa-rpg.svg"`
- **4 Built-In Battlemap Scenes:**
  1. *Estalagem do Javali Dourado* (`./assets/maps/tavern.svg`, active, 24×18 grid, hero & tavern tokens pre-placed, fog disabled)
  2. *Cripta dos Antigos* (`./assets/maps/dungeon-crypt.svg`, 24×18 grid, fog of war enabled with entrance revealed, Skeleton Warrior tokens placed — 1 on `gm` layer!)
  3. *Estrada da Floresta Sombria* (`./assets/maps/forest-road.svg`, 24×18 grid, Dire Wolf & Goblin Raider ambush tokens)
  4. *Pátio do Castelo de Drakon* (`./assets/maps/castle-courtyard.svg`, 24×18 grid, `gm_only` scene until revealed)
- **4 Pre-Built Mighty Blade 3e Heroes:**
  - *Aldric de Valmont* (Humano Guerreiro, `./assets/portraits/human-warrior.svg`)
  - *Lyra Estrela-da-Alva* (Elfa Maga, `./assets/portraits/elf-mage.svg`)
  - *Thrain Martelo-de-Ouro* (Anão Paladino, `./assets/portraits/dwarf-paladin.svg`)
  - *Pip Folha-Ligeira* (Faen Patrulheiro, `./assets/portraits/faen-ranger.svg`)
- **NPCs & Monsters:**
  - *Goblin Saqueador* (`./assets/monsters/goblin-raider.svg`)
  - *Esqueleto Guerreiro* (`./assets/monsters/skeleton-warrior.svg`)
  - *Lobo Atroz* (`./assets/monsters/dire-wolf.svg`)
- **Hierarchical Folders Demonstrating All 3 Permission Tiers:**
  - `Segredos do Mestre` (`gm_only`) — *"A Conspiração do Culto Carmesim"*, *"Armadilhas da Cripta (CD 12)"*
  - `Crônicas & Handouts` (`all_players`) — *"Quadro de Avisos do Javali Dourado"*, *"Guia Rápido: Mighty Blade 3ª Edição"*
  - `Bilhetes Privados` (`specific_players`) — *"Selo da Guilda dos Magos"*
- **Voice Channels:** `"Mesa Principal"` (default) + `"Sussurro do Mestre"` (`lockedForPlayers: false`, secondary private room).
- **Starter Macros & Chat:** 3 ready-to-click macros (`Ataque Rápido`, `Teste de Percepção`, `Descanso Curto`) and an atmospheric welcome narration + sample interactive roll card in chat.

---

## 10. Optional External SSO & Reverse Proxy Deployment

Mesa VTT works **100% standalone by default** (`AUTH_MODE=local`), allowing players to pick a name and avatar and jump straight into campaigns. For communities or portals that want single sign-on:

1. Configure `AUTH_MODE=sso`, `EXTERNAL_TICKET_URL`, and a 32+ byte `EXTERNAL_AUTH_TOKEN`.
2. Your portal issues a short-lived one-time launch ticket and redirects users to `https://your-vtt.example.org/?ticket=<oneTimeTicket>&room=<inviteCode|LOBBY>`.
3. Mesa VTT frontend posts `{ ticket, roomId, create }` to `POST /api/v1/auth/sso-ticket`.
4. The Go backend validates the ticket by calling `POST ${EXTERNAL_TICKET_URL}` with `Authorization: Bearer ${EXTERNAL_AUTH_TOKEN}` and expects HTTP `200` with JSON `{ "id", "display_name", "avatar_url"?, "room_id"?, "create"?, "is_admin"? }`.
5. **Reverse Proxy Headers for Mobile Voice & Security:**
   - Terminate TLS (HTTPS) in front of `:8094` — mobile browsers require a secure context (`https://` or `localhost`) for `navigator.mediaDevices.getUserMedia` (WebRTC microphone).
   - Proxy WebSocket upgrade headers (`Upgrade`, `Connection`) on `/ws`.
   - Set `Permissions-Policy: camera=(), microphone=(self), geolocation=()` and CSP `script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:`.

---

## 11. Build, Test & Run Commands

### 11.1 Local Development (Zero Config — FileStore + Seeded Demo Campaign)
```bash
# Terminal 1 — Go Authoritative Server (:8094, auto-seeds Crônicas de Drakon)
go run ./server/cmd/server

# Terminal 2 — React + Vite Client (:3104, proxies /api and /ws to :8094)
cd client
npm install
npm run dev
# Open http://localhost:3104 (desktop or mobile on LAN)
```

### 11.2 Verification & Single-Binary Production Build
```bash
# Run Go backend tests & static checks
go vet ./...
go test -race -count=1 ./...

# Run Multisystem Engine & Sandbox tests
bun test systems/systems.test.ts

# Typecheck & build frontend SPA
cd client && npm run build && cd ..

# Build static server + healthcheck binaries
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ./mesa-vtt ./server/cmd/server
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ./healthcheck ./server/cmd/healthcheck

# Run standalone single binary serving built SPA on :8094
STATIC_DIR=./client/dist LISTEN_ADDRESS=:8094 ./mesa-vtt
```

### 11.3 All-in-One Docker & Docker Compose
```bash
# Build and run all-in-one container (Node 22 + Go 1.26 -> distroless nonroot)
docker build -t mesa-vtt .
docker run -p 8094:8094 -v mesa_vtt_data:/data mesa-vtt

# Or run with Docker Compose (FileStore by default)
docker compose up -d

# Or run with optional PostgreSQL profile
DATABASE_URL=postgres://mesa:mesa@postgres:5432/mesa_vtt?sslmode=disable \
  docker compose --profile postgres up -d
```

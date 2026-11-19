/**
 * Mesa VTT — Shared Domain, Wire Protocol & Multisystem Script Engine Types.
 * Imported across `systems/**` and `client/**` via `@systems/types`.
 * All JSON wire fields match `docs/ARCHITECTURE.md` (camelCase).
 */

// ---------------------------------------------------------------------------
// 1. Identity, Roles & Visibility
// ---------------------------------------------------------------------------

export type MemberRole = "gm" | "player" | "observer";

export type Visibility = "gm_only" | "all_players" | "specific_players";

export interface VisibilityRule {
  visibility: Visibility;
  visibleToUserIds?: string[];
}

export type AuthMode = "local" | "sso";

export interface UserIdentity {
  id: string;
  displayName: string;
  avatarUrl?: string;
  source: "local" | "sso";
  isAdmin?: boolean;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface ServerPublicConfig {
  authMode: AuthMode;
  localAuthEnabled: boolean;
  iceServers: IceServerConfig[];
  systems: string[];
  aiImageEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// 2. Campaigns & Members
// ---------------------------------------------------------------------------

export interface CampaignSettings {
  allowPlayerDice3D: boolean;
  defaultVoiceChannelId: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  systemId: string;
  coverUrl: string;
  inviteCode: string;
  privacy: "public" | "invite_only";
  ownerUserId: string;
  activeSceneId: string | null;
  combat: CombatState;
  settings: CampaignSettings;
  memberCount?: number;
  voiceActiveCount?: number;
  gmName?: string;
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

// ---------------------------------------------------------------------------
// 3. Hierarchical Folders & Documents (Library / Handouts)
// ---------------------------------------------------------------------------

export type DocumentKind = "note" | "handout" | "lore" | "item" | "npc_bio";

export interface Folder extends VisibilityRule {
  id: string;
  campaignId: string;
  parentId: string | null;
  name: string;
  icon?: string;
  sortOrder: number;
  createdBy: string;
}

export interface Document extends VisibilityRule {
  id: string;
  campaignId: string;
  folderId: string | null;
  kind: DocumentKind;
  title: string;
  content: string;
  imageUrl?: string;
  tags?: string[];
  createdBy: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 4. Characters (System-Agnostic Core + Typed System Data)
// ---------------------------------------------------------------------------

export type CharacterKind = "pc" | "npc" | "monster";

export interface ResourceBar {
  current: number;
  max: number;
  temp?: number;
}

export interface ActiveCondition {
  id: string;
  name: string;
  icon: string;
  roundsRemaining?: number;
  notes?: string;
}

export interface Character extends VisibilityRule {
  id: string;
  campaignId: string;
  systemId: string;
  kind: CharacterKind;
  name: string;
  subtitle?: string;
  portraitUrl: string;
  ownerUserId: string | null;
  controlledByUserIds: string[];
  resources: Record<string, ResourceBar>;
  conditions: ActiveCondition[];
  systemData: Record<string, unknown>;
  computed: Record<string, unknown>;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 5. Tactical Scenes, Grid, Fog of War & Tokens
// ---------------------------------------------------------------------------

export type TokenLayer = "tokens" | "gm";

export interface SceneGrid {
  enabled: boolean;
  cols: number;
  rows: number;
  cellMeters: number;
  color: string;
  snap: boolean;
}

export interface SceneFog {
  enabled: boolean;
  /** Row-major bitstring ("0" = hidden, "1" = revealed) of length cols * rows */
  revealedCells: string;
}

export interface Token {
  id: string;
  characterId: string | null;
  name: string;
  imageUrl: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
  color: string;
  layer: TokenLayer;
  showBars: boolean;
  hp?: number;
  hpMax?: number;
  mp?: number;
  mpMax?: number;
  conditions: string[];
  controlledByUserIds: string[];
}

export interface Scene extends VisibilityRule {
  id: string;
  campaignId: string;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
  grid: SceneGrid;
  fog: SceneFog;
  tokens: Token[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 6. Combat Tracker
// ---------------------------------------------------------------------------

export interface Combatant {
  id: string;
  characterId: string | null;
  tokenId: string | null;
  name: string;
  portraitUrl: string;
  initiative: number;
  isNpc: boolean;
  hidden: boolean;
  acted: boolean;
}

export interface CombatState {
  active: boolean;
  round: number;
  turnIndex: number;
  combatants: Combatant[];
}

// ---------------------------------------------------------------------------
// 7. Rich Chat, Authoritative Dice Rolls & Interactive Actions
// ---------------------------------------------------------------------------

export type ChatMessageKind =
  | "ic"
  | "ooc"
  | "narration"
  | "whisper"
  | "roll"
  | "system"
  | "combat_action";

export interface RolledDie {
  sides: number;
  value: number;
  dropped?: boolean;
  exploded?: boolean;
}

export type InteractiveActionStyle =
  | "damage"
  | "heal"
  | "mana"
  | "condition"
  | "roll"
  | "neutral";

export type InteractiveActionType =
  | "apply_damage"
  | "apply_heal"
  | "spend_mana"
  | "apply_condition"
  | "roll_followup";

export interface InteractiveAction {
  id: string;
  label: string;
  style: InteractiveActionStyle;
  actionType: InteractiveActionType;
  targetCharacterId?: string;
  payload: Record<string, unknown>;
  executedBy?: string;
}

export interface RollOutcome {
  kind: "critical" | "fumble" | "success" | "failure" | "info";
  badgeText?: string;
  difficulty?: number;
  targetDefense?: number;
  targetName?: string;
  margin?: number;
}

export interface RollResult {
  rollId: string;
  formula: string;
  label: string;
  dice: RolledDie[];
  modifier: number;
  total: number;
  seed: number;
  outcome?: RollOutcome;
  systemMeta?: Record<string, unknown>;
}

export interface ChatMessage extends VisibilityRule {
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
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 8. Macros & Sandbox Execution
// ---------------------------------------------------------------------------

export interface Macro extends VisibilityRule {
  id: string;
  campaignId: string;
  name: string;
  icon: string;
  color: string;
  scope: "campaign" | "character";
  characterId?: string;
  script: string;
  createdBy: string;
}

export interface MacroContext {
  character?: Character;
  target?: Character;
  attrs?: Record<string, number>;
  computed?: Record<string, unknown>;
  resources?: Record<string, ResourceBar>;
  args?: Record<string, unknown>;
  user?: UserIdentity;
}

export type MacroCommand =
  | {
      type: "roll";
      formula: string;
      label: string;
      difficulty?: number;
      visibility?: Visibility;
      meta?: Record<string, unknown>;
    }
  | {
      type: "roll_attack";
      weaponId?: string;
      bonus?: number;
    }
  | {
      type: "roll_ability";
      abilityId: string;
    }
  | {
      type: "roll_spell";
      spellId: string;
    }
  | {
      type: "spend";
      resource: string;
      amount: number;
    }
  | {
      type: "heal";
      amount: number;
      target?: "self" | "target";
    }
  | {
      type: "damage";
      amount: number;
      damageType?: string;
      target?: "self" | "target";
    }
  | {
      type: "condition";
      conditionId: string;
      rounds?: number;
      target?: "self" | "target";
    }
  | {
      type: "chat";
      kind: "ic" | "ooc" | "narration";
      content: string;
    };

export interface MacroResult {
  ok: boolean;
  value: unknown;
  commands: MacroCommand[];
  error?: string;
  stepsUsed: number;
}

// ---------------------------------------------------------------------------
// 9. Discord-Style Integrated Voice Channels & WebRTC Signaling
// ---------------------------------------------------------------------------

export interface VoiceParticipant {
  userId: string;
  displayName: string;
  portraitUrl?: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
}

export interface VoiceChannel {
  id: string;
  campaignId: string;
  name: string;
  isDefault: boolean;
  lockedForPlayers?: boolean;
  participants: VoiceParticipant[];
}

export interface VoiceSignalPayload {
  fromUserId?: string;
  targetUserId?: string;
  kind: "offer" | "answer" | "ice";
  sdp?: RTCSessionDescriptionInit | Record<string, unknown>;
  candidate?: RTCIceCandidateInit | Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 10. Campaign Bootstrap & WebSocket Envelopes
// ---------------------------------------------------------------------------

export interface CampaignBootstrapState {
  campaign: Campaign;
  members: CampaignMember[];
  folders: Folder[];
  documents: Document[];
  characters: Character[];
  scenes: Scene[];
  activeSceneId: string | null;
  messages: ChatMessage[];
  macros: Macro[];
  voiceChannels: VoiceChannel[];
}

export interface WsEnvelope<T = unknown> {
  type: string;
  requestId?: string;
  payload: T;
}

export interface MapPingEvent {
  sceneId: string;
  x: number;
  y: number;
  color: string;
  userId: string;
  displayName: string;
}

export interface DiceResultEvent {
  roll: RollResult;
  senderUserId: string;
  senderName: string;
  characterName?: string;
  visibility: Visibility;
}

// ---------------------------------------------------------------------------
// 11. Multisystem Script Engine SDK Contracts
// ---------------------------------------------------------------------------

export interface SystemManifest {
  id: string;
  name: string;
  shortName?: string;
  version: string;
  author: string;
  description: string;
  language: string;
  diceDefaults: {
    coreFormula: string;
    quickDice: number[];
  };
  theme: {
    primary: string;
    accent: string;
    badge: string;
  };
  supportsWizard: boolean;
}

export interface SchemaAttributeDef {
  key: string;
  label: string;
  abbr: string;
  min: number;
  max: number;
  defaultValue: number;
  description?: string;
}

export interface SchemaResourceDef {
  key: string;
  label: string;
  abbr: string;
  color: string;
}

export interface SchemaDerivedStatDef {
  key: string;
  label: string;
  abbr?: string;
  formulaHint: string;
  unit?: string;
}

export interface SchemaSheetTabDef {
  id: string;
  label: string;
}

export interface SystemSchema {
  attributes: SchemaAttributeDef[];
  resources: SchemaResourceDef[];
  derivedStats: SchemaDerivedStatDef[];
  sheetTabs: SchemaSheetTabDef[];
  equipmentSlots?: string[];
}

export interface RollPlan {
  formula: string;
  label: string;
  difficulty?: number;
  targetCharacterId?: string;
  targetDefense?: number;
  targetName?: string;
  manaCost?: number;
  damageFormula?: string;
  damageType?: string;
  healFormula?: string;
  appliesCondition?: string;
  systemMeta: Record<string, unknown>;
}

export interface RollEvaluation {
  outcome: RollOutcome;
  actions: InteractiveAction[];
}

export interface CompendiumCategory {
  id: string;
  label: string;
  items: Record<string, unknown>[];
}

export interface RpgSystemEngine {
  manifest: SystemManifest;
  schema: SystemSchema;

  /** Recomputes derived stats & resource maximums from systemData + active conditions. */
  computeDerivedStats(character: Character): {
    computed: Record<string, unknown>;
    resourceMax: Record<string, number>;
  };

  /** Guided creation (e.g. MB 3e wizard) or blank template creation. */
  createCharacterFromWizard(
    input: Record<string, unknown>
  ): Omit<Character, "id" | "campaignId" | "updatedAt">;

  /** Builds authoritative RollPlans sent to Go server via WS `dice.roll`. */
  buildRollRequest(
    character: Character,
    request: {
      kind: "attribute" | "attack" | "ability" | "spell" | "initiative" | "custom";
      key?: string;
      itemId?: string;
      formula?: string;
      label?: string;
      bonus?: number;
      difficulty?: number;
      target?: Character;
    }
  ): RollPlan;

  planAttributeCheck(
    character: Character,
    attrKey: string,
    opts?: { bonus?: number; difficulty?: number; label?: string }
  ): RollPlan;
  planAttack(character: Character, weaponId: string, target?: Character): RollPlan;
  planAbility(character: Character, abilityId: string, target?: Character): RollPlan;
  planSpell(character: Character, spellId: string, target?: Character): RollPlan;
  planInitiative(character: Character): RollPlan;

  /** Evaluates authoritative server dice faces -> crit/fumble/success + 1-click chat action buttons. */
  resolveRollOutcome(roll: RollResult, actor?: Character, target?: Character): RollEvaluation;
  /** Alias matching ARCHITECTURE.md */
  evaluateRoll(roll: RollResult, actor?: Character, target?: Character): RollEvaluation;

  /** Pure state mutators returning partial Character patches ready for `character.patch`. */
  applyDamage(character: Character, amount: number, damageType?: string): Partial<Character>;
  applyHealing(character: Character, amount: number): Partial<Character>;
  spendMana(character: Character, amount: number): { patch?: Partial<Character>; error?: string };
  applyCondition(character: Character, conditionId: string, rounds?: number): Partial<Character>;
  removeCondition(character: Character, conditionId: string): Partial<Character>;
  levelUp(character: Character, choices: Record<string, unknown>): Partial<Character>;
  rest(character: Character, kind: "short" | "long"): Partial<Character>;
  shortRest(character: Character): Partial<Character>;
  longRest(character: Character): Partial<Character>;

  /** Compendium accessor for Library -> Compendium tab & Bestiary drop-on-map. */
  getCompendium(): Record<string, unknown[]>;
  getCompendiumCategories(): CompendiumCategory[];

  /** Converts a bestiary creature entry into a ready-to-spawn Character object. */
  createCharacterFromBestiary?(
    creatureId: string
  ): Omit<Character, "id" | "campaignId" | "updatedAt"> | null;
}

// ---------------------------------------------------------------------------
// 12. Mighty Blade 3e & Generic RPG Typed Sheet Data Helpers
// ---------------------------------------------------------------------------

export interface CharacterEquipmentEntry {
  id: string;
  itemId?: string;
  name: string;
  category: "weapon" | "armor" | "shield" | "gear" | "consumable" | "magic";
  equipped?: boolean;
  quantity: number;
  fn?: number;
  damageBonus?: number;
  damageAttribute?: "forca" | "agilidade" | "inteligencia" | "vontade";
  damageType?: string;
  defenseBonus?: number;
  agilityPenalty?: number;
  rd?: number;
  weight?: number;
  range?: string;
  properties?: string[];
  effect?: Record<string, unknown>;
  description?: string;
}

export interface CharacterAbilityEntry {
  id: string;
  abilityId?: string;
  name: string;
  category?: string;
  manaCost?: number;
  difficulty?: number;
  range?: string;
  duration?: string;
  description: string;
  automation?: Record<string, unknown>;
}

export interface CharacterSpellEntry {
  id: string;
  spellId?: string;
  name: string;
  path?: string;
  type?: string;
  manaCost: number;
  difficulty: number;
  range?: string;
  duration?: string;
  description: string;
  automation?: Record<string, unknown>;
}

export interface MightyBladeAttributes {
  forca: number;
  agilidade: number;
  inteligencia: number;
  vontade: number;
}

export interface MightyBladeSystemData {
  raceId: string;
  raceName: string;
  classId: string;
  className: string;
  level: number;
  xp: number;
  attributes: MightyBladeAttributes;
  pvBonus?: number;
  pmBonus?: number;
  defenseBonus?: number;
  movementModifier?: number;
  size?: string;
  money?: number;
  inventory: CharacterEquipmentEntry[];
  abilities: CharacterAbilityEntry[];
  spells: CharacterSpellEntry[];
  languages?: string[];
  background?: string;
  notes?: string;
}

export interface MightyBladeWizardInput {
  name: string;
  portraitUrl?: string;
  raceId: string;
  classId: string;
  /** Extra free points distributed at level 1 (e.g. +1 to chosen attributes) */
  freeAttributePoints?: Partial<MightyBladeAttributes>;
  selectedAbilityIds?: string[];
  selectedSpellIds?: string[];
  background?: string;
  ownerUserId?: string | null;
}

export interface GenericAttributeEntry {
  key: string;
  label: string;
  value: number;
}

export interface GenericActionEntry {
  id: string;
  name: string;
  formula: string;
  damageFormula?: string;
  resourceKey?: string;
  resourceCost?: number;
  difficulty?: number;
  description?: string;
}

export interface GenericRpgSystemData {
  level: number;
  archetype?: string;
  attributes: GenericAttributeEntry[];
  customBars?: Array<{ key: string; label: string; color: string; max: number }>;
  actions: GenericActionEntry[];
  inventory: CharacterEquipmentEntry[];
  notes?: string;
}

package model

import (
	"slices"
	"time"
)

type MemberRole string

const (
	RoleGM       MemberRole = "gm"
	RolePlayer   MemberRole = "player"
	RoleObserver MemberRole = "observer"
)

type Visibility string

const (
	VisibilityGMOnly          Visibility = "gm_only"
	VisibilityAllPlayers      Visibility = "all_players"
	VisibilitySpecificPlayers Visibility = "specific_players"
)

// NormalizeVisibility defaults unknown or empty visibility values to gm_only (fail-closed).
func NormalizeVisibility(v Visibility) Visibility {
	switch v {
	case VisibilityGMOnly, VisibilityAllPlayers, VisibilitySpecificPlayers:
		return v
	default:
		return VisibilityGMOnly
	}
}

// CanView is the authoritative server-side visibility check.
// GMs can see everything; non-GMs never see gm_only content and only see specific_players when listed.
func CanView(userID string, role MemberRole, vis Visibility, visibleTo []string) bool {
	if role == RoleGM {
		return true
	}
	switch vis {
	case VisibilityAllPlayers:
		return true
	case VisibilitySpecificPlayers:
		return userID != "" && slices.Contains(visibleTo, userID)
	default: // VisibilityGMOnly or unknown -> fail closed
		return false
	}
}

type UserIdentity struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	Source      string `json:"source"` // "local" | "sso"
	IsAdmin     bool   `json:"isAdmin,omitempty"`
}

type CampaignSettings struct {
	AllowPlayerDice3D     bool   `json:"allowPlayerDice3D"`
	DefaultVoiceChannelID string `json:"defaultVoiceChannelId"`
}

type Campaign struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	Description   string           `json:"description"`
	SystemID      string           `json:"systemId"`
	CoverURL      string           `json:"coverUrl"`
	InviteCode    string           `json:"inviteCode"`
	Privacy       string           `json:"privacy"` // "public" | "invite_only"
	OwnerUserID   string           `json:"ownerUserId"`
	ActiveSceneID *string          `json:"activeSceneId"`
	Combat        CombatState      `json:"combat"`
	Settings      CampaignSettings `json:"settings"`
	CreatedAt     time.Time        `json:"createdAt"`
	UpdatedAt     time.Time        `json:"updatedAt"`
}

// CampaignSummary is returned by GET /api/v1/campaigns for the Lobby view.
type CampaignSummary struct {
	Campaign
	GMName           string     `json:"gmName"`
	MemberCount      int        `json:"memberCount"`
	OnlineCount      int        `json:"onlineCount"`
	VoiceCount       int        `json:"voiceCount"`
	VoiceActiveCount int        `json:"voiceActiveCount"`
	MyRole           MemberRole `json:"myRole,omitempty"`
}

type CampaignMember struct {
	CampaignID        string     `json:"campaignId"`
	UserID            string     `json:"userId"`
	DisplayName       string     `json:"displayName"`
	AvatarURL         string     `json:"avatarUrl,omitempty"`
	Role              MemberRole `json:"role"`
	Online            bool       `json:"online"`
	ActiveCharacterID string     `json:"activeCharacterId,omitempty"`
	JoinedAt          time.Time  `json:"joinedAt"`
}

type DocumentKind string

const (
	DocKindNote    DocumentKind = "note"
	DocKindHandout DocumentKind = "handout"
	DocKindLore    DocumentKind = "lore"
	DocKindItem    DocumentKind = "item"
	DocKindNPCBio  DocumentKind = "npc_bio"
)

type Folder struct {
	ID               string     `json:"id"`
	CampaignID       string     `json:"campaignId"`
	ParentID         *string    `json:"parentId"`
	Name             string     `json:"name"`
	Icon             string     `json:"icon,omitempty"`
	SortOrder        int        `json:"sortOrder"`
	Visibility       Visibility `json:"visibility"`
	VisibleToUserIDs []string   `json:"visibleToUserIds,omitempty"`
	CreatedBy        string     `json:"createdBy"`
}

type Document struct {
	ID               string       `json:"id"`
	CampaignID       string       `json:"campaignId"`
	FolderID         *string      `json:"folderId"`
	Kind             DocumentKind `json:"kind"`
	Title            string       `json:"title"`
	Content          string       `json:"content"`
	ImageURL         string       `json:"imageUrl,omitempty"`
	Tags             []string     `json:"tags,omitempty"`
	Visibility       Visibility   `json:"visibility"`
	VisibleToUserIDs []string     `json:"visibleToUserIds,omitempty"`
	CreatedBy        string       `json:"createdBy"`
	UpdatedAt        time.Time    `json:"updatedAt"`
}

type CharacterKind string

const (
	CharKindPC      CharacterKind = "pc"
	CharKindNPC     CharacterKind = "npc"
	CharKindMonster CharacterKind = "monster"
)

type ResourceBar struct {
	Current int `json:"current"`
	Max     int `json:"max"`
	Temp    int `json:"temp,omitempty"`
}

type ActiveCondition struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Icon            string `json:"icon"`
	RoundsRemaining *int   `json:"roundsRemaining,omitempty"`
	Notes           string `json:"notes,omitempty"`
}

type Character struct {
	ID                  string                 `json:"id"`
	CampaignID          string                 `json:"campaignId"`
	SystemID            string                 `json:"systemId"`
	Kind                CharacterKind          `json:"kind"`
	Name                string                 `json:"name"`
	Subtitle            string                 `json:"subtitle,omitempty"`
	PortraitURL         string                 `json:"portraitUrl"`
	OwnerUserID         *string                `json:"ownerUserId"`
	ControlledByUserIDs []string               `json:"controlledByUserIds"`
	Resources           map[string]ResourceBar `json:"resources"`
	Conditions          []ActiveCondition      `json:"conditions"`
	SystemData          map[string]any         `json:"systemData"`
	Computed            map[string]any         `json:"computed"`
	Visibility          Visibility             `json:"visibility"`
	VisibleToUserIDs    []string               `json:"visibleToUserIds,omitempty"`
	UpdatedAt           time.Time              `json:"updatedAt"`
}

func (c Character) IsControlledBy(userID string, role MemberRole) bool {
	if role == RoleGM {
		return true
	}
	if userID == "" {
		return false
	}
	if c.OwnerUserID != nil && *c.OwnerUserID == userID {
		return true
	}
	return slices.Contains(c.ControlledByUserIDs, userID)
}

type SceneGrid struct {
	Enabled    bool    `json:"enabled"`
	Cols       int     `json:"cols"`
	Rows       int     `json:"rows"`
	CellMeters float64 `json:"cellMeters"`
	Color      string  `json:"color"`
	Snap       bool    `json:"snap"`
}

type SceneFog struct {
	Enabled       bool   `json:"enabled"`
	RevealedCells string `json:"revealedCells"`
}

type Token struct {
	ID                  string   `json:"id"`
	CharacterID         *string  `json:"characterId"`
	Name                string   `json:"name"`
	ImageURL            string   `json:"imageUrl"`
	X                   float64  `json:"x"`
	Y                   float64  `json:"y"`
	Size                float64  `json:"size"`
	Rotation            float64  `json:"rotation"`
	Color               string   `json:"color"`
	Layer               string   `json:"layer"` // "tokens" | "gm"
	ShowBars            bool     `json:"showBars"`
	HP                  *int     `json:"hp,omitempty"`
	HPMax               *int     `json:"hpMax,omitempty"`
	MP                  *int     `json:"mp,omitempty"`
	MPMax               *int     `json:"mpMax,omitempty"`
	Conditions          []string `json:"conditions"`
	ControlledByUserIDs []string `json:"controlledByUserIds"`
}

type Scene struct {
	ID               string     `json:"id"`
	CampaignID       string     `json:"campaignId"`
	Name             string     `json:"name"`
	ImageURL         string     `json:"imageUrl"`
	Width            int        `json:"width"`
	Height           int        `json:"height"`
	Grid             SceneGrid  `json:"grid"`
	Fog              SceneFog   `json:"fog"`
	Tokens           []Token    `json:"tokens"`
	Visibility       Visibility `json:"visibility"`
	VisibleToUserIDs []string   `json:"visibleToUserIds,omitempty"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type Combatant struct {
	ID          string  `json:"id"`
	CharacterID *string `json:"characterId"`
	TokenID     *string `json:"tokenId"`
	Name        string  `json:"name"`
	PortraitURL string  `json:"portraitUrl"`
	Initiative  int     `json:"initiative"`
	IsNPC       bool    `json:"isNpc"`
	Hidden      bool    `json:"hidden"`
	Acted       bool    `json:"acted"`
}

type CombatState struct {
	Active     bool        `json:"active"`
	Round      int         `json:"round"`
	TurnIndex  int         `json:"turnIndex"`
	Combatants []Combatant `json:"combatants"`
}

type ChatMessageKind string

const (
	ChatKindIC           ChatMessageKind = "ic"
	ChatKindOOC          ChatMessageKind = "ooc"
	ChatKindNarration    ChatMessageKind = "narration"
	ChatKindWhisper      ChatMessageKind = "whisper"
	ChatKindRoll         ChatMessageKind = "roll"
	ChatKindSystem       ChatMessageKind = "system"
	ChatKindCombatAction ChatMessageKind = "combat_action"
)

type RolledDie struct {
	Sides    int  `json:"sides"`
	Value    int  `json:"value"`
	Dropped  bool `json:"dropped,omitempty"`
	Exploded bool `json:"exploded,omitempty"`
}

type InteractiveAction struct {
	ID                string         `json:"id"`
	Label             string         `json:"label"`
	Style             string         `json:"style"`      // "damage" | "heal" | "mana" | "condition" | "roll" | "neutral"
	ActionType        string         `json:"actionType"` // "apply_damage" | "apply_heal" | "spend_mana" | "spend_karma" | "spend_resource" | "apply_condition" | "roll_followup"
	TargetCharacterID string         `json:"targetCharacterId,omitempty"`
	Payload           map[string]any `json:"payload"`
	ExecutedBy        string         `json:"executedBy,omitempty"`
}

type TagmarResistanceRequest struct {
	Kind string `json:"kind"` // "rf" | "rm"
	FA   int    `json:"fa"`
	FD   int    `json:"fd"`
}

type TagmarResistanceResult struct {
	Kind     string `json:"kind"` // "rf" | "rm"
	FA       int    `json:"fa"`
	FD       int    `json:"fd"`
	Target   int    `json:"target"`
	Resisted bool   `json:"resisted"`
}

type RollOutcome struct {
	Kind          string `json:"kind"` // "critical" | "fumble" | "success" | "failure" | "info"
	BadgeText     string `json:"badgeText,omitempty"`
	Difficulty    *int   `json:"difficulty,omitempty"`
	TargetDefense *int   `json:"targetDefense,omitempty"`
	TargetName    string `json:"targetName,omitempty"`
	Margin        *int   `json:"margin,omitempty"`
}

type RollResult struct {
	RollID           string                  `json:"rollId"`
	Formula          string                  `json:"formula"`
	Label            string                  `json:"label"`
	Dice             []RolledDie             `json:"dice"`
	Modifier         int                     `json:"modifier"`
	Total            int                     `json:"total"`
	Seed             uint32                  `json:"seed"`
	Outcome          *RollOutcome            `json:"outcome,omitempty"`
	SystemMeta       map[string]any          `json:"systemMeta,omitempty"`
	TagmarColumn     *int                    `json:"tagmarColumn,omitempty"`
	TagmarColor      string                  `json:"tagmarColor,omitempty"`
	TagmarDamageTier int                     `json:"tagmarDamageTier,omitempty"`
	TagmarResistance *TagmarResistanceResult `json:"tagmarResistance,omitempty"`
	TagmarDirectToEf bool                    `json:"tagmarDirectToEf,omitempty"`
}

type ChatMessage struct {
	ID               string              `json:"id"`
	CampaignID       string              `json:"campaignId"`
	Kind             ChatMessageKind     `json:"kind"`
	SenderUserID     string              `json:"senderUserId"`
	SenderName       string              `json:"senderName"`
	CharacterID      string              `json:"characterId,omitempty"`
	CharacterName    string              `json:"characterName,omitempty"`
	PortraitURL      string              `json:"portraitUrl,omitempty"`
	Content          string              `json:"content"`
	Roll             *RollResult         `json:"roll,omitempty"`
	Actions          []InteractiveAction `json:"actions,omitempty"`
	Visibility       Visibility          `json:"visibility"`
	VisibleToUserIDs []string            `json:"visibleToUserIds,omitempty"`
	CreatedAt        time.Time           `json:"createdAt"`
}

type Macro struct {
	ID               string     `json:"id"`
	CampaignID       string     `json:"campaignId"`
	Name             string     `json:"name"`
	Icon             string     `json:"icon"`
	Color            string     `json:"color"`
	Scope            string     `json:"scope"` // "campaign" | "character"
	CharacterID      string     `json:"characterId,omitempty"`
	Script           string     `json:"script"`
	Visibility       Visibility `json:"visibility"`
	VisibleToUserIDs []string   `json:"visibleToUserIds,omitempty"`
	CreatedBy        string     `json:"createdBy"`
}

type VoiceParticipant struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	PortraitURL string `json:"portraitUrl,omitempty"`
	Muted       bool   `json:"muted"`
	Deafened    bool   `json:"deafened"`
	Speaking    bool   `json:"speaking"`
}

type VoiceChannel struct {
	ID               string             `json:"id"`
	CampaignID       string             `json:"campaignId"`
	Name             string             `json:"name"`
	IsDefault        bool               `json:"isDefault"`
	LockedForPlayers bool               `json:"lockedForPlayers,omitempty"`
	Participants     []VoiceParticipant `json:"participants"`
}

// CampaignState is the full visibility-filtered snapshot returned by REST bootstrap and WS welcome.
type CampaignState struct {
	Campaign      Campaign         `json:"campaign"`
	Members       []CampaignMember `json:"members"`
	Folders       []Folder         `json:"folders"`
	Documents     []Document       `json:"documents"`
	Characters    []Character      `json:"characters"`
	Scenes        []Scene          `json:"scenes"`
	ActiveSceneID *string          `json:"activeSceneId"`
	Messages      []ChatMessage    `json:"messages"`
	Macros        []Macro          `json:"macros"`
	VoiceChannels []VoiceChannel   `json:"voiceChannels"`
}

// CanViewMessage enforces strict chat/roll/whisper visibility.
// Note:
// - GMs see all messages (including secret rolls and whispers).
// - For gm_only messages, ONLY GMs can view them (even if senderUserId were somehow non-GM, unless it's a player's own secret roll to GM).
//   Wait: if a player makes a whisper to GM or secret roll to GM, they are the sender and should see their own whisper/roll if VisibilitySpecificPlayers includes them;
//   for strictly gm_only messages authored by GM (GM secret rolls/notes), non-GM players MUST NEVER see them!
//   If a non-GM player sends a whisper to GM with VisibilitySpecificPlayers (visibleTo=[sender]) or VisibilityGMOnly where SenderUserID==userID:
//   Wait: to make gm_only 100% airtight (invariant #1: non-GMs NEVER receive gm_only), player-to-GM whispers should use VisibilitySpecificPlayers with [senderUserId],
//   so CanView(userID, role, msg.Visibility, msg.VisibleToUserIDs) is strictly respected with zero leaks!
func CanViewMessage(userID string, role MemberRole, msg ChatMessage) bool {
	if role == RoleGM {
		return true
	}
	if msg.Visibility == VisibilityGMOnly {
		return false
	}
	if msg.Kind == ChatKindWhisper || msg.Visibility == VisibilitySpecificPlayers {
		if userID != "" && msg.SenderUserID == userID {
			return true
		}
		return CanView(userID, role, msg.Visibility, msg.VisibleToUserIDs)
	}
	return CanView(userID, role, msg.Visibility, msg.VisibleToUserIDs)
}

// SanitizeTokenForUser returns whether the user may see the token.
func CanViewToken(role MemberRole, token Token) bool {
	if role == RoleGM {
		return true
	}
	return token.Layer != "gm"
}

// SanitizeSceneForUser strips GM-layer tokens for non-GMs and checks scene visibility.
func SanitizeSceneForUser(scene Scene, userID string, role MemberRole) (Scene, bool) {
	if !CanView(userID, role, scene.Visibility, scene.VisibleToUserIDs) {
		return Scene{}, false
	}
	out := scene
	tokens := make([]Token, 0, len(scene.Tokens))
	for _, t := range scene.Tokens {
		if !CanViewToken(role, t) {
			continue
		}
		if t.Conditions == nil {
			t.Conditions = []string{}
		}
		if t.ControlledByUserIDs == nil {
			t.ControlledByUserIDs = []string{}
		}
		tokens = append(tokens, t)
	}
	out.Tokens = tokens
	return out, true
}

// SanitizeCombatForUser strips hidden combatants for non-GM players and recalculates turnIndex safely.
func SanitizeCombatForUser(combat CombatState, role MemberRole) CombatState {
	if combat.Combatants == nil {
		combat.Combatants = []Combatant{}
	}
	if role == RoleGM {
		cp := combat
		cp.Combatants = append([]Combatant{}, combat.Combatants...)
		return cp
	}
	filtered := make([]Combatant, 0, len(combat.Combatants))
	newTurnIndex := 0
	for i, c := range combat.Combatants {
		if c.Hidden {
			continue
		}
		if i <= combat.TurnIndex {
			newTurnIndex = len(filtered)
		}
		filtered = append(filtered, c)
	}
	if len(filtered) == 0 {
		newTurnIndex = 0
	} else if newTurnIndex >= len(filtered) {
		newTurnIndex = len(filtered) - 1
	}
	return CombatState{
		Active:     combat.Active,
		Round:      combat.Round,
		TurnIndex:  newTurnIndex,
		Combatants: filtered,
	}
}

// SanitizeFoldersForUser filters folders by visibility, also hiding descendants of hidden ancestor folders.
func SanitizeFoldersForUser(folders []Folder, userID string, role MemberRole) ([]Folder, map[string]bool) {
	if role == RoleGM {
		out := make([]Folder, len(folders))
		copy(out, folders)
		vis := make(map[string]bool, len(out))
		for _, f := range out {
			vis[f.ID] = true
		}
		return out, vis
	}

	byID := make(map[string]Folder, len(folders))
	for _, f := range folders {
		byID[f.ID] = f
	}

	memo := make(map[string]bool, len(folders))
	var check func(id string, depth int) bool
	check = func(id string, depth int) bool {
		if v, ok := memo[id]; ok {
			return v
		}
		if depth > 32 {
			return false
		}
		f, ok := byID[id]
		if !ok {
			return false
		}
		if !CanView(userID, role, f.Visibility, f.VisibleToUserIDs) {
			memo[id] = false
			return false
		}
		if f.ParentID != nil && *f.ParentID != "" {
			if !check(*f.ParentID, depth+1) {
				memo[id] = false
				return false
			}
		}
		memo[id] = true
		return true
	}

	out := make([]Folder, 0, len(folders))
	visibleIDs := make(map[string]bool, len(folders))
	for _, f := range folders {
		if check(f.ID, 0) {
			out = append(out, f)
			visibleIDs[f.ID] = true
		}
	}
	return out, visibleIDs
}

// SanitizeDocumentsForUser filters documents by visibility AND hides documents inside hidden folders.
func SanitizeDocumentsForUser(docs []Document, visibleFolderIDs map[string]bool, userID string, role MemberRole) []Document {
	out := make([]Document, 0, len(docs))
	for _, d := range docs {
		if role != RoleGM {
			if !CanView(userID, role, d.Visibility, d.VisibleToUserIDs) {
				continue
			}
			if d.FolderID != nil && *d.FolderID != "" && !visibleFolderIDs[*d.FolderID] {
				continue
			}
		}
		out = append(out, d)
	}
	return out
}

// SanitizeCharactersForUser filters characters by visibility (controllers always see characters they control).
func SanitizeCharactersForUser(chars []Character, userID string, role MemberRole) []Character {
	out := make([]Character, 0, len(chars))
	for _, c := range chars {
		if role != RoleGM && !c.IsControlledBy(userID, role) && !CanView(userID, role, c.Visibility, c.VisibleToUserIDs) {
			continue
		}
		if c.Conditions == nil {
			c.Conditions = []ActiveCondition{}
		}
		if c.ControlledByUserIDs == nil {
			c.ControlledByUserIDs = []string{}
		}
		if c.Resources == nil {
			c.Resources = map[string]ResourceBar{}
		}
		if c.SystemData == nil {
			c.SystemData = map[string]any{}
		}
		if c.Computed == nil {
			c.Computed = map[string]any{}
		}
		out = append(out, c)
	}
	return out
}

// SanitizeMessagesForUser strips GM-only messages, secret rolls, and whispers not addressed to the user.
func SanitizeMessagesForUser(msgs []ChatMessage, userID string, role MemberRole) []ChatMessage {
	out := make([]ChatMessage, 0, len(msgs))
	for _, m := range msgs {
		if CanViewMessage(userID, role, m) {
			out = append(out, m)
		}
	}
	return out
}

// SanitizeMacrosForUser filters macros by visibility.
func SanitizeMacrosForUser(macros []Macro, userID string, role MemberRole) []Macro {
	out := make([]Macro, 0, len(macros))
	for _, m := range macros {
		if role == RoleGM || m.CreatedBy == userID || CanView(userID, role, m.Visibility, m.VisibleToUserIDs) {
			out = append(out, m)
		}
	}
	return out
}

// SanitizeCampaignState enforces wire-level visibility security across the entire campaign snapshot.
func SanitizeCampaignState(state CampaignState, userID string, role MemberRole) CampaignState {
	out := state
	out.Campaign.Combat = SanitizeCombatForUser(state.Campaign.Combat, role)

	if out.Members == nil {
		out.Members = []CampaignMember{}
	}

	folders, visibleFolders := SanitizeFoldersForUser(state.Folders, userID, role)
	out.Folders = folders
	out.Documents = SanitizeDocumentsForUser(state.Documents, visibleFolders, userID, role)
	out.Characters = SanitizeCharactersForUser(state.Characters, userID, role)
	visibleCharIDs := make(map[string]bool, len(out.Characters))
	for _, ch := range out.Characters {
		visibleCharIDs[ch.ID] = true
	}
	out.Messages = SanitizeMessagesForUser(state.Messages, userID, role)
	out.Macros = SanitizeMacrosForUser(state.Macros, userID, role)

	scenes := make([]Scene, 0, len(state.Scenes))
	visibleSceneIDs := make(map[string]bool, len(state.Scenes))
	for _, s := range state.Scenes {
		if sanitized, ok := SanitizeSceneForUser(s, userID, role); ok {
			if role != RoleGM {
				for i := range sanitized.Tokens {
					if sanitized.Tokens[i].CharacterID != nil && !visibleCharIDs[*sanitized.Tokens[i].CharacterID] {
						sanitized.Tokens[i].CharacterID = nil
					}
				}
			}
			scenes = append(scenes, sanitized)
			visibleSceneIDs[sanitized.ID] = true
		}
	}
	out.Scenes = scenes

	// Never expose an activeSceneId that belongs to a hidden GM-only scene.
	if out.ActiveSceneID != nil && !visibleSceneIDs[*out.ActiveSceneID] {
		if len(scenes) > 0 {
			fallback := scenes[0].ID
			out.ActiveSceneID = &fallback
			out.Campaign.ActiveSceneID = &fallback
		} else {
			out.ActiveSceneID = nil
			out.Campaign.ActiveSceneID = nil
		}
	} else {
		out.Campaign.ActiveSceneID = out.ActiveSceneID
	}

	channels := make([]VoiceChannel, 0, len(state.VoiceChannels))
	for _, ch := range state.VoiceChannels {
		if ch.Participants == nil {
			ch.Participants = []VoiceParticipant{}
		}
		channels = append(channels, ch)
	}
	out.VoiceChannels = channels

	return out
}

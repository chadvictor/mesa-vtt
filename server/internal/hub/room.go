package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/dice"
	"github.com/chadvictor/mesa-vtt/server/internal/model"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

type eventKind int

const (
	evJoin eventKind = iota
	evLeave
	evMessage
	evCustom
)

type roomEvent struct {
	kind   eventKind
	client *Client
	env    WsEnvelope
	fn     func(r *Room)
}

// Room is a single-goroutine actor owning all real-time state & broadcasts for one campaign.
type Room struct {
	campaignID string
	store      store.Store
	hub        *Hub

	clients map[string]*Client // clientID -> Client
	events  chan roomEvent
	done    chan struct{}
	once    sync.Once

	// Live voice membership owned by actor goroutine (mirrored safely under snapMu for REST reads)
	voice map[string]*voicePeer // userID -> voicePeer

	snapMu      sync.RWMutex
	onlineUsers map[string]bool
	voiceSnap   map[string][]model.VoiceParticipant // channelID -> participants
}

func newRoom(campaignID string, st store.Store, h *Hub) *Room {
	return &Room{
		campaignID:  campaignID,
		store:       st,
		hub:         h,
		clients:     make(map[string]*Client),
		events:      make(chan roomEvent, 512),
		done:        make(chan struct{}),
		voice:       make(map[string]*voicePeer),
		onlineUsers: make(map[string]bool),
		voiceSnap:   make(map[string][]model.VoiceParticipant),
	}
}

func (r *Room) stop() {
	r.once.Do(func() { close(r.done) })
}

func (r *Room) enqueue(ev roomEvent) bool {
	select {
	case r.events <- ev:
		return true
	case <-r.done:
		return false
	case <-time.After(3 * time.Second):
		return false
	}
}

func (r *Room) run() {
	for {
		select {
		case ev := <-r.events:
			switch ev.kind {
			case evJoin:
				r.onJoin(ev.client)
			case evLeave:
				r.onLeave(ev.client)
			case evMessage:
				r.onMessage(ev.client, ev.env)
			case evCustom:
				if ev.fn != nil {
					ev.fn(r)
				}
			}
		case <-r.done:
			for _, c := range r.clients {
				c.close()
			}
			return
		}
	}
}

func (r *Room) refreshSnapshot() {
	online := make(map[string]bool)
	for _, c := range r.clients {
		online[c.userID] = true
	}
	vSnap := make(map[string][]model.VoiceParticipant)
	for _, p := range r.voice {
		vSnap[p.channelID] = append(vSnap[p.channelID], p.toModel())
	}
	for chID := range vSnap {
		sort.Slice(vSnap[chID], func(i, j int) bool {
			return vSnap[chID][i].DisplayName < vSnap[chID][j].DisplayName
		})
	}
	r.snapMu.Lock()
	r.onlineUsers = online
	r.voiceSnap = vSnap
	r.snapMu.Unlock()
}

func (r *Room) snapshotOnlineUsers() map[string]bool {
	r.snapMu.RLock()
	defer r.snapMu.RUnlock()
	out := make(map[string]bool, len(r.onlineUsers))
	for k, v := range r.onlineUsers {
		out[k] = v
	}
	return out
}

func (r *Room) snapshotCounts() (int, int) {
	r.snapMu.RLock()
	defer r.snapMu.RUnlock()
	voiceCount := 0
	for _, list := range r.voiceSnap {
		voiceCount += len(list)
	}
	return len(r.onlineUsers), voiceCount
}

func (r *Room) attachVoiceParticipants(channels []model.VoiceChannel) []model.VoiceChannel {
	r.snapMu.RLock()
	defer r.snapMu.RUnlock()
	out := make([]model.VoiceChannel, len(channels))
	for i, ch := range channels {
		cp := ch
		if list, ok := r.voiceSnap[ch.ID]; ok {
			cp.Participants = append([]model.VoiceParticipant{}, list...)
		} else {
			cp.Participants = []model.VoiceParticipant{}
		}
		out[i] = cp
	}
	return out
}

func (r *Room) sendTo(c *Client, msg OutEnvelope) {
	select {
	case c.send <- msg:
	default:
	}
}

func (r *Room) sendError(c *Client, reqID, code, message string) {
	r.sendTo(c, OutEnvelope{
		Type:      "error",
		RequestID: reqID,
		Payload: map[string]any{
			"requestId": reqID,
			"code":      code,
			"message":   message,
		},
	})
}

func (r *Room) broadcastAll(msg OutEnvelope) {
	for _, c := range r.clients {
		r.sendTo(c, msg)
	}
}

func (r *Room) onJoin(c *Client) {
	r.clients[c.id] = c
	r.refreshSnapshot()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	state, err := r.hub.BuildCampaignState(ctx, r.campaignID, c.userID, c.role)
	if err != nil {
		r.sendError(c, "", "state_load_failed", "Failed to load campaign state")
		c.close()
		return
	}

	r.sendTo(c, OutEnvelope{
		Type: "welcome",
		Payload: map[string]any{
			"userId":        c.userID,
			"role":          c.role,
			"serverTime":    time.Now().UTC().UnixMilli(),
			"campaignState": state,
		},
	})

	r.broadcastPresence()
}

func (r *Room) onLeave(c *Client) {
	if _, ok := r.clients[c.id]; !ok {
		return
	}
	delete(r.clients, c.id)

	// If this specific client owned the user's active voice connection, remove them from voice.
	voiceChanged := false
	if vp, ok := r.voice[c.userID]; ok && vp.clientID == c.id {
		delete(r.voice, c.userID)
		voiceChanged = true
	}

	r.refreshSnapshot()
	r.broadcastPresence()
	if voiceChanged {
		r.broadcastVoiceState()
	}
}

func (r *Room) onMessage(c *Client, env WsEnvelope) {
	switch env.Type {
	case "ping":
		var in struct {
			ClientTime int64 `json:"clientTime"`
		}
		_ = json.Unmarshal(env.Payload, &in)
		r.sendTo(c, OutEnvelope{
			Type:      "pong",
			RequestID: env.RequestID,
			Payload: map[string]any{
				"clientTime": in.ClientTime,
				"serverTime": time.Now().UTC().UnixMilli(),
			},
		})
	case "chat.send":
		r.handleChatSend(c, env)
	case "dice.roll":
		r.handleDiceRoll(c, env)
	case "chat.action":
		r.handleChatAction(c, env)
	case "character.patch":
		r.handleCharacterPatch(c, env)
	case "scene.activate":
		r.handleSceneActivate(c, env)
	case "token.create":
		r.handleTokenCreate(c, env)
	case "token.move":
		r.handleTokenMove(c, env)
	case "token.update":
		r.handleTokenUpdate(c, env)
	case "token.delete":
		r.handleTokenDelete(c, env)
	case "fog.update":
		r.handleFogUpdate(c, env)
	case "map.ping":
		r.handleMapPing(c, env)
	case "combat.update":
		r.handleCombatUpdate(c, env)
	case "folder.upsert":
		r.handleFolderUpsert(c, env)
	case "folder.delete":
		r.handleFolderDelete(c, env)
	case "document.upsert":
		r.handleDocumentUpsert(c, env)
	case "document.delete":
		r.handleDocumentDelete(c, env)
	case "macro.upsert":
		r.handleMacroUpsert(c, env)
	case "macro.delete":
		r.handleMacroDelete(c, env)
	case "voice.join", "voice_join":
		r.handleVoiceJoin(c, env)
	case "voice.leave", "voice_leave":
		r.handleVoiceLeave(c, env)
	case "voice.status", "voice_status":
		r.handleVoiceStatus(c, env)
	case "voice.signal", "voice_signal":
		r.handleVoiceSignal(c, env)
	default:
		r.sendError(c, env.RequestID, "unknown_event", "Unsupported event type: "+env.Type)
	}
}

func (r *Room) broadcastPresence() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	members, err := r.store.ListMembers(ctx, r.campaignID)
	if err != nil {
		return
	}
	online := r.snapshotOnlineUsers()
	for i := range members {
		members[i].Online = online[members[i].UserID]
	}
	r.broadcastAll(OutEnvelope{
		Type:    "presence.updated",
		Payload: map[string]any{"members": members},
	})
}

func (r *Room) broadcastChatMessage(msg model.ChatMessage) {
	env := OutEnvelope{
		Type:    "chat.message",
		Payload: map[string]any{"message": msg},
	}
	for _, c := range r.clients {
		if model.CanViewMessage(c.userID, c.role, msg) {
			r.sendTo(c, env)
		}
	}
}

func (r *Room) handleChatSend(c *Client, env WsEnvelope) {
	var in struct {
		Kind             model.ChatMessageKind `json:"kind"`
		Content          string                `json:"content"`
		CharacterID      string                `json:"characterId"`
		Visibility       model.Visibility      `json:"visibility"`
		VisibleToUserIDs []string              `json:"visibleToUserIds"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid chat payload")
		return
	}
	content := strings.TrimSpace(in.Content)
	if content == "" || len(content) > 4000 {
		r.sendError(c, env.RequestID, "invalid_content", "Message must be 1..4000 characters")
		return
	}

	kind := in.Kind
	if kind == "" {
		kind = model.ChatKindOOC
	}
	if kind == model.ChatKindNarration && c.role != model.RoleGM {
		r.sendError(c, env.RequestID, "forbidden", "Only the GM can send narration messages")
		return
	}

	vis := in.Visibility
	visTo := in.VisibleToUserIDs
	if kind == model.ChatKindWhisper {
		if vis == "" || vis == model.VisibilityAllPlayers {
			vis = model.VisibilitySpecificPlayers
		}
		if c.role != model.RoleGM && vis == model.VisibilityGMOnly {
			// A player whispering exclusively to the GM: mark specific_players containing the sender
			// so GM sees it (role == gm) AND sender sees their own whisper, while other players NEVER see it.
			vis = model.VisibilitySpecificPlayers
			visTo = []string{c.userID}
		} else if vis == model.VisibilitySpecificPlayers && !slices.Contains(visTo, c.userID) {
			visTo = append(visTo, c.userID)
		}
	} else {
		if vis == "" {
			vis = model.VisibilityAllPlayers
		}
		vis = model.NormalizeVisibility(vis)
		if c.role != model.RoleGM && vis == model.VisibilityGMOnly {
			vis = model.VisibilitySpecificPlayers
			visTo = []string{c.userID}
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	charName := ""
	portraitURL := c.avatarURL
	if in.CharacterID != "" {
		if ch, err := r.store.GetCharacter(ctx, r.campaignID, in.CharacterID); err == nil {
			if ch.IsControlledBy(c.userID, c.role) {
				charName = ch.Name
				if ch.PortraitURL != "" {
					portraitURL = ch.PortraitURL
				}
			}
		}
	}

	msg := model.ChatMessage{
		ID:               newID("msg"),
		CampaignID:       r.campaignID,
		Kind:             kind,
		SenderUserID:     c.userID,
		SenderName:       c.displayName,
		CharacterID:      in.CharacterID,
		CharacterName:    charName,
		PortraitURL:      portraitURL,
		Content:          content,
		Visibility:       vis,
		VisibleToUserIDs: visTo,
		CreatedAt:        time.Now().UTC(),
	}

	if err := r.store.CreateMessage(ctx, msg); err != nil {
		r.sendError(c, env.RequestID, "store_error", "Failed to save chat message")
		return
	}
	r.broadcastChatMessage(msg)
}

func (r *Room) handleDiceRoll(c *Client, env WsEnvelope) {
	var in struct {
		SystemID          string                         `json:"systemId"`
		Formula           string                         `json:"formula"`
		Label             string                         `json:"label"`
		CharacterID       string                         `json:"characterId"`
		Visibility        model.Visibility               `json:"visibility"`
		VisibleToUserIDs  []string                       `json:"visibleToUserIds"`
		Difficulty        *int                           `json:"difficulty"`
		TargetCharacterID string                         `json:"targetCharacterId"`
		TargetDefense     *int                           `json:"targetDefense"`
		SystemMeta        map[string]any                 `json:"systemMeta"`
		TagmarColumn      *int                           `json:"tagmarColumn"`
		TagmarResistance  *model.TagmarResistanceRequest `json:"tagmarResistance"`
		Actions           []model.InteractiveAction      `json:"actions"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid dice roll payload")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	systemID := strings.TrimSpace(in.SystemID)
	if systemID == "" {
		if camp, err := r.store.GetCampaign(ctx, r.campaignID); err == nil {
			systemID = camp.SystemID
		}
	}

	targetName := ""
	targetDef := in.TargetDefense
	if in.TargetCharacterID != "" {
		if tc, err := r.store.GetCharacter(ctx, r.campaignID, in.TargetCharacterID); err == nil {
			targetName = tc.Name
			if targetDef == nil && !dice.IsTagmarSystem(systemID) {
				if defVal, ok := readIntField(tc.Computed, "defesa", "bloqueio", "esquiva"); ok && defVal > 0 {
					targetDef = &defVal
				}
			}
		}
	}

	rollRes, err := dice.Roll(in.Formula, dice.Options{
		SystemID:         systemID,
		Label:            in.Label,
		Difficulty:       in.Difficulty,
		TargetDefense:    targetDef,
		TargetName:       targetName,
		SystemMeta:       in.SystemMeta,
		TagmarColumn:     in.TagmarColumn,
		TagmarResistance: in.TagmarResistance,
	})
	if err != nil {
		r.sendError(c, env.RequestID, "invalid_formula", err.Error())
		return
	}

	vis := in.Visibility
	visTo := in.VisibleToUserIDs
	if vis == "" {
		vis = model.VisibilityAllPlayers
	}
	vis = model.NormalizeVisibility(vis)
	if c.role != model.RoleGM && vis == model.VisibilityGMOnly {
		// Player's secret roll to GM: GM and roller can see it, other players cannot.
		vis = model.VisibilitySpecificPlayers
		visTo = []string{c.userID}
	}

	charName := ""
	portraitURL := c.avatarURL
	if in.CharacterID != "" {
		if ch, err := r.store.GetCharacter(ctx, r.campaignID, in.CharacterID); err == nil {
			if ch.IsControlledBy(c.userID, c.role) {
				charName = ch.Name
				if ch.PortraitURL != "" {
					portraitURL = ch.PortraitURL
				}
			}
		}
	}

	// Ensure every interactive action has a unique ID
	actions := make([]model.InteractiveAction, 0, len(in.Actions))
	for _, a := range in.Actions {
		if a.ID == "" {
			a.ID = newID("act")
		}
		if a.Payload == nil {
			a.Payload = map[string]any{}
		}
		actions = append(actions, a)
	}

	msg := model.ChatMessage{
		ID:               newID("msg"),
		CampaignID:       r.campaignID,
		Kind:             model.ChatKindRoll,
		SenderUserID:     c.userID,
		SenderName:       c.displayName,
		CharacterID:      in.CharacterID,
		CharacterName:    charName,
		PortraitURL:      portraitURL,
		Content:          rollRes.Label,
		Roll:             &rollRes,
		Actions:          actions,
		Visibility:       vis,
		VisibleToUserIDs: visTo,
		CreatedAt:        time.Now().UTC(),
	}

	if err := r.store.CreateMessage(ctx, msg); err != nil {
		r.sendError(c, env.RequestID, "store_error", "Failed to save roll message")
		return
	}

	r.broadcastChatMessage(msg)

	diceEnv := OutEnvelope{
		Type: "dice.result",
		Payload: map[string]any{
			"roll":          rollRes,
			"senderUserId":  c.userID,
			"senderName":    c.displayName,
			"characterName": charName,
			"visibility":    vis,
		},
	}
	for _, cl := range r.clients {
		if model.CanViewMessage(cl.userID, cl.role, msg) {
			r.sendTo(cl, diceEnv)
		}
	}
}

func (r *Room) handleChatAction(c *Client, env WsEnvelope) {
	var in struct {
		MessageID string `json:"messageId"`
		ActionID  string `json:"actionId"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid chat action payload")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	msg, err := r.store.GetMessage(ctx, r.campaignID, in.MessageID)
	if err != nil {
		r.sendError(c, env.RequestID, "not_found", "Message not found")
		return
	}
	if !model.CanViewMessage(c.userID, c.role, msg) {
		r.sendError(c, env.RequestID, "forbidden", "Cannot access this message")
		return
	}

	actIdx := -1
	for i := range msg.Actions {
		if msg.Actions[i].ID == in.ActionID {
			actIdx = i
			break
		}
	}
	if actIdx < 0 {
		r.sendError(c, env.RequestID, "not_found", "Action not found")
		return
	}
	act := msg.Actions[actIdx]

	auditText := ""
	if act.ActionType == "roll_followup" {
		if formula, ok := act.Payload["formula"].(string); ok && formula != "" {
			label, _ := act.Payload["label"].(string)
			followup := map[string]any{
				"formula":     formula,
				"label":       label,
				"characterId": msg.CharacterID,
				"visibility":  msg.Visibility,
			}
			if act.TargetCharacterID != "" {
				followup["targetCharacterId"] = act.TargetCharacterID
			}
			if v, ok := act.Payload["tagmarColumn"]; ok {
				followup["tagmarColumn"] = v
			}
			if v, ok := act.Payload["tagmarResistance"]; ok {
				followup["tagmarResistance"] = v
			}
			if v, ok := act.Payload["systemMeta"]; ok {
				followup["systemMeta"] = v
			}
			payloadBytes, _ := json.Marshal(followup)
			r.handleDiceRoll(c, WsEnvelope{Type: "dice.roll", RequestID: env.RequestID, Payload: payloadBytes})
		}
	} else {
		targetID := act.TargetCharacterID
		if targetID == "" {
			targetID = msg.CharacterID
		}
		if targetID == "" {
			r.sendError(c, env.RequestID, "invalid_action", "Action has no target character")
			return
		}
		ch, err := r.store.GetCharacter(ctx, r.campaignID, targetID)
		if err != nil {
			r.sendError(c, env.RequestID, "not_found", "Target character not found")
			return
		}
		if !ch.IsControlledBy(c.userID, c.role) {
			r.sendError(c, env.RequestID, "forbidden", "Only the GM or character owner can apply this action")
			return
		}
		if ch.Resources == nil {
			ch.Resources = map[string]model.ResourceBar{}
		}

		amount := int(readFloat(act.Payload["amount"]))
		if amount < 0 {
			amount = 0
		}
		isTagmar := isTagmarCharacter(ch)

		switch act.ActionType {
		case "apply_damage":
			if isTagmar {
				auditText = applyTagmarDamage(&ch, amount, act.Payload)
			} else {
				key := resolveResourceKey(ch.Resources, "pv", "hp")
				bar := ch.Resources[key]
				bar.Current -= amount
				if bar.Current < 0 {
					bar.Current = 0
				}
				ch.Resources[key] = bar
				auditText = fmt.Sprintf("%s sofreu %d de dano (%s: %d/%d).", ch.Name, amount, strings.ToUpper(key), bar.Current, bar.Max)
			}
		case "apply_heal":
			if isTagmar {
				auditText = applyTagmarHeal(&ch, amount, act.Payload)
			} else {
				key := resolveResourceKey(ch.Resources, "pv", "hp")
				bar := ch.Resources[key]
				bar.Current += amount
				if bar.Max > 0 && bar.Current > bar.Max {
					bar.Current = bar.Max
				}
				ch.Resources[key] = bar
				auditText = fmt.Sprintf("%s recuperou %d de vida (%s: %d/%d).", ch.Name, amount, strings.ToUpper(key), bar.Current, bar.Max)
			}
		case "spend_mana", "spend_resource", "spend_karma":
			key := ""
			if resName, ok := act.Payload["resource"].(string); ok && strings.TrimSpace(resName) != "" {
				key = strings.ToLower(strings.TrimSpace(resName))
			} else if act.ActionType == "spend_karma" {
				key = "karma"
			} else if isTagmar {
				key = "karma"
			} else {
				key = resolveResourceKey(ch.Resources, "pm", "mp")
			}
			bar := ch.Resources[key]
			if bar.Current < amount {
				errCode := "insufficient_resource"
				errMsg := fmt.Sprintf("Recurso %s insuficiente", strings.ToUpper(key))
				if act.ActionType == "spend_mana" && key != "karma" {
					errCode = "insufficient_mana"
					errMsg = "Mana insuficiente"
				} else if key == "karma" {
					errCode = "insufficient_mana"
					errMsg = "Karma insuficiente"
				}
				r.sendError(c, env.RequestID, errCode, errMsg)
				return
			}
			bar.Current -= amount
			ch.Resources[key] = bar
			resLabel := strings.ToUpper(key)
			if key == "karma" {
				auditText = fmt.Sprintf("%s gastou %d de Karma (Karma: %d/%d).", ch.Name, amount, bar.Current, bar.Max)
			} else if act.ActionType == "spend_mana" {
				auditText = fmt.Sprintf("%s gastou %d de mana (%s: %d/%d).", ch.Name, amount, resLabel, bar.Current, bar.Max)
			} else {
				auditText = fmt.Sprintf("%s gastou %d de %s (%s: %d/%d).", ch.Name, amount, resLabel, resLabel, bar.Current, bar.Max)
			}
		case "apply_condition":
			condID, _ := act.Payload["conditionId"].(string)
			condName, _ := act.Payload["name"].(string)
			if condName == "" {
				condName = condID
			}
			icon, _ := act.Payload["icon"].(string)
			if icon == "" {
				icon = "sparkles"
			}
			var rounds *int
			if rVal := int(readFloat(act.Payload["rounds"])); rVal > 0 {
				rounds = &rVal
			}
			exists := false
			for i := range ch.Conditions {
				if ch.Conditions[i].ID == condID {
					ch.Conditions[i].RoundsRemaining = rounds
					exists = true
					break
				}
			}
			if !exists && condID != "" {
				ch.Conditions = append(ch.Conditions, model.ActiveCondition{
					ID:              condID,
					Name:            condName,
					Icon:            icon,
					RoundsRemaining: rounds,
				})
			}
			auditText = fmt.Sprintf("Condição '%s' aplicada em %s.", condName, ch.Name)
		default:
			r.sendError(c, env.RequestID, "unsupported_action", "Unsupported actionType: "+act.ActionType)
			return
		}

		ch.UpdatedAt = time.Now().UTC()
		if err := r.store.UpsertCharacter(ctx, ch); err != nil {
			r.sendError(c, env.RequestID, "store_error", "Failed to update character")
			return
		}
		r.broadcastCharacterUpsert(ch, false)
		r.syncLinkedTokens(ctx, ch)
	}

	msg.Actions[actIdx].ExecutedBy = c.displayName
	_ = r.store.UpdateMessage(ctx, msg)

	execEnv := OutEnvelope{
		Type: "chat.action_executed",
		Payload: map[string]any{
			"messageId":  msg.ID,
			"actionId":   act.ID,
			"executedBy": c.displayName,
		},
	}
	for _, cl := range r.clients {
		if model.CanViewMessage(cl.userID, cl.role, msg) {
			r.sendTo(cl, execEnv)
		}
	}

	if auditText != "" {
		sysMsg := model.ChatMessage{
			ID:               newID("msg"),
			CampaignID:       r.campaignID,
			Kind:             model.ChatKindCombatAction,
			SenderUserID:     c.userID,
			SenderName:       c.displayName,
			Content:          auditText,
			Visibility:       msg.Visibility,
			VisibleToUserIDs: msg.VisibleToUserIDs,
			CreatedAt:        time.Now().UTC(),
		}
		_ = r.store.CreateMessage(ctx, sysMsg)
		r.broadcastChatMessage(sysMsg)
	}
}

func (r *Room) handleCharacterPatch(c *Client, env WsEnvelope) {
	var in struct {
		CharacterID string         `json:"characterId"`
		Patch       map[string]any `json:"patch"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.CharacterID == "" {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid character patch")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	ch, err := r.store.GetCharacter(ctx, r.campaignID, in.CharacterID)
	if err != nil {
		r.sendError(c, env.RequestID, "not_found", "Character not found")
		return
	}
	if !ch.IsControlledBy(c.userID, c.role) {
		r.sendError(c, env.RequestID, "forbidden", "No permission to edit this character")
		return
	}

	applyCharacterPatch(&ch, in.Patch, c.role)
	ch.UpdatedAt = time.Now().UTC()
	if err := r.store.UpsertCharacter(ctx, ch); err != nil {
		r.sendError(c, env.RequestID, "store_error", "Failed to save character")
		return
	}
	r.broadcastCharacterUpsert(ch, false)
	r.syncLinkedTokens(ctx, ch)
}

func (r *Room) syncLinkedTokens(ctx context.Context, ch model.Character) {
	scenes, err := r.store.ListScenes(ctx, r.campaignID)
	if err != nil {
		return
	}
	var pvBar, pmBar model.ResourceBar
	var hasPV, hasPM bool
	if isTagmarCharacter(ch) {
		if b, ok := ch.Resources["eh"]; ok {
			pvBar, hasPV = b, true
		} else if b, ok := ch.Resources["ef"]; ok {
			pvBar, hasPV = b, true
		}
		if b, ok := ch.Resources["ef"]; ok {
			pmBar, hasPM = b, true
		} else if b, ok := ch.Resources["karma"]; ok {
			pmBar, hasPM = b, true
		}
	} else {
		pvKey := resolveResourceKey(ch.Resources, "pv", "hp")
		pmKey := resolveResourceKey(ch.Resources, "pm", "mp")
		pvBar, hasPV = ch.Resources[pvKey]
		pmBar, hasPM = ch.Resources[pmKey]
	}

	condIDs := make([]string, 0, len(ch.Conditions))
	for _, cond := range ch.Conditions {
		condIDs = append(condIDs, cond.ID)
	}

	for _, sc := range scenes {
		changed := false
		for i := range sc.Tokens {
			tok := &sc.Tokens[i]
			if tok.CharacterID != nil && *tok.CharacterID == ch.ID {
				tok.Name = ch.Name
				if ch.PortraitURL != "" {
					tok.ImageURL = ch.PortraitURL
				}
				if hasPV {
					hp, hpMax := pvBar.Current, pvBar.Max
					tok.HP = &hp
					tok.HPMax = &hpMax
				}
				if hasPM {
					mp, mpMax := pmBar.Current, pmBar.Max
					tok.MP = &mp
					tok.MPMax = &mpMax
				}
				tok.Conditions = condIDs
				changed = true
				r.broadcastTokenEvent(sc, *tok, "token.updated")
			}
		}
		if changed {
			sc.UpdatedAt = time.Now().UTC()
			_ = r.store.UpsertScene(ctx, sc)
		}
	}
}

func (r *Room) handleSceneActivate(c *Client, env WsEnvelope) {
	if c.role != model.RoleGM {
		r.sendError(c, env.RequestID, "forbidden", "Only the GM can switch the active scene")
		return
	}
	var in struct {
		SceneID string `json:"sceneId"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.SceneID == "" {
		r.sendError(c, env.RequestID, "bad_payload", "sceneId is required")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	sc, err := r.store.GetScene(ctx, r.campaignID, in.SceneID)
	if err != nil {
		r.sendError(c, env.RequestID, "not_found", "Scene not found")
		return
	}
	camp, err := r.store.GetCampaign(ctx, r.campaignID)
	if err != nil {
		return
	}
	sid := sc.ID
	camp.ActiveSceneID = &sid
	camp.UpdatedAt = time.Now().UTC()
	if err := r.store.UpdateCampaign(ctx, camp); err != nil {
		r.sendError(c, env.RequestID, "store_error", "Failed to activate scene")
		return
	}
	r.broadcastSceneActivated(sc)
}

func (r *Room) handleTokenCreate(c *Client, env WsEnvelope) {
	if c.role != model.RoleGM {
		r.sendError(c, env.RequestID, "forbidden", "Only the GM can create tokens")
		return
	}
	var in struct {
		SceneID string      `json:"sceneId"`
		Token   model.Token `json:"token"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.SceneID == "" {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid token create payload")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	sc, err := r.store.GetScene(ctx, r.campaignID, in.SceneID)
	if err != nil {
		r.sendError(c, env.RequestID, "not_found", "Scene not found")
		return
	}
	tok := in.Token
	if tok.ID == "" {
		tok.ID = newID("tok")
	}
	if tok.Size <= 0 {
		tok.Size = 1
	}
	if tok.Layer != "gm" {
		tok.Layer = "tokens"
	}
	if tok.Color == "" {
		tok.Color = "#d4a84f"
	}
	if tok.Conditions == nil {
		tok.Conditions = []string{}
	}
	if tok.ControlledByUserIDs == nil {
		tok.ControlledByUserIDs = []string{}
	}
	sc.Tokens = append(sc.Tokens, tok)
	sc.UpdatedAt = time.Now().UTC()
	if err := r.store.UpsertScene(ctx, sc); err != nil {
		r.sendError(c, env.RequestID, "store_error", "Failed to save token")
		return
	}
	r.broadcastTokenEvent(sc, tok, "token.created")
}

func (r *Room) handleTokenMove(c *Client, env WsEnvelope) {
	var in struct {
		SceneID  string   `json:"sceneId"`
		TokenID  string   `json:"tokenId"`
		X        float64  `json:"x"`
		Y        float64  `json:"y"`
		Rotation *float64 `json:"rotation"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.SceneID == "" || in.TokenID == "" {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid token move payload")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	sc, err := r.store.GetScene(ctx, r.campaignID, in.SceneID)
	if err != nil {
		r.sendError(c, env.RequestID, "not_found", "Scene not found")
		return
	}
	idx := -1
	for i := range sc.Tokens {
		if sc.Tokens[i].ID == in.TokenID {
			idx = i
			break
		}
	}
	if idx < 0 {
		r.sendError(c, env.RequestID, "not_found", "Token not found")
		return
	}
	tok := &sc.Tokens[idx]
	if !r.canControlToken(ctx, c, *tok) {
		r.sendError(c, env.RequestID, "forbidden", "No permission to move this token")
		return
	}

	tok.X = math.Max(0, in.X)
	tok.Y = math.Max(0, in.Y)
	if in.Rotation != nil {
		tok.Rotation = *in.Rotation
	}
	sc.UpdatedAt = time.Now().UTC()
	if err := r.store.UpsertScene(ctx, sc); err != nil {
		return
	}

	out := OutEnvelope{
		Type: "token.moved",
		Payload: map[string]any{
			"sceneId":  sc.ID,
			"tokenId":  tok.ID,
			"x":        tok.X,
			"y":        tok.Y,
			"rotation": tok.Rotation,
		},
	}
	for _, cl := range r.clients {
		if model.CanView(cl.userID, cl.role, sc.Visibility, sc.VisibleToUserIDs) && model.CanViewToken(cl.role, *tok) {
			r.sendTo(cl, out)
		}
	}
}

func (r *Room) handleTokenUpdate(c *Client, env WsEnvelope) {
	var in struct {
		SceneID string         `json:"sceneId"`
		TokenID string         `json:"tokenId"`
		Patch   map[string]any `json:"patch"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.SceneID == "" || in.TokenID == "" {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid token update payload")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	sc, err := r.store.GetScene(ctx, r.campaignID, in.SceneID)
	if err != nil {
		r.sendError(c, env.RequestID, "not_found", "Scene not found")
		return
	}
	idx := -1
	for i := range sc.Tokens {
		if sc.Tokens[i].ID == in.TokenID {
			idx = i
			break
		}
	}
	if idx < 0 {
		r.sendError(c, env.RequestID, "not_found", "Token not found")
		return
	}
	tok := &sc.Tokens[idx]
	if !r.canControlToken(ctx, c, *tok) {
		r.sendError(c, env.RequestID, "forbidden", "No permission to update this token")
		return
	}

	prevLayer := tok.Layer
	if v, ok := in.Patch["name"].(string); ok && strings.TrimSpace(v) != "" {
		tok.Name = strings.TrimSpace(v)
	}
	if v, ok := in.Patch["imageUrl"].(string); ok {
		tok.ImageURL = v
	}
	if v, ok := in.Patch["color"].(string); ok && v != "" {
		tok.Color = v
	}
	if v, ok := in.Patch["size"]; ok {
		if f := readFloat(v); f > 0 && f <= 8 {
			tok.Size = f
		}
	}
	if v, ok := in.Patch["rotation"]; ok {
		tok.Rotation = readFloat(v)
	}
	if v, ok := in.Patch["showBars"].(bool); ok {
		tok.ShowBars = v
	}
	if v, ok := in.Patch["hp"]; ok {
		i := int(readFloat(v))
		tok.HP = &i
	}
	if v, ok := in.Patch["hpMax"]; ok {
		i := int(readFloat(v))
		tok.HPMax = &i
	}
	if v, ok := in.Patch["mp"]; ok {
		i := int(readFloat(v))
		tok.MP = &i
	}
	if v, ok := in.Patch["mpMax"]; ok {
		i := int(readFloat(v))
		tok.MPMax = &i
	}
	if v, ok := in.Patch["conditions"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			var conds []string
			if json.Unmarshal(raw, &conds) == nil {
				tok.Conditions = conds
			}
		}
	}
	if c.role == model.RoleGM {
		if v, ok := in.Patch["layer"].(string); ok && (v == "tokens" || v == "gm") {
			tok.Layer = v
		}
		if v, ok := in.Patch["controlledByUserIds"]; ok {
			if raw, err := json.Marshal(v); err == nil {
				var ids []string
				if json.Unmarshal(raw, &ids) == nil {
					tok.ControlledByUserIDs = ids
				}
			}
		}
	}

	sc.UpdatedAt = time.Now().UTC()
	if err := r.store.UpsertScene(ctx, sc); err != nil {
		return
	}

	// Handle layer transitions securely:
	// gm -> tokens: non-GMs receive token.created
	// tokens -> gm: non-GMs receive token.deleted
	for _, cl := range r.clients {
		if !model.CanView(cl.userID, cl.role, sc.Visibility, sc.VisibleToUserIDs) {
			continue
		}
		if cl.role == model.RoleGM {
			r.sendTo(cl, OutEnvelope{
				Type:    "token.updated",
				Payload: map[string]any{"sceneId": sc.ID, "token": *tok},
			})
			continue
		}
		if prevLayer == "gm" && tok.Layer == "tokens" {
			r.sendTo(cl, OutEnvelope{
				Type:    "token.created",
				Payload: map[string]any{"sceneId": sc.ID, "token": *tok},
			})
		} else if prevLayer == "tokens" && tok.Layer == "gm" {
			r.sendTo(cl, OutEnvelope{
				Type:    "token.deleted",
				Payload: map[string]any{"sceneId": sc.ID, "tokenId": tok.ID},
			})
		} else if tok.Layer == "tokens" {
			r.sendTo(cl, OutEnvelope{
				Type:    "token.updated",
				Payload: map[string]any{"sceneId": sc.ID, "token": *tok},
			})
		}
	}
}

func (r *Room) handleTokenDelete(c *Client, env WsEnvelope) {
	if c.role != model.RoleGM {
		r.sendError(c, env.RequestID, "forbidden", "Only the GM can delete tokens")
		return
	}
	var in struct {
		SceneID string `json:"sceneId"`
		TokenID string `json:"tokenId"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.SceneID == "" || in.TokenID == "" {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid token delete payload")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	sc, err := r.store.GetScene(ctx, r.campaignID, in.SceneID)
	if err != nil {
		return
	}
	idx := -1
	for i := range sc.Tokens {
		if sc.Tokens[i].ID == in.TokenID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return
	}
	removed := sc.Tokens[idx]
	sc.Tokens = append(sc.Tokens[:idx], sc.Tokens[idx+1:]...)
	sc.UpdatedAt = time.Now().UTC()
	if err := r.store.UpsertScene(ctx, sc); err != nil {
		return
	}
	out := OutEnvelope{
		Type:    "token.deleted",
		Payload: map[string]any{"sceneId": sc.ID, "tokenId": removed.ID},
	}
	for _, cl := range r.clients {
		if model.CanView(cl.userID, cl.role, sc.Visibility, sc.VisibleToUserIDs) && model.CanViewToken(cl.role, removed) {
			r.sendTo(cl, out)
		}
	}
}

func (r *Room) handleFogUpdate(c *Client, env WsEnvelope) {
	if c.role != model.RoleGM {
		r.sendError(c, env.RequestID, "forbidden", "Only the GM can update Fog of War")
		return
	}
	var in struct {
		SceneID string `json:"sceneId"`
		Mode    string `json:"mode"` // "reveal" | "hide" | "reset" | "reveal_all" | "toggle"
		Enabled *bool  `json:"enabled"`
		Cells   []int  `json:"cells"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.SceneID == "" {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid fog payload")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	sc, err := r.store.GetScene(ctx, r.campaignID, in.SceneID)
	if err != nil {
		r.sendError(c, env.RequestID, "not_found", "Scene not found")
		return
	}
	totalCells := sc.Grid.Cols * sc.Grid.Rows
	if totalCells <= 0 {
		totalCells = 24 * 18
	}
	buf := []byte(sc.Fog.RevealedCells)
	if len(buf) != totalCells {
		buf = []byte(strings.Repeat("0", totalCells))
	}

	if in.Enabled != nil {
		sc.Fog.Enabled = *in.Enabled
	}
	switch in.Mode {
	case "reveal":
		sc.Fog.Enabled = true
		for _, idx := range in.Cells {
			if idx >= 0 && idx < totalCells {
				buf[idx] = '1'
			}
		}
	case "hide":
		sc.Fog.Enabled = true
		for _, idx := range in.Cells {
			if idx >= 0 && idx < totalCells {
				buf[idx] = '0'
			}
		}
	case "reset":
		sc.Fog.Enabled = true
		for i := range buf {
			buf[i] = '0'
		}
	case "reveal_all":
		for i := range buf {
			buf[i] = '1'
		}
	}

	sc.Fog.RevealedCells = string(buf)
	sc.UpdatedAt = time.Now().UTC()
	if err := r.store.UpsertScene(ctx, sc); err != nil {
		return
	}

	out := OutEnvelope{
		Type: "fog.updated",
		Payload: map[string]any{
			"sceneId":       sc.ID,
			"enabled":       sc.Fog.Enabled,
			"revealedCells": sc.Fog.RevealedCells,
		},
	}
	for _, cl := range r.clients {
		if model.CanView(cl.userID, cl.role, sc.Visibility, sc.VisibleToUserIDs) {
			r.sendTo(cl, out)
		}
	}
}

func (r *Room) handleMapPing(c *Client, env WsEnvelope) {
	var in struct {
		SceneID string  `json:"sceneId"`
		X       float64 `json:"x"`
		Y       float64 `json:"y"`
		Color   string  `json:"color"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.SceneID == "" {
		return
	}
	if in.Color == "" {
		in.Color = "#d4a84f"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	sc, err := r.store.GetScene(ctx, r.campaignID, in.SceneID)
	if err != nil {
		return
	}
	out := OutEnvelope{
		Type: "map.ping",
		Payload: map[string]any{
			"sceneId":     sc.ID,
			"x":           in.X,
			"y":           in.Y,
			"color":       in.Color,
			"userId":      c.userID,
			"displayName": c.displayName,
		},
	}
	for _, cl := range r.clients {
		if model.CanView(cl.userID, cl.role, sc.Visibility, sc.VisibleToUserIDs) {
			r.sendTo(cl, out)
		}
	}
}

func (r *Room) handleCombatUpdate(c *Client, env WsEnvelope) {
	var in struct {
		Op        string           `json:"op"`
		Combatant *model.Combatant `json:"combatant"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid combat payload")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Only GM can run combat ops, except players setting initiative for a character they control.
	if c.role != model.RoleGM {
		allowed := false
		if in.Op == "set_initiative" && in.Combatant != nil && in.Combatant.CharacterID != nil {
			if ch, err := r.store.GetCharacter(ctx, r.campaignID, *in.Combatant.CharacterID); err == nil && ch.IsControlledBy(c.userID, c.role) {
				allowed = true
			}
		}
		if !allowed {
			r.sendError(c, env.RequestID, "forbidden", "Only the GM can manage combat order")
			return
		}
	}

	camp, err := r.store.GetCampaign(ctx, r.campaignID)
	if err != nil {
		return
	}
	cb := &camp.Combat
	if cb.Combatants == nil {
		cb.Combatants = []model.Combatant{}
	}

	switch in.Op {
	case "start":
		cb.Active = true
		if cb.Round < 1 {
			cb.Round = 1
		}
		cb.TurnIndex = 0
		sortCombatants(cb.Combatants)
	case "end":
		cb.Active = false
		cb.Round = 1
		cb.TurnIndex = 0
		for i := range cb.Combatants {
			cb.Combatants[i].Acted = false
		}
	case "next_turn":
		if len(cb.Combatants) > 0 {
			cb.Active = true
			if cb.TurnIndex >= 0 && cb.TurnIndex < len(cb.Combatants) {
				cb.Combatants[cb.TurnIndex].Acted = true
			}
			cb.TurnIndex++
			if cb.TurnIndex >= len(cb.Combatants) {
				cb.TurnIndex = 0
				cb.Round++
				for i := range cb.Combatants {
					cb.Combatants[i].Acted = false
				}
			}
		}
	case "prev_turn":
		if len(cb.Combatants) > 0 {
			cb.TurnIndex--
			if cb.TurnIndex < 0 {
				if cb.Round > 1 {
					cb.Round--
				}
				cb.TurnIndex = len(cb.Combatants) - 1
			}
		}
	case "add":
		if in.Combatant == nil {
			r.sendError(c, env.RequestID, "bad_payload", "combatant required")
			return
		}
		item := *in.Combatant
		if item.ID == "" {
			item.ID = newID("cmb")
		}
		cb.Combatants = append(cb.Combatants, item)
		sortCombatants(cb.Combatants)
	case "remove":
		if in.Combatant == nil || in.Combatant.ID == "" {
			r.sendError(c, env.RequestID, "bad_payload", "combatant id required")
			return
		}
		next := make([]model.Combatant, 0, len(cb.Combatants))
		for _, item := range cb.Combatants {
			if item.ID != in.Combatant.ID {
				next = append(next, item)
			}
		}
		cb.Combatants = next
		if cb.TurnIndex >= len(cb.Combatants) && len(cb.Combatants) > 0 {
			cb.TurnIndex = 0
		}
	case "set_initiative":
		if in.Combatant == nil {
			r.sendError(c, env.RequestID, "bad_payload", "combatant required")
			return
		}
		updated := false
		for i := range cb.Combatants {
			matchID := in.Combatant.ID != "" && cb.Combatants[i].ID == in.Combatant.ID
			matchChar := in.Combatant.CharacterID != nil && cb.Combatants[i].CharacterID != nil && *cb.Combatants[i].CharacterID == *in.Combatant.CharacterID
			if matchID || matchChar {
				cb.Combatants[i].Initiative = in.Combatant.Initiative
				if c.role == model.RoleGM && in.Combatant.Name != "" {
					cb.Combatants[i].Name = in.Combatant.Name
					cb.Combatants[i].Hidden = in.Combatant.Hidden
				}
				updated = true
				break
			}
		}
		if !updated {
			item := *in.Combatant
			if item.ID == "" {
				item.ID = newID("cmb")
			}
			cb.Combatants = append(cb.Combatants, item)
		}
		sortCombatants(cb.Combatants)
	case "toggle_hidden":
		if in.Combatant != nil {
			for i := range cb.Combatants {
				if cb.Combatants[i].ID == in.Combatant.ID {
					cb.Combatants[i].Hidden = !cb.Combatants[i].Hidden
					break
				}
			}
		}
	default:
		r.sendError(c, env.RequestID, "bad_payload", "Unknown combat op: "+in.Op)
		return
	}

	camp.UpdatedAt = time.Now().UTC()
	if err := r.store.UpdateCampaign(ctx, camp); err != nil {
		return
	}

	for _, cl := range r.clients {
		sanitized := model.SanitizeCombatForUser(camp.Combat, cl.role)
		r.sendTo(cl, OutEnvelope{
			Type:    "combat.updated",
			Payload: map[string]any{"combat": sanitized},
		})
	}
}

func (r *Room) handleFolderUpsert(c *Client, env WsEnvelope) {
	if c.role != model.RoleGM {
		r.sendError(c, env.RequestID, "forbidden", "Only the GM can manage folders")
		return
	}
	var in struct {
		Folder model.Folder `json:"folder"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid folder payload")
		return
	}
	f := in.Folder
	if f.ID == "" {
		f.ID = newID("fld")
	}
	f.CampaignID = r.campaignID
	f.Visibility = model.NormalizeVisibility(f.Visibility)
	if f.CreatedBy == "" {
		f.CreatedBy = c.userID
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := r.store.UpsertFolder(ctx, f); err != nil {
		return
	}
	r.broadcastFolderUpsert(f)
}

func (r *Room) handleFolderDelete(c *Client, env WsEnvelope) {
	if c.role != model.RoleGM {
		r.sendError(c, env.RequestID, "forbidden", "Only the GM can delete folders")
		return
	}
	var in struct {
		FolderID string `json:"folderId"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.FolderID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := r.store.DeleteFolder(ctx, r.campaignID, in.FolderID); err != nil {
		return
	}
	r.broadcastAll(OutEnvelope{Type: "folder.deleted", Payload: map[string]any{"folderId": in.FolderID}})
}

func (r *Room) handleDocumentUpsert(c *Client, env WsEnvelope) {
	var in struct {
		Document model.Document `json:"document"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid document payload")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	d := in.Document
	if d.ID != "" {
		if existing, err := r.store.GetDocument(ctx, r.campaignID, d.ID); err == nil {
			if c.role != model.RoleGM && existing.CreatedBy != c.userID {
				r.sendError(c, env.RequestID, "forbidden", "No permission to edit this document")
				return
			}
			d.CreatedBy = existing.CreatedBy
		}
	} else {
		d.ID = newID("doc")
		d.CreatedBy = c.userID
	}
	d.CampaignID = r.campaignID
	if d.Kind == "" {
		d.Kind = model.DocKindNote
	}
	if c.role != model.RoleGM && d.Visibility == model.VisibilityGMOnly {
		d.Visibility = model.VisibilityAllPlayers
	} else {
		d.Visibility = model.NormalizeVisibility(d.Visibility)
	}
	d.UpdatedAt = time.Now().UTC()
	if err := r.store.UpsertDocument(ctx, d); err != nil {
		return
	}
	r.broadcastDocumentUpsert(d)
}

func (r *Room) handleDocumentDelete(c *Client, env WsEnvelope) {
	var in struct {
		DocumentID string `json:"documentId"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.DocumentID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	existing, err := r.store.GetDocument(ctx, r.campaignID, in.DocumentID)
	if err != nil {
		return
	}
	if c.role != model.RoleGM && existing.CreatedBy != c.userID {
		r.sendError(c, env.RequestID, "forbidden", "No permission to delete this document")
		return
	}
	if err := r.store.DeleteDocument(ctx, r.campaignID, in.DocumentID); err != nil {
		return
	}
	r.broadcastAll(OutEnvelope{Type: "document.deleted", Payload: map[string]any{"documentId": in.DocumentID}})
}

func (r *Room) handleMacroUpsert(c *Client, env WsEnvelope) {
	var in struct {
		Macro model.Macro `json:"macro"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	mc := in.Macro
	if mc.ID != "" {
		if existing, err := r.store.GetMacro(ctx, r.campaignID, mc.ID); err == nil {
			if c.role != model.RoleGM && existing.CreatedBy != c.userID {
				r.sendError(c, env.RequestID, "forbidden", "No permission to edit macro")
				return
			}
			mc.CreatedBy = existing.CreatedBy
		}
	} else {
		mc.ID = newID("mac")
		mc.CreatedBy = c.userID
	}
	mc.CampaignID = r.campaignID
	if mc.Scope == "" {
		mc.Scope = "campaign"
	}
	if c.role != model.RoleGM && mc.Visibility == model.VisibilityGMOnly {
		mc.Visibility = model.VisibilityAllPlayers
	} else {
		mc.Visibility = model.NormalizeVisibility(mc.Visibility)
	}
	if err := r.store.UpsertMacro(ctx, mc); err != nil {
		return
	}
	r.broadcastMacroUpsert(mc)
}

func (r *Room) handleMacroDelete(c *Client, env WsEnvelope) {
	var in struct {
		MacroID string `json:"macroId"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.MacroID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	existing, err := r.store.GetMacro(ctx, r.campaignID, in.MacroID)
	if err != nil {
		return
	}
	if c.role != model.RoleGM && existing.CreatedBy != c.userID {
		r.sendError(c, env.RequestID, "forbidden", "No permission to delete macro")
		return
	}
	if err := r.store.DeleteMacro(ctx, r.campaignID, in.MacroID); err != nil {
		return
	}
	r.broadcastAll(OutEnvelope{Type: "macro.deleted", Payload: map[string]any{"macroId": in.MacroID}})
}

// --- Visibility-filtered broadcast helpers ---

func (r *Room) broadcastFolderUpsert(f model.Folder) {
	for _, cl := range r.clients {
		if model.CanView(cl.userID, cl.role, f.Visibility, f.VisibleToUserIDs) {
			r.sendTo(cl, OutEnvelope{Type: "folder.updated", Payload: map[string]any{"folder": f}})
		} else {
			r.sendTo(cl, OutEnvelope{Type: "folder.deleted", Payload: map[string]any{"folderId": f.ID}})
		}
	}
}

func (r *Room) broadcastDocumentUpsert(d model.Document) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	folders, _ := r.store.ListFolders(ctx, r.campaignID)

	for _, cl := range r.clients {
		_, visFolders := model.SanitizeFoldersForUser(folders, cl.userID, cl.role)
		canSee := cl.role == model.RoleGM ||
			(model.CanView(cl.userID, cl.role, d.Visibility, d.VisibleToUserIDs) &&
				(d.FolderID == nil || *d.FolderID == "" || visFolders[*d.FolderID]))
		if canSee {
			r.sendTo(cl, OutEnvelope{Type: "document.updated", Payload: map[string]any{"document": d}})
		} else {
			r.sendTo(cl, OutEnvelope{Type: "document.deleted", Payload: map[string]any{"documentId": d.ID}})
		}
	}
}

func (r *Room) broadcastCharacterUpsert(ch model.Character, created bool) {
	evType := "character.updated"
	if created {
		evType = "character.created"
	}
	for _, cl := range r.clients {
		if cl.role == model.RoleGM || ch.IsControlledBy(cl.userID, cl.role) || model.CanView(cl.userID, cl.role, ch.Visibility, ch.VisibleToUserIDs) {
			r.sendTo(cl, OutEnvelope{Type: evType, Payload: map[string]any{"character": ch}})
		} else if !created {
			r.sendTo(cl, OutEnvelope{Type: "character.deleted", Payload: map[string]any{"characterId": ch.ID}})
		}
	}
}

func (r *Room) broadcastSceneUpsert(sc model.Scene, created bool) {
	evType := "scene.updated"
	if created {
		evType = "scene.created"
	}
	for _, cl := range r.clients {
		if sanitized, ok := model.SanitizeSceneForUser(sc, cl.userID, cl.role); ok {
			r.sendTo(cl, OutEnvelope{Type: evType, Payload: map[string]any{"scene": sanitized}})
		} else if !created {
			r.sendTo(cl, OutEnvelope{Type: "scene.deleted", Payload: map[string]any{"sceneId": sc.ID}})
		}
	}
}

func (r *Room) broadcastSceneActivated(sc model.Scene) {
	for _, cl := range r.clients {
		if sanitized, ok := model.SanitizeSceneForUser(sc, cl.userID, cl.role); ok {
			r.sendTo(cl, OutEnvelope{
				Type: "scene.activated",
				Payload: map[string]any{
					"sceneId": sanitized.ID,
					"scene":   sanitized,
				},
			})
		}
	}
}

func (r *Room) broadcastTokenEvent(sc model.Scene, tok model.Token, evType string) {
	out := OutEnvelope{
		Type:    evType,
		Payload: map[string]any{"sceneId": sc.ID, "token": tok},
	}
	for _, cl := range r.clients {
		if model.CanView(cl.userID, cl.role, sc.Visibility, sc.VisibleToUserIDs) && model.CanViewToken(cl.role, tok) {
			r.sendTo(cl, out)
		}
	}
}

func (r *Room) broadcastMacroUpsert(mc model.Macro) {
	for _, cl := range r.clients {
		if cl.role == model.RoleGM || mc.CreatedBy == cl.userID || model.CanView(cl.userID, cl.role, mc.Visibility, mc.VisibleToUserIDs) {
			r.sendTo(cl, OutEnvelope{Type: "macro.updated", Payload: map[string]any{"macro": mc}})
		} else {
			r.sendTo(cl, OutEnvelope{Type: "macro.deleted", Payload: map[string]any{"macroId": mc.ID}})
		}
	}
}

func (r *Room) canControlToken(ctx context.Context, c *Client, tok model.Token) bool {
	if c.role == model.RoleGM {
		return true
	}
	if tok.Layer == "gm" {
		return false
	}
	if slices.Contains(tok.ControlledByUserIDs, c.userID) {
		return true
	}
	if tok.CharacterID != nil && *tok.CharacterID != "" {
		if ch, err := r.store.GetCharacter(ctx, r.campaignID, *tok.CharacterID); err == nil {
			return ch.IsControlledBy(c.userID, c.role)
		}
	}
	return false
}

func sortCombatants(list []model.Combatant) {
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].Initiative != list[j].Initiative {
			return list[i].Initiative > list[j].Initiative
		}
		return list[i].Name < list[j].Name
	})
}

func applyCharacterPatch(ch *model.Character, patch map[string]any, role model.MemberRole) {
	if v, ok := patch["name"].(string); ok && strings.TrimSpace(v) != "" {
		ch.Name = strings.TrimSpace(v)
	}
	if v, ok := patch["subtitle"].(string); ok {
		ch.Subtitle = v
	}
	if v, ok := patch["portraitUrl"].(string); ok {
		ch.PortraitURL = v
	}
	if v, ok := patch["resources"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			var res map[string]model.ResourceBar
			if json.Unmarshal(raw, &res) == nil {
				ch.Resources = res
				if ef, ok := res["ef"]; ok && ef.Temp > 0 && ch.Computed != nil {
					delete(ch.Computed, "absorcaoDepleted")
				}
			}
		}
	}
	if v, ok := patch["conditions"]; ok {
		if raw, err := json.Marshal(v); err == nil {
			var conds []model.ActiveCondition
			if json.Unmarshal(raw, &conds) == nil {
				ch.Conditions = conds
			}
		}
	}
	if v, ok := patch["systemData"]; ok {
		if m, ok := v.(map[string]any); ok {
			if ch.SystemData == nil {
				ch.SystemData = map[string]any{}
			}
			for k, val := range m {
				ch.SystemData[k] = val
			}
		}
	}
	if v, ok := patch["computed"]; ok {
		if m, ok := v.(map[string]any); ok {
			ch.Computed = m
		}
	}
	if role == model.RoleGM {
		if v, ok := patch["kind"].(string); ok && v != "" {
			ch.Kind = model.CharacterKind(v)
		}
		if v, ok := patch["visibility"].(string); ok && v != "" {
			ch.Visibility = model.NormalizeVisibility(model.Visibility(v))
		}
		if v, ok := patch["visibleToUserIds"]; ok {
			if raw, err := json.Marshal(v); err == nil {
				var ids []string
				if json.Unmarshal(raw, &ids) == nil {
					ch.VisibleToUserIDs = ids
				}
			}
		}
		if v, ok := patch["ownerUserId"]; ok {
			if v == nil {
				ch.OwnerUserID = nil
			} else if s, ok := v.(string); ok {
				if s == "" {
					ch.OwnerUserID = nil
				} else {
					ch.OwnerUserID = &s
				}
			}
		}
		if v, ok := patch["controlledByUserIds"]; ok {
			if raw, err := json.Marshal(v); err == nil {
				var ids []string
				if json.Unmarshal(raw, &ids) == nil {
					ch.ControlledByUserIDs = ids
				}
			}
		}
	}
}

func resolveResourceKey(res map[string]model.ResourceBar, preferred, fallback string) string {
	if _, ok := res[preferred]; ok {
		return preferred
	}
	if _, ok := res[fallback]; ok {
		return fallback
	}
	return preferred
}

func readFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	default:
		return 0
	}
}

func readIntField(m map[string]any, keys ...string) (int, bool) {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			return int(readFloat(v)), true
		}
	}
	return 0, false
}

func readBool(v any) bool {
	b, _ := v.(bool)
	return b
}

func isTagmarCharacter(ch model.Character) bool {
	if dice.IsTagmarSystem(ch.SystemID) {
		return true
	}
	if _, hasEH := ch.Resources["eh"]; hasEH {
		return true
	}
	if _, hasEF := ch.Resources["ef"]; hasEF {
		return true
	}
	return false
}

func ensureCondition(ch *model.Character, id, name, icon string) {
	for _, c := range ch.Conditions {
		if c.ID == id {
			return
		}
	}
	ch.Conditions = append(ch.Conditions, model.ActiveCondition{
		ID:   id,
		Name: name,
		Icon: icon,
	})
}

func removeConditions(ch *model.Character, ids ...string) {
	if len(ch.Conditions) == 0 {
		return
	}
	next := make([]model.ActiveCondition, 0, len(ch.Conditions))
	for _, c := range ch.Conditions {
		if !slices.Contains(ids, c.ID) {
			next = append(next, c)
		}
	}
	ch.Conditions = next
}

// applyTagmarDamage implements Tagmar 3.0's official EH -> Absorção -> EF damage pipeline
// (and Critical / directToEf bypass straight into EF, allowing negative EF down to unconscious/dead).
func applyTagmarDamage(ch *model.Character, amount int, payload map[string]any) string {
	ehBar := ch.Resources["eh"]
	efBar := ch.Resources["ef"]

	directToEf := readBool(payload["directToEf"]) || readBool(payload["tagmarDirectToEf"]) || readBool(payload["critical"])
	if resStr, _ := payload["resource"].(string); strings.EqualFold(strings.TrimSpace(resStr), "ef") {
		directToEf = true
	}
	ignoreAbsorption := readBool(payload["ignoreAbsorption"]) || directToEf

	// Determine active armor Absorção pool: explicit payload override, else ef.Temp, else computed.absorcao (unless depleted).
	nextAbs := efBar.Temp
	if absOverride, ok := readIntField(payload, "absorcao"); ok {
		nextAbs = max(0, absOverride)
	} else if nextAbs <= 0 && !readBool(ch.Computed["absorcaoDepleted"]) {
		if absVal, ok := readIntField(ch.Computed, "absorcao"); ok && absVal > 0 {
			nextAbs = absVal
		} else if absVal, ok := readIntField(ch.SystemData, "absorcao"); ok && absVal > 0 {
			nextAbs = absVal
		}
	}
	if nextAbs < 0 {
		nextAbs = 0
	}

	ehAbsorbed := 0
	armorAbsorbed := 0
	efLoss := 0

	if directToEf {
		remaining := amount
		if !ignoreAbsorption && nextAbs > 0 {
			armorAbsorbed = min(nextAbs, remaining)
			nextAbs -= armorAbsorbed
			remaining -= armorAbsorbed
		}
		efLoss = remaining
		efBar.Current -= efLoss
	} else {
		remaining := amount
		if ehBar.Current > 0 {
			ehAbsorbed = min(ehBar.Current, remaining)
			ehBar.Current -= ehAbsorbed
			remaining -= ehAbsorbed
		}
		if remaining > 0 && !ignoreAbsorption && nextAbs > 0 {
			armorAbsorbed = min(nextAbs, remaining)
			nextAbs -= armorAbsorbed
			remaining -= armorAbsorbed
		}
		if remaining > 0 {
			efLoss = remaining
			efBar.Current -= efLoss
		}
	}

	if armorAbsorbed > 0 && nextAbs == 0 {
		if ch.Computed == nil {
			ch.Computed = map[string]any{}
		}
		ch.Computed["absorcaoDepleted"] = true
	}
	efBar.Temp = nextAbs
	ch.Resources["eh"] = ehBar
	ch.Resources["ef"] = efBar

	statusSuffix := ""
	if efBar.Current <= -15 {
		ensureCondition(ch, "inconsciente", "Inconsciente", "moon-star")
		ensureCondition(ch, "agonizando", "Agonizando", "skull")
		statusSuffix = " [MORTO · EF ≤ -15!]"
	} else if efBar.Current < 0 {
		ensureCondition(ch, "inconsciente", "Inconsciente", "moon-star")
		ensureCondition(ch, "agonizando", "Agonizando", "skull")
		statusSuffix = " [Inconsciente & Agonizando!]"
	} else if efBar.Current == 0 {
		ensureCondition(ch, "inconsciente", "Inconsciente", "moon-star")
		statusSuffix = " [Inconsciente!]"
	}

	if directToEf {
		return fmt.Sprintf("%s sofreu %d de dano direto na EF (EF: %d/%d · EH: %d/%d).%s",
			ch.Name, amount, efBar.Current, efBar.Max, ehBar.Current, ehBar.Max, statusSuffix)
	}
	if armorAbsorbed == 0 && efLoss == 0 {
		return fmt.Sprintf("%s sofreu %d de dano na EH (EH: %d/%d · EF: %d/%d).",
			ch.Name, amount, ehBar.Current, ehBar.Max, efBar.Current, efBar.Max)
	}
	if armorAbsorbed > 0 {
		return fmt.Sprintf("%s sofreu %d de dano (-%d EH, %d absorvido, -%d EF · EH: %d/%d · EF: %d/%d).%s",
			ch.Name, amount, ehAbsorbed, armorAbsorbed, efLoss, ehBar.Current, ehBar.Max, efBar.Current, efBar.Max, statusSuffix)
	}
	return fmt.Sprintf("%s sofreu %d de dano (-%d EH, -%d EF · EH: %d/%d · EF: %d/%d).%s",
		ch.Name, amount, ehAbsorbed, efLoss, ehBar.Current, ehBar.Max, efBar.Current, efBar.Max, statusSuffix)
}

func applyTagmarHeal(ch *model.Character, amount int, payload map[string]any) string {
	ehBar := ch.Resources["eh"]
	efBar := ch.Resources["ef"]
	karmaBar := ch.Resources["karma"]
	prevEf := efBar.Current

	healEf := max(0, int(readFloat(payload["healEf"])))
	healEh := max(0, int(readFloat(payload["healEh"])))
	restoreKarma := max(0, int(readFloat(payload["restoreKarma"])))
	resStr := strings.ToLower(strings.TrimSpace(fmt.Sprint(payload["resource"])))
	if payload["resource"] == nil {
		resStr = ""
	}

	if healEf > 0 || healEh > 0 || restoreKarma > 0 {
		if healEf > 0 {
			efBar.Current += healEf
			if efBar.Max > 0 && efBar.Current > efBar.Max {
				efBar.Current = efBar.Max
			}
		}
		if healEh > 0 {
			ehBar.Current += healEh
			if ehBar.Max > 0 && ehBar.Current > ehBar.Max {
				ehBar.Current = ehBar.Max
			}
		}
		if restoreKarma > 0 {
			karmaBar.Current += restoreKarma
			if karmaBar.Max > 0 && karmaBar.Current > karmaBar.Max {
				karmaBar.Current = karmaBar.Max
			}
			ch.Resources["karma"] = karmaBar
		}
		ch.Resources["ef"] = efBar
		ch.Resources["eh"] = ehBar
		if prevEf <= 0 && efBar.Current > 0 {
			removeConditions(ch, "inconsciente", "agonizando")
		}
		return fmt.Sprintf("%s recuperou energia (EH: %d/%d · EF: %d/%d).", ch.Name, ehBar.Current, ehBar.Max, efBar.Current, efBar.Max)
	}

	switch resStr {
	case "ef":
		efBar.Current += amount
		if efBar.Max > 0 && efBar.Current > efBar.Max {
			efBar.Current = efBar.Max
		}
		ch.Resources["ef"] = efBar
		if prevEf <= 0 && efBar.Current > 0 {
			removeConditions(ch, "inconsciente", "agonizando")
		}
		return fmt.Sprintf("%s recuperou %d de EF (EF: %d/%d).", ch.Name, amount, efBar.Current, efBar.Max)
	case "eh":
		ehBar.Current += amount
		if ehBar.Max > 0 && ehBar.Current > ehBar.Max {
			ehBar.Current = ehBar.Max
		}
		ch.Resources["eh"] = ehBar
		return fmt.Sprintf("%s recuperou %d de EH (EH: %d/%d).", ch.Name, amount, ehBar.Current, ehBar.Max)
	case "karma":
		karmaBar.Current += amount
		if karmaBar.Max > 0 && karmaBar.Current > karmaBar.Max {
			karmaBar.Current = karmaBar.Max
		}
		ch.Resources["karma"] = karmaBar
		return fmt.Sprintf("%s recuperou %d de Karma (Karma: %d/%d).", ch.Name, amount, karmaBar.Current, karmaBar.Max)
	default:
		// Tagmar default healing: stabilize EF up to max first, overflow remaining into EH.
		remaining := amount
		efMissing := max(0, efBar.Max-efBar.Current)
		efGain := min(efMissing, remaining)
		efBar.Current += efGain
		remaining -= efGain

		ehMissing := max(0, ehBar.Max-ehBar.Current)
		ehGain := min(ehMissing, remaining)
		ehBar.Current += ehGain

		ch.Resources["ef"] = efBar
		ch.Resources["eh"] = ehBar
		if prevEf <= 0 && efBar.Current > 0 {
			removeConditions(ch, "inconsciente", "agonizando")
		}
		return fmt.Sprintf("%s recuperou %d (+%d EF, +%d EH · EH: %d/%d · EF: %d/%d).",
			ch.Name, amount, efGain, ehGain, ehBar.Current, ehBar.Max, efBar.Current, efBar.Max)
	}
}

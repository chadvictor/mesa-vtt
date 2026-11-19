package hub

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/chadvictor/mesa-vtt/server/internal/model"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

const (
	MaxWSReadBytes = 256 * 1024 // 256 KiB per ARCHITECTURE.md
	ClientSendBuf  = 128
)

// WsEnvelope is the wire frame exchanged over /ws.
type WsEnvelope struct {
	Type      string          `json:"type"`
	RequestID string          `json:"requestId,omitempty"`
	Payload   json.RawMessage `json:"payload"`
}

// OutEnvelope is used for marshaling outbound messages cleanly.
type OutEnvelope struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId,omitempty"`
	Payload   any    `json:"payload"`
}

// Hub manages all active campaign rooms and bridges REST mutations to live WS broadcasts.
type Hub struct {
	store  store.Store
	mu     sync.RWMutex
	rooms  map[string]*Room
	closed bool
}

func New(st store.Store) *Hub {
	return &Hub{
		store: st,
		rooms: make(map[string]*Room),
	}
}

func (h *Hub) Close() {
	h.mu.Lock()
	h.closed = true
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.rooms = make(map[string]*Room)
	h.mu.Unlock()

	for _, r := range rooms {
		r.stop()
	}
}

func (h *Hub) getOrCreateRoom(campaignID string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	r, ok := h.rooms[campaignID]
	if !ok {
		r = newRoom(campaignID, h.store, h)
		h.rooms[campaignID] = r
		go r.run()
	}
	return r
}

func (h *Hub) getRoom(campaignID string) *Room {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.rooms[campaignID]
}

// AttachClient registers an authenticated WebSocket connection into a campaign room and blocks until disconnect.
func (h *Hub) AttachClient(ctx context.Context, campaignID string, user model.UserIdentity, member model.CampaignMember, conn *websocket.Conn) {
	r := h.getOrCreateRoom(campaignID)
	if r == nil {
		_ = conn.Close(websocket.StatusGoingAway, "server shutting down")
		return
	}
	conn.SetReadLimit(MaxWSReadBytes)

	c := &Client{
		id:          newID("ws"),
		userID:      user.ID,
		displayName: user.DisplayName,
		avatarURL:   user.AvatarURL,
		role:        member.Role,
		conn:        conn,
		send:        make(chan OutEnvelope, ClientSendBuf),
		done:        make(chan struct{}),
	}

	if !r.enqueue(roomEvent{kind: evJoin, client: c}) {
		_ = conn.Close(websocket.StatusGoingAway, "room unavailable")
		return
	}

	go c.writer(r)
	c.reader(ctx, r)
}

// OnlineUserIDs returns the set of currently WS-connected user IDs in a campaign.
func (h *Hub) OnlineUserIDs(campaignID string) map[string]bool {
	r := h.getRoom(campaignID)
	if r == nil {
		return map[string]bool{}
	}
	return r.snapshotOnlineUsers()
}

// Counts returns (onlineUserCount, activeVoiceParticipantCount) for a campaign.
func (h *Hub) Counts(campaignID string) (int, int) {
	r := h.getRoom(campaignID)
	if r == nil {
		return 0, 0
	}
	return r.snapshotCounts()
}

// BuildCampaignState loads persisted state, attaches live online/voice state, and applies wire visibility sanitization.
func (h *Hub) BuildCampaignState(ctx context.Context, campaignID, userID string, role model.MemberRole) (model.CampaignState, error) {
	camp, err := h.store.GetCampaign(ctx, campaignID)
	if err != nil {
		return model.CampaignState{}, err
	}
	members, err := h.store.ListMembers(ctx, campaignID)
	if err != nil {
		return model.CampaignState{}, err
	}
	online := h.OnlineUserIDs(campaignID)
	for i := range members {
		members[i].Online = online[members[i].UserID]
	}
	folders, err := h.store.ListFolders(ctx, campaignID)
	if err != nil {
		return model.CampaignState{}, err
	}
	docs, err := h.store.ListDocuments(ctx, campaignID)
	if err != nil {
		return model.CampaignState{}, err
	}
	chars, err := h.store.ListCharacters(ctx, campaignID)
	if err != nil {
		return model.CampaignState{}, err
	}
	scenes, err := h.store.ListScenes(ctx, campaignID)
	if err != nil {
		return model.CampaignState{}, err
	}
	msgs, err := h.store.ListMessages(ctx, campaignID, 100)
	if err != nil {
		return model.CampaignState{}, err
	}
	macros, err := h.store.ListMacros(ctx, campaignID)
	if err != nil {
		return model.CampaignState{}, err
	}
	channels, err := h.store.ListVoiceChannels(ctx, campaignID)
	if err != nil {
		return model.CampaignState{}, err
	}
	if r := h.getRoom(campaignID); r != nil {
		channels = r.attachVoiceParticipants(channels)
	}

	raw := model.CampaignState{
		Campaign:      camp,
		Members:       members,
		Folders:       folders,
		Documents:     docs,
		Characters:    chars,
		Scenes:        scenes,
		ActiveSceneID: camp.ActiveSceneID,
		Messages:      msgs,
		Macros:        macros,
		VoiceChannels: channels,
	}
	return model.SanitizeCampaignState(raw, userID, role), nil
}

// --- REST -> WS live broadcast helpers ---

func (h *Hub) Notify(campaignID string, fn func(r *Room)) {
	r := h.getRoom(campaignID)
	if r == nil {
		return
	}
	r.enqueue(roomEvent{kind: evCustom, fn: fn})
}

func (h *Hub) NotifyPresence(campaignID string) {
	h.Notify(campaignID, func(r *Room) { r.broadcastPresence() })
}

func (h *Hub) NotifyFolderUpserted(campaignID string, f model.Folder) {
	h.Notify(campaignID, func(r *Room) { r.broadcastFolderUpsert(f) })
}

func (h *Hub) NotifyFolderDeleted(campaignID, folderID string) {
	h.Notify(campaignID, func(r *Room) {
		r.broadcastAll(OutEnvelope{Type: "folder.deleted", Payload: map[string]any{"folderId": folderID}})
	})
}

func (h *Hub) NotifyDocumentUpserted(campaignID string, d model.Document) {
	h.Notify(campaignID, func(r *Room) { r.broadcastDocumentUpsert(d) })
}

func (h *Hub) NotifyDocumentDeleted(campaignID, docID string) {
	h.Notify(campaignID, func(r *Room) {
		r.broadcastAll(OutEnvelope{Type: "document.deleted", Payload: map[string]any{"documentId": docID}})
	})
}

func (h *Hub) NotifyCharacterUpserted(campaignID string, c model.Character, created bool) {
	h.Notify(campaignID, func(r *Room) { r.broadcastCharacterUpsert(c, created) })
}

func (h *Hub) NotifyCharacterDeleted(campaignID, charID string) {
	h.Notify(campaignID, func(r *Room) {
		r.broadcastAll(OutEnvelope{Type: "character.deleted", Payload: map[string]any{"characterId": charID}})
	})
}

func (h *Hub) NotifySceneUpserted(campaignID string, sc model.Scene, created bool) {
	h.Notify(campaignID, func(r *Room) { r.broadcastSceneUpsert(sc, created) })
}

func (h *Hub) NotifySceneDeleted(campaignID, sceneID string) {
	h.Notify(campaignID, func(r *Room) {
		r.broadcastAll(OutEnvelope{Type: "scene.deleted", Payload: map[string]any{"sceneId": sceneID}})
	})
}

func (h *Hub) NotifySceneActivated(campaignID string, sc model.Scene) {
	h.Notify(campaignID, func(r *Room) { r.broadcastSceneActivated(sc) })
}

func (h *Hub) NotifyMacroUpserted(campaignID string, mc model.Macro) {
	h.Notify(campaignID, func(r *Room) { r.broadcastMacroUpsert(mc) })
}

func (h *Hub) NotifyMacroDeleted(campaignID, macroID string) {
	h.Notify(campaignID, func(r *Room) {
		r.broadcastAll(OutEnvelope{Type: "macro.deleted", Payload: map[string]any{"macroId": macroID}})
	})
}

func (h *Hub) NotifyVoiceChannelsChanged(campaignID string) {
	h.Notify(campaignID, func(r *Room) { r.broadcastVoiceState() })
}

func (h *Hub) UpdateMemberRole(campaignID, userID string, role model.MemberRole) {
	h.Notify(campaignID, func(r *Room) {
		for _, c := range r.clients {
			if c.userID == userID {
				c.role = role
			}
		}
		r.broadcastPresence()
	})
}

// Client represents a single WebSocket connection in a campaign room.
type Client struct {
	id          string
	userID      string
	displayName string
	avatarURL   string
	role        model.MemberRole
	conn        *websocket.Conn
	send        chan OutEnvelope
	done        chan struct{}
	closeOnce   sync.Once
}

func (c *Client) close() {
	c.closeOnce.Do(func() { close(c.done) })
}

func (c *Client) writer(r *Room) {
	defer c.close()
	for {
		select {
		case msg := <-c.send:
			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
			err := wsjson.Write(ctx, c.conn, msg)
			cancel()
			if err != nil {
				return
			}
		case <-c.done:
			return
		case <-r.done:
			return
		}
	}
}

func (c *Client) reader(ctx context.Context, r *Room) {
	defer func() {
		c.close()
		r.enqueue(roomEvent{kind: evLeave, client: c})
		_ = c.conn.Close(websocket.StatusNormalClosure, "closed")
	}()
	for {
		var env WsEnvelope
		err := wsjson.Read(ctx, c.conn, &env)
		if err != nil {
			return
		}
		if !r.enqueue(roomEvent{kind: evMessage, client: c, env: env}) {
			return
		}
	}
}

func newID(prefix string) string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}

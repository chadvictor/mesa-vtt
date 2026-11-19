package hub

import (
	"context"
	"encoding/json"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
)

type voicePeer struct {
	userID      string
	clientID    string
	displayName string
	portraitURL string
	channelID   string
	muted       bool
	deafened    bool
	speaking    bool
}

func (p *voicePeer) toModel() model.VoiceParticipant {
	return model.VoiceParticipant{
		UserID:      p.userID,
		DisplayName: p.displayName,
		PortraitURL: p.portraitURL,
		Muted:       p.muted,
		Deafened:    p.deafened,
		Speaking:    p.speaking,
	}
}

// handleVoiceJoin adds or moves the client into a campaign voice channel and broadcasts voice.state.
// Per ARCHITECTURE.md Section 6.1, the newly joined peer receives the list of existing channel peers
// and initiates glare-free WebRTC offers to each of them.
func (r *Room) handleVoiceJoin(c *Client, env WsEnvelope) {
	var in struct {
		ChannelID   string `json:"channelId"`
		PortraitURL string `json:"portraitUrl"`
		Muted       bool   `json:"muted"`
		Deafened    bool   `json:"deafened"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid voice join payload")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	channels, err := r.store.ListVoiceChannels(ctx, r.campaignID)
	if err != nil || len(channels) == 0 {
		r.sendError(c, env.RequestID, "no_voice_channels", "No voice channels available in this campaign")
		return
	}

	var target *model.VoiceChannel
	if in.ChannelID == "" {
		for i := range channels {
			if channels[i].IsDefault {
				target = &channels[i]
				break
			}
		}
		if target == nil {
			target = &channels[0]
		}
	} else {
		for i := range channels {
			if channels[i].ID == in.ChannelID {
				target = &channels[i]
				break
			}
		}
	}
	if target == nil {
		r.sendError(c, env.RequestID, "not_found", "Voice channel not found")
		return
	}
	if target.LockedForPlayers && c.role != model.RoleGM {
		r.sendError(c, env.RequestID, "forbidden", "This voice channel is locked for players")
		return
	}

	portrait := in.PortraitURL
	if portrait == "" {
		portrait = c.avatarURL
	}

	r.voice[c.userID] = &voicePeer{
		userID:      c.userID,
		clientID:    c.id,
		displayName: c.displayName,
		portraitURL: portrait,
		channelID:   target.ID,
		muted:       in.Muted,
		deafened:    in.Deafened,
		speaking:    false,
	}

	r.refreshSnapshot()
	r.broadcastVoiceState()
}

func (r *Room) handleVoiceLeave(c *Client, _ WsEnvelope) {
	if _, ok := r.voice[c.userID]; !ok {
		return
	}
	delete(r.voice, c.userID)
	r.refreshSnapshot()
	r.broadcastVoiceState()
}

func (r *Room) handleVoiceStatus(c *Client, env WsEnvelope) {
	vp, ok := r.voice[c.userID]
	if !ok {
		return
	}
	var in struct {
		Muted    *bool `json:"muted"`
		Deafened *bool `json:"deafened"`
		Speaking *bool `json:"speaking"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil {
		return
	}
	if in.Muted != nil {
		vp.muted = *in.Muted
	}
	if in.Deafened != nil {
		vp.deafened = *in.Deafened
		if vp.deafened {
			vp.muted = true
			vp.speaking = false
		}
	}
	if in.Speaking != nil {
		vp.speaking = *in.Speaking && !vp.muted && !vp.deafened
	}

	r.refreshSnapshot()
	r.broadcastAll(OutEnvelope{
		Type: "voice.participant_updated",
		Payload: map[string]any{
			"channelId":   vp.channelID,
			"participant": vp.toModel(),
		},
	})
}

// handleVoiceSignal relays WebRTC offer/answer/ice frames directly to targetUserId
// only when both peers are in the same campaign and the exact same voice channel.
func (r *Room) handleVoiceSignal(c *Client, env WsEnvelope) {
	var in struct {
		TargetUserID string          `json:"targetUserId"`
		Kind         string          `json:"kind"` // "offer" | "answer" | "ice"
		SDP          any             `json:"sdp,omitempty"`
		Candidate    json.RawMessage `json:"candidate,omitempty"`
	}
	if err := json.Unmarshal(env.Payload, &in); err != nil || in.TargetUserID == "" {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid voice signal payload")
		return
	}
	if in.Kind != "offer" && in.Kind != "answer" && in.Kind != "ice" {
		r.sendError(c, env.RequestID, "bad_payload", "Invalid voice signal kind")
		return
	}

	senderPeer, ok := r.voice[c.userID]
	if !ok {
		r.sendError(c, env.RequestID, "not_in_voice", "Join a voice channel before signaling")
		return
	}
	targetPeer, ok := r.voice[in.TargetUserID]
	if !ok || targetPeer.channelID != senderPeer.channelID {
		// Peer may have just left or switched channels; ignore gracefully.
		return
	}

	payload := map[string]any{
		"fromUserId": c.userID,
		"kind":       in.Kind,
	}
	if in.SDP != nil {
		payload["sdp"] = in.SDP
	}
	if len(in.Candidate) > 0 && string(in.Candidate) != "null" {
		payload["candidate"] = in.Candidate
	}

	out := OutEnvelope{
		Type:    "voice.signal",
		Payload: payload,
	}
	if targetClient, ok := r.clients[targetPeer.clientID]; ok {
		r.sendTo(targetClient, out)
		return
	}
	for _, cl := range r.clients {
		if cl.userID == targetPeer.userID {
			r.sendTo(cl, out)
		}
	}
}

func (r *Room) broadcastVoiceState() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	channels, err := r.store.ListVoiceChannels(ctx, r.campaignID)
	if err != nil {
		return
	}

	// Evict peers whose channel was deleted
	validCh := make(map[string]bool, len(channels))
	for _, ch := range channels {
		validCh[ch.ID] = true
	}
	changed := false
	for uid, peer := range r.voice {
		if !validCh[peer.channelID] {
			delete(r.voice, uid)
			changed = true
		}
	}
	if changed {
		r.refreshSnapshot()
	}

	channels = r.attachVoiceParticipants(channels)
	r.broadcastAll(OutEnvelope{
		Type:    "voice.state",
		Payload: map[string]any{"channels": channels},
	})
}

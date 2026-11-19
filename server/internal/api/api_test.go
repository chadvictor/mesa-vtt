package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/chadvictor/mesa-vtt/server/internal/api"
	"github.com/chadvictor/mesa-vtt/server/internal/auth"
	"github.com/chadvictor/mesa-vtt/server/internal/config"
	"github.com/chadvictor/mesa-vtt/server/internal/hub"
	"github.com/chadvictor/mesa-vtt/server/internal/model"
	"github.com/chadvictor/mesa-vtt/server/internal/seed"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

type pipeAddr string

func (a pipeAddr) Network() string { return "pipe" }
func (a pipeAddr) String() string  { return string(a) }

// pipeListener is an in-memory net.Listener using net.Pipe() so full HTTP + WebSocket
// integration tests run without binding TCP ports.
type pipeListener struct {
	conns  chan net.Conn
	closed chan struct{}
	once   sync.Once
}

func newPipeListener() *pipeListener {
	return &pipeListener{
		conns:  make(chan net.Conn, 32),
		closed: make(chan struct{}),
	}
}

func (l *pipeListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.conns:
		return c, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *pipeListener) Close() error {
	l.once.Do(func() { close(l.closed) })
	return nil
}

func (l *pipeListener) Addr() net.Addr { return pipeAddr("in-memory") }

func (l *pipeListener) DialContext(_ context.Context, _, _ string) (net.Conn, error) {
	serverConn, clientConn := net.Pipe()
	select {
	case l.conns <- serverConn:
		return clientConn, nil
	case <-l.closed:
		_ = serverConn.Close()
		_ = clientConn.Close()
		return nil, net.ErrClosed
	}
}

type testEnv struct {
	ts     *httptest.Server
	client *http.Client
	store  *store.FileStore
	hub    *hub.Hub
	server *api.Server
	dbPath string
}

func newInMemoryServer(t *testing.T, handler http.Handler) (*httptest.Server, *http.Client) {
	t.Helper()
	ln := newPipeListener()
	ts := httptest.NewUnstartedServer(handler)
	ts.Listener = ln
	ts.Start()
	ts.URL = "http://mesa.local"
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: ln.DialContext,
		},
	}
	t.Cleanup(func() {
		client.CloseIdleConnections()
		ts.Close()
	})
	return ts, client
}

func newTestEnv(t *testing.T, authMode string, ticketURL, authToken string, ssoClient *http.Client) *testEnv {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "mesa-test.json")
	st, err := store.NewFileStore(dbPath)
	if err != nil {
		t.Fatalf("NewFileStore: %v", err)
	}
	if err := seed.EnsureSeeded(context.Background(), st); err != nil {
		t.Fatalf("EnsureSeeded: %v", err)
	}
	cfg := config.Config{
		ListenAddress:     ":0",
		DataFile:          dbPath,
		AuthMode:          authMode,
		ExternalTicketURL: ticketURL,
		ExternalAuthToken: authToken,
		SessionSecret:     "test-secret-key-32-bytes-minimum-ok!",
		OriginPatterns:    []string{"*"},
		ICEServers:        []config.ICEServer{{URLs: "stun:stun.l.google.com:19302"}},
	}
	authSvc := auth.NewService(cfg.SessionSecret, cfg.LocalAuthEnabled(), cfg.ExternalTicketURL, cfg.ExternalAuthToken)
	if ssoClient != nil {
		authSvc.HTTPClient = ssoClient
	}
	h := hub.New(st)
	srv := api.NewServer(cfg, st, authSvc, h)
	ts, client := newInMemoryServer(t, srv.Handler)
	t.Cleanup(func() {
		h.Close()
		_ = st.Close()
	})
	return &testEnv{ts: ts, client: client, store: st, hub: h, server: srv, dbPath: dbPath}
}

func doJSON(t *testing.T, client *http.Client, method, url, token string, body any) (*http.Response, []byte) {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, r)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("do request %s %s: %v", method, url, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, raw
}

func loginLocal(t *testing.T, env *testEnv, displayName string) (string, model.UserIdentity) {
	t.Helper()
	resp, raw := doJSON(t, env.client, http.MethodPost, env.ts.URL+"/api/v1/auth/local", "", map[string]string{
		"displayName": displayName,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("loginLocal(%s) status=%d body=%s", displayName, resp.StatusCode, string(raw))
	}
	var out struct {
		Token string             `json:"token"`
		User  model.UserIdentity `json:"user"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal login: %v", err)
	}
	return out.Token, out.User
}

func joinByCode(t *testing.T, env *testEnv, token, code string, desiredRole model.MemberRole) (model.Campaign, model.CampaignMember) {
	t.Helper()
	resp, raw := doJSON(t, env.client, http.MethodPost, env.ts.URL+"/api/v1/campaigns/join", token, map[string]any{
		"inviteCode":  code,
		"desiredRole": desiredRole,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("joinByCode(%s) status=%d body=%s", code, resp.StatusCode, string(raw))
	}
	var out struct {
		Campaign model.Campaign       `json:"campaign"`
		Member   model.CampaignMember `json:"member"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal join: %v", err)
	}
	return out.Campaign, out.Member
}

type wsTestClient struct {
	conn   *websocket.Conn
	events chan hub.WsEnvelope
}

func dialWS(t *testing.T, env *testEnv, token, campaignID string) *wsTestClient {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(env.ts.URL, "http") + "/ws?token=" + token + "&campaignId=" + campaignID
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPClient: env.client})
	if err != nil {
		t.Fatalf("dialWS: %v", err)
	}
	tc := &wsTestClient{
		conn:   conn,
		events: make(chan hub.WsEnvelope, 64),
	}
	go func() {
		defer close(tc.events)
		for {
			var env hub.WsEnvelope
			if err := wsjson.Read(context.Background(), conn, &env); err != nil {
				return
			}
			tc.events <- env
		}
	}()
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "test done") })
	return tc
}

func (tc *wsTestClient) send(t *testing.T, msg hub.OutEnvelope) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, tc.conn, msg); err != nil {
		t.Fatalf("ws write %s: %v", msg.Type, err)
	}
}

func readUntilType(t *testing.T, tc *wsTestClient, wantType string, timeout time.Duration) hub.WsEnvelope {
	t.Helper()
	return readUntilMatch(t, tc, wantType, nil, timeout)
}

func readUntilMatch(t *testing.T, tc *wsTestClient, wantType string, match func(hub.WsEnvelope) bool, timeout time.Duration) hub.WsEnvelope {
	t.Helper()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case env, ok := <-tc.events:
			if !ok {
				t.Fatalf("WS closed while waiting for %q", wantType)
			}
			if env.Type == wantType && (match == nil || match(env)) {
				return env
			}
		case <-timer.C:
			t.Fatalf("timed out waiting for WS event %q", wantType)
		}
	}
}

func assertNoEventType(t *testing.T, tc *wsTestClient, forbiddenType string, wait time.Duration) {
	t.Helper()
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case env, ok := <-tc.events:
			if !ok {
				return
			}
			if env.Type == forbiddenType {
				t.Fatalf("SECURITY LEAK: received forbidden WS event %q: %s", forbiddenType, string(env.Payload))
			}
		case <-timer.C:
			return
		}
	}
}

func TestHealthConfigCompendiumAndSSOTicketAuth(t *testing.T) {
	// Mock external SSO ticket consume endpoint
	authToken := "0123456789abcdef0123456789abcdef0123456789abcdef"
	ssoMock, ssoClient := newInMemoryServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+authToken {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var in struct {
			Ticket string `json:"ticket"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in.Ticket != "valid-sso-ticket" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":           "sso_u_42",
			"display_name": "Victor",
			"room_id":      "DRAKON",
			"create":       false,
			"is_admin":     true,
		})
	}))

	env := newTestEnv(t, config.AuthModeSSO, ssoMock.URL, authToken, ssoClient)

	// Healthcheck
	resp, _ := doJSON(t, env.client, http.MethodGet, env.ts.URL+"/healthz", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/healthz expected 200, got %d", resp.StatusCode)
	}

	// Public config
	resp, raw := doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/config", "", nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(raw), "mighty-blade-3e") || !strings.Contains(string(raw), `"authMode":"sso"`) {
		t.Fatalf("/api/v1/config unexpected: %d %s", resp.StatusCode, string(raw))
	}

	// Local login MUST be forbidden when AUTH_MODE=sso
	resp, _ = doJSON(t, env.client, http.MethodPost, env.ts.URL+"/api/v1/auth/local", "", map[string]string{"displayName": "Hacker"})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for local login in SSO mode, got %d", resp.StatusCode)
	}

	// SSO ticket auth succeeds
	resp, raw = doJSON(t, env.client, http.MethodPost, env.ts.URL+"/api/v1/auth/sso-ticket", "", map[string]any{
		"ticket": "valid-sso-ticket",
		"roomId": "DRAKON",
		"create": false,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("sso-ticket failed: %d %s", resp.StatusCode, string(raw))
	}
	var authOut struct {
		Token        string             `json:"token"`
		User         model.UserIdentity `json:"user"`
		LaunchRoomID string             `json:"launchRoomId"`
	}
	_ = json.Unmarshal(raw, &authOut)
	if authOut.User.ID != "sso_u_42" || authOut.User.Source != "sso" || authOut.LaunchRoomID != "DRAKON" {
		t.Fatalf("unexpected sso auth output: %+v", authOut)
	}

	// /api/v1/auth/me works with bearer token
	resp, raw = doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/auth/me", authOut.Token, nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(raw), "Victor") {
		t.Fatalf("/auth/me failed: %d %s", resp.StatusCode, string(raw))
	}

	// Compendium endpoint serves embedded Mighty Blade 3e JSONs
	resp, raw = doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/compendium/mighty-blade-3e/rules", "", nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(raw), "mighty-blade-3e") {
		t.Fatalf("compendium rules failed: %d %s", resp.StatusCode, string(raw))
	}
}

func TestVisibilitySecurityRESTAndWebSocket(t *testing.T) {
	env := newTestEnv(t, config.AuthModeLocal, "", "", nil)

	gmTok, _ := loginLocal(t, env, "Mestre")
	p1Tok, p1User := loginLocal(t, env, "Jogador 1")
	p2Tok, _ := loginLocal(t, env, "Jogador 2")

	camp, gmMember := joinByCode(t, env, gmTok, "DRAKON", model.RoleGM)
	if gmMember.Role != model.RoleGM {
		t.Fatalf("expected GM role, got %s", gmMember.Role)
	}
	_, p1Member := joinByCode(t, env, p1Tok, "DRAKON", model.RolePlayer)
	if p1Member.Role != model.RolePlayer {
		t.Fatalf("expected player role, got %s", p1Member.Role)
	}
	joinByCode(t, env, p2Tok, "DRAKON", model.RolePlayer)

	// 1. REST bootstrap visibility check: GM vs Player
	resp, gmRaw := doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/campaigns/"+camp.ID+"/state", gmTok, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GM state failed: %d", resp.StatusCode)
	}
	var gmState model.CampaignState
	_ = json.Unmarshal(gmRaw, &gmState)

	resp, p1Raw := doJSON(t, env.client, http.MethodGet, env.ts.URL+"/api/v1/campaigns/"+camp.ID+"/state", p1Tok, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("P1 state failed: %d", resp.StatusCode)
	}
	var p1State model.CampaignState
	_ = json.Unmarshal(p1Raw, &p1State)

	// Verify GM sees secrets
	if !strings.Contains(string(gmRaw), "Segredos do Mestre") || !strings.Contains(string(gmRaw), "tok_goblin_ambush_gm") || !strings.Contains(string(gmRaw), "scene_castle") {
		t.Fatalf("GM state missing expected GM-only items")
	}
	// Verify Player wire JSON NEVER contains any GM-only folder, doc, scene, monster, or GM-layer token!
	for _, secret := range []string{
		"Segredos do Mestre",
		"Conspiração do Culto Carmesim",
		"Armadilhas da Cripta",
		"tok_goblin_ambush_gm",
		"tok_crypt_skel_gm",
		"scene_castle",
		"Pátio do Castelo de Drakon",
		"mob_skeleton_warrior",
	} {
		if strings.Contains(string(p1Raw), secret) {
			t.Fatalf("WIRE SECURITY LEAK: player REST state contained %q", secret)
		}
	}

	// 2. Connect GM, Player 1, and Player 2 over WebSocket
	gmWS := dialWS(t, env, gmTok, camp.ID)
	p1WS := dialWS(t, env, p1Tok, camp.ID)
	p2WS := dialWS(t, env, p2Tok, camp.ID)

	readUntilType(t, gmWS, "welcome", 3*time.Second)
	p1Welcome := readUntilType(t, p1WS, "welcome", 3*time.Second)
	if strings.Contains(string(p1Welcome.Payload), "tok_goblin_ambush_gm") || strings.Contains(string(p1Welcome.Payload), "Segredos do Mestre") {
		t.Fatalf("WIRE SECURITY LEAK: WS welcome leaked GM secret to player")
	}
	readUntilType(t, p2WS, "welcome", 3*time.Second)

	// 3. Secret GM roll MUST go to GM only, NEVER to Player 1
	gmWS.send(t, hub.OutEnvelope{
		Type: "dice.roll",
		Payload: map[string]any{
			"formula":    "2d6+4",
			"label":      "Rolagem Secreta do Mestre",
			"visibility": "gm_only",
		},
	})
	gmRollEnv := readUntilType(t, gmWS, "dice.result", 3*time.Second)
	if !strings.Contains(string(gmRollEnv.Payload), "Rolagem Secreta do Mestre") {
		t.Fatalf("expected GM to receive secret dice.result, got %s", string(gmRollEnv.Payload))
	}
	assertNoEventType(t, p1WS, "dice.result", 250*time.Millisecond)

	// 4. Private whisper from GM to Player 1 MUST reach GM & Player 1, NEVER Player 2
	gmWS.send(t, hub.OutEnvelope{
		Type: "chat.send",
		Payload: map[string]any{
			"kind":             "whisper",
			"content":          "Sussurro secreto apenas para Jogador 1",
			"visibility":       "specific_players",
			"visibleToUserIds": []string{p1User.ID},
		},
	})
	p1Msg := readUntilType(t, p1WS, "chat.message", 3*time.Second)
	if !strings.Contains(string(p1Msg.Payload), "Sussurro secreto apenas para Jogador 1") {
		t.Fatalf("expected P1 to receive whisper, got %s", string(p1Msg.Payload))
	}
	assertNoEventType(t, p2WS, "chat.message", 250*time.Millisecond)

	// 5. GM-layer token creation MUST NOT leak to players; revealing flips to token.created; hiding flips to token.deleted
	gmWS.send(t, hub.OutEnvelope{
		Type: "token.create",
		Payload: map[string]any{
			"sceneId": seed.DemoSceneTavern,
			"token": map[string]any{
				"id":       "tok_secret_trap",
				"name":     "Armadilha Secreta",
				"imageUrl": "./assets/monsters/goblin-raider.svg",
				"x":        5,
				"y":        5,
				"layer":    "gm",
			},
		},
	})
	readUntilType(t, gmWS, "token.created", 3*time.Second)
	assertNoEventType(t, p1WS, "token.created", 250*time.Millisecond)

	// Reveal token to players
	gmWS.send(t, hub.OutEnvelope{
		Type: "token.update",
		Payload: map[string]any{
			"sceneId": seed.DemoSceneTavern,
			"tokenId": "tok_secret_trap",
			"patch":   map[string]any{"layer": "tokens"},
		},
	})
	p1Revealed := readUntilType(t, p1WS, "token.created", 3*time.Second)
	if !strings.Contains(string(p1Revealed.Payload), "tok_secret_trap") {
		t.Fatalf("expected P1 to receive token.created on reveal, got %s", string(p1Revealed.Payload))
	}

	// Hide token again -> player gets token.deleted
	gmWS.send(t, hub.OutEnvelope{
		Type: "token.update",
		Payload: map[string]any{
			"sceneId": seed.DemoSceneTavern,
			"tokenId": "tok_secret_trap",
			"patch":   map[string]any{"layer": "gm"},
		},
	})
	p1Hidden := readUntilType(t, p1WS, "token.deleted", 3*time.Second)
	if !strings.Contains(string(p1Hidden.Payload), "tok_secret_trap") {
		t.Fatalf("expected P1 to receive token.deleted on hide, got %s", string(p1Hidden.Payload))
	}
}

func TestCampaignCRUDCharacterCombatAndVoiceSignaling(t *testing.T) {
	env := newTestEnv(t, config.AuthModeLocal, "", "", nil)

	gmTok, gmUser := loginLocal(t, env, "Mestre Voz")
	p1Tok, p1User := loginLocal(t, env, "Alice")
	p2Tok, _ := loginLocal(t, env, "Bob")

	// Create custom campaign
	resp, raw := doJSON(t, env.client, http.MethodPost, env.ts.URL+"/api/v1/campaigns", gmTok, map[string]any{
		"name":        "Mesa de Testes",
		"systemId":    "generic-rpg",
		"description": "Campanha criada via teste",
		"privacy":     "public",
		"inviteCode":  "TEST99",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create campaign failed: %d %s", resp.StatusCode, string(raw))
	}
	var createOut struct {
		Campaign model.Campaign `json:"campaign"`
	}
	_ = json.Unmarshal(raw, &createOut)
	campID := createOut.Campaign.ID
	defaultVC := createOut.Campaign.Settings.DefaultVoiceChannelID

	// Players join by invite code
	joinByCode(t, env, p1Tok, "TEST99", model.RolePlayer)
	joinByCode(t, env, p2Tok, "TEST99", model.RolePlayer)

	// Player 1 creates own PC
	resp, raw = doJSON(t, env.client, http.MethodPost, env.ts.URL+"/api/v1/campaigns/"+campID+"/characters", p1Tok, map[string]any{
		"name": "Alice Heroína",
		"kind": "pc",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create char failed: %d %s", resp.StatusCode, string(raw))
	}
	var charOut struct {
		Character model.Character `json:"character"`
	}
	_ = json.Unmarshal(raw, &charOut)

	// Connect WS
	gmWS := dialWS(t, env, gmTok, campID)
	p1WS := dialWS(t, env, p1Tok, campID)
	p2WS := dialWS(t, env, p2Tok, campID)
	readUntilType(t, gmWS, "welcome", 3*time.Second)
	readUntilType(t, p1WS, "welcome", 3*time.Second)
	readUntilType(t, p2WS, "welcome", 3*time.Second)

	// Character patch by owner over WS
	p1WS.send(t, hub.OutEnvelope{
		Type: "character.patch",
		Payload: map[string]any{
			"characterId": charOut.Character.ID,
			"patch": map[string]any{
				"resources": map[string]any{
					"pv": map[string]any{"current": 45, "max": 60},
				},
			},
		},
	})
	chUpd := readUntilType(t, gmWS, "character.updated", 3*time.Second)
	if !strings.Contains(string(chUpd.Payload), `"current":45`) {
		t.Fatalf("expected updated HP 45, got %s", string(chUpd.Payload))
	}

	// Combat tracker: GM adds 1 visible + 1 hidden combatant, starts combat, advances turn
	gmWS.send(t, hub.OutEnvelope{
		Type: "combat.update",
		Payload: map[string]any{
			"op": "add",
			"combatant": map[string]any{
				"id":         "cmb_alice",
				"name":       "Alice Heroína",
				"initiative": 13,
				"hidden":     false,
			},
		},
	})
	readUntilType(t, gmWS, "combat.updated", 3*time.Second)
	readUntilType(t, p1WS, "combat.updated", 3*time.Second)

	gmWS.send(t, hub.OutEnvelope{
		Type: "combat.update",
		Payload: map[string]any{
			"op": "add",
			"combatant": map[string]any{
				"id":         "cmb_secret_lich",
				"name":       "Lich Oculto",
				"initiative": 18,
				"hidden":     true,
			},
		},
	})
	gmCombat := readUntilType(t, gmWS, "combat.updated", 3*time.Second)
	p1Combat := readUntilType(t, p1WS, "combat.updated", 3*time.Second)
	if !strings.Contains(string(gmCombat.Payload), "Lich Oculto") {
		t.Fatalf("GM should see hidden combatant")
	}
	if strings.Contains(string(p1Combat.Payload), "Lich Oculto") {
		t.Fatalf("WIRE SECURITY LEAK: player saw hidden combatant: %s", string(p1Combat.Payload))
	}

	// WebRTC Voice channel join + offer/answer/ice relay + status + leave
	gmWS.send(t, hub.OutEnvelope{
		Type:    "voice.join",
		Payload: map[string]any{"channelId": defaultVC},
	})
	readUntilType(t, gmWS, "voice.state", 3*time.Second)
	readUntilType(t, p1WS, "voice.state", 3*time.Second)

	p1WS.send(t, hub.OutEnvelope{
		Type:    "voice.join",
		Payload: map[string]any{"channelId": defaultVC},
	})
	vState := readUntilMatch(t, p1WS, "voice.state", func(e hub.WsEnvelope) bool {
		return strings.Contains(string(e.Payload), p1User.ID)
	}, 3*time.Second)
	if !strings.Contains(string(vState.Payload), gmUser.ID) || !strings.Contains(string(vState.Payload), p1User.ID) {
		t.Fatalf("voice.state should list both GM and P1, got %s", string(vState.Payload))
	}
	readUntilMatch(t, gmWS, "voice.state", func(e hub.WsEnvelope) bool {
		return strings.Contains(string(e.Payload), p1User.ID)
	}, 3*time.Second)

	// Joiner (P1) sends WebRTC offer to existing peer (GM)
	p1WS.send(t, hub.OutEnvelope{
		Type: "voice.signal",
		Payload: map[string]any{
			"targetUserId": gmUser.ID,
			"kind":         "offer",
			"sdp":          map[string]any{"type": "offer", "sdp": "v=0 fake-sdp"},
		},
	})
	sigOffer := readUntilType(t, gmWS, "voice.signal", 3*time.Second)
	if !strings.Contains(string(sigOffer.Payload), p1User.ID) || !strings.Contains(string(sigOffer.Payload), "fake-sdp") {
		t.Fatalf("GM did not receive expected offer signal: %s", string(sigOffer.Payload))
	}
	// Bob (not in voice) MUST NOT receive the signal
	assertNoEventType(t, p2WS, "voice.signal", 200*time.Millisecond)

	// GM replies with answer
	gmWS.send(t, hub.OutEnvelope{
		Type: "voice.signal",
		Payload: map[string]any{
			"targetUserId": p1User.ID,
			"kind":         "answer",
			"sdp":          map[string]any{"type": "answer", "sdp": "v=0 answer-sdp"},
		},
	})
	sigAns := readUntilType(t, p1WS, "voice.signal", 3*time.Second)
	if !strings.Contains(string(sigAns.Payload), "answer-sdp") {
		t.Fatalf("P1 did not receive expected answer signal: %s", string(sigAns.Payload))
	}

	// Voice status mute forces speaking=false
	p1WS.send(t, hub.OutEnvelope{
		Type:    "voice.status",
		Payload: map[string]any{"muted": true, "speaking": true},
	})
	vUpd := readUntilType(t, gmWS, "voice.participant_updated", 3*time.Second)
	if !strings.Contains(string(vUpd.Payload), `"muted":true`) || !strings.Contains(string(vUpd.Payload), `"speaking":false`) {
		t.Fatalf("expected muted=true & speaking=false, got %s", string(vUpd.Payload))
	}

	// Leave voice
	p1WS.send(t, hub.OutEnvelope{Type: "voice.leave", Payload: map[string]any{}})
	vAfterLeave := readUntilMatch(t, gmWS, "voice.state", func(e hub.WsEnvelope) bool {
		return !strings.Contains(string(e.Payload), p1User.ID)
	}, 3*time.Second)
	if strings.Contains(string(vAfterLeave.Payload), p1User.ID) {
		t.Fatalf("P1 should have been removed from voice.state: %s", string(vAfterLeave.Payload))
	}

	// Image upload validation: valid PNG succeeds, script-injected SVG rejected
	upload := func(filename string, data []byte) *http.Response {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		part, _ := mw.CreateFormFile("file", filename)
		_, _ = part.Write(data)
		_ = mw.Close()
		req, _ := http.NewRequest(http.MethodPost, env.ts.URL+"/api/v1/campaigns/"+campID+"/upload", &body)
		req.Header.Set("Authorization", "Bearer "+gmTok)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		r, err := env.client.Do(req)
		if err != nil {
			t.Fatalf("upload: %v", err)
		}
		return r
	}
	pngHeader := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
	rPNG := upload("map.png", pngHeader)
	rPNG.Body.Close()
	if rPNG.StatusCode != http.StatusOK {
		t.Fatalf("valid PNG upload expected 200, got %d", rPNG.StatusCode)
	}
	rBadSVG := upload("evil.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))
	rBadSVG.Body.Close()
	if rBadSVG.StatusCode != http.StatusBadRequest {
		t.Fatalf("malicious SVG expected 400, got %d", rBadSVG.StatusCode)
	}

	// Verify atomic FileStore persistence survives reload
	reloaded, err := store.NewFileStore(env.dbPath)
	if err != nil {
		t.Fatalf("reload FileStore: %v", err)
	}
	gotCamp, err := reloaded.GetCampaignByInviteCode(context.Background(), "TEST99")
	if err != nil || gotCamp.Name != "Mesa de Testes" {
		t.Fatalf("reloaded campaign mismatch: err=%v camp=%+v", err, gotCamp)
	}
}

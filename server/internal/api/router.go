package api

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/chadvictor/mesa-vtt/server/internal/auth"
	"github.com/chadvictor/mesa-vtt/server/internal/config"
	"github.com/chadvictor/mesa-vtt/server/internal/hub"
	"github.com/chadvictor/mesa-vtt/server/internal/model"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

type Server struct {
	Config  config.Config
	Store   store.Store
	Auth    *auth.Service
	Hub     *hub.Hub
	Handler http.Handler

	limiter *rateLimiter
}

func NewServer(cfg config.Config, st store.Store, authSvc *auth.Service, h *hub.Hub) *Server {
	s := &Server{
		Config:  cfg,
		Store:   st,
		Auth:    authSvc,
		Hub:     h,
		limiter: newRateLimiter(),
	}
	s.Handler = s.buildHandler()
	return s
}

func (s *Server) buildHandler() http.Handler {
	mux := http.NewServeMux()

	// Public routes
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /api/v1/config", s.handlePublicConfig)
	mux.HandleFunc("POST /api/v1/auth/sso-ticket", s.handleSSOTicket)
	mux.HandleFunc("POST /api/v1/auth/local", s.handleLocalLogin)

	// Authenticated routes
	mux.HandleFunc("GET /api/v1/auth/me", s.requireAuth(s.handleMe))

	// Compendium & optional AI image generation
	mux.HandleFunc("GET /api/v1/compendium/{systemId}", s.handleCompendiumAll)
	mux.HandleFunc("GET /api/v1/compendium/{systemId}/{category}", s.handleCompendiumCategory)
	mux.HandleFunc("POST /api/v1/ai/generate-image", s.requireAuth(s.handleGenerateAIImage))

	// Campaigns
	mux.HandleFunc("GET /api/v1/campaigns", s.requireAuth(s.handleListCampaigns))
	mux.HandleFunc("POST /api/v1/campaigns", s.requireAuth(s.handleCreateCampaign))
	mux.HandleFunc("POST /api/v1/campaigns/join", s.requireAuth(s.handleJoinCampaign))
	mux.HandleFunc("GET /api/v1/campaigns/{id}/state", s.requireMember(s.handleGetCampaignState))
	mux.HandleFunc("PATCH /api/v1/campaigns/{id}", s.requireGM(s.handleUpdateCampaign))
	mux.HandleFunc("DELETE /api/v1/campaigns/{id}", s.requireGM(s.handleDeleteCampaign))
	mux.HandleFunc("PATCH /api/v1/campaigns/{id}/members/{uid}", s.requireGM(s.handleUpdateMemberRole))

	// Folders
	mux.HandleFunc("POST /api/v1/campaigns/{id}/folders", s.requireGM(s.handleCreateFolder))
	mux.HandleFunc("PATCH /api/v1/campaigns/{id}/folders/{fid}", s.requireGM(s.handleUpdateFolder))
	mux.HandleFunc("DELETE /api/v1/campaigns/{id}/folders/{fid}", s.requireGM(s.handleDeleteFolder))

	// Documents
	mux.HandleFunc("POST /api/v1/campaigns/{id}/documents", s.requireMember(s.handleCreateDocument))
	mux.HandleFunc("PATCH /api/v1/campaigns/{id}/documents/{did}", s.requireMember(s.handleUpdateDocument))
	mux.HandleFunc("DELETE /api/v1/campaigns/{id}/documents/{did}", s.requireMember(s.handleDeleteDocument))

	// Characters
	mux.HandleFunc("POST /api/v1/campaigns/{id}/characters", s.requireMember(s.handleCreateCharacter))
	mux.HandleFunc("PATCH /api/v1/campaigns/{id}/characters/{cid}", s.requireMember(s.handleUpdateCharacter))
	mux.HandleFunc("DELETE /api/v1/campaigns/{id}/characters/{cid}", s.requireMember(s.handleDeleteCharacter))

	// Scenes
	mux.HandleFunc("POST /api/v1/campaigns/{id}/scenes", s.requireGM(s.handleCreateScene))
	mux.HandleFunc("PATCH /api/v1/campaigns/{id}/scenes/{sid}", s.requireGM(s.handleUpdateScene))
	mux.HandleFunc("DELETE /api/v1/campaigns/{id}/scenes/{sid}", s.requireGM(s.handleDeleteScene))

	// Macros
	mux.HandleFunc("POST /api/v1/campaigns/{id}/macros", s.requireMember(s.handleCreateMacro))
	mux.HandleFunc("PATCH /api/v1/campaigns/{id}/macros/{mid}", s.requireMember(s.handleUpdateMacro))
	mux.HandleFunc("DELETE /api/v1/campaigns/{id}/macros/{mid}", s.requireMember(s.handleDeleteMacro))

	// Voice Channels
	mux.HandleFunc("POST /api/v1/campaigns/{id}/voice-channels", s.requireGM(s.handleCreateVoiceChannel))
	mux.HandleFunc("DELETE /api/v1/campaigns/{id}/voice-channels/{vcid}", s.requireGM(s.handleDeleteVoiceChannel))

	// Media upload
	mux.HandleFunc("POST /api/v1/campaigns/{id}/upload", s.requireMember(s.handleUploadImage))

	// WebSocket
	mux.HandleFunc("GET /ws", s.handleWebSocket)

	// Optional static SPA serving
	if s.Config.StaticDir != "" {
		mux.Handle("/", spaFileServer(s.Config.StaticDir))
	}

	return s.corsMiddleware(mux)
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handlePublicConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"authMode":         s.Config.AuthMode,
		"localAuthEnabled": s.Config.LocalAuthEnabled(),
		"iceServers":       s.Config.ICEServers,
		"systems":          []string{"mighty-blade-3e", "generic-rpg"},
		"aiImageEnabled":   s.Config.GeminiAPIKey != "",
	})
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	user, err := s.Auth.AuthenticateRequest(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Autenticação necessária")
		return
	}
	campaignID := strings.TrimSpace(r.URL.Query().Get("campaignId"))
	if campaignID == "" {
		writeError(w, http.StatusBadRequest, "missing_campaign", "campaignId é obrigatório")
		return
	}
	member, err := s.Store.GetMember(r.Context(), campaignID, user.ID)
	if err != nil {
		writeError(w, http.StatusForbidden, "not_member", "Você não é membro desta campanha")
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns:  s.Config.OriginPatterns,
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		return
	}

	s.Hub.AttachClient(context.Background(), campaignID, user, member, conn)
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if s.Config.AppOrigin != "" {
				if strings.EqualFold(origin, s.Config.AppOrigin) {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
					w.Header().Set("Access-Control-Allow-Credentials", "true")
				}
			} else if s.Config.LocalAuthEnabled() {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
		} else if s.Config.AppOrigin == "" && s.Config.LocalAuthEnabled() {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type authHandler func(w http.ResponseWriter, r *http.Request, user model.UserIdentity)
type memberHandler func(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember)

func (s *Server) requireAuth(fn authHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.Auth.AuthenticateRequest(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Sessão inválida ou expirada")
			return
		}
		fn(w, r, user)
	}
}

func (s *Server) requireMember(fn memberHandler) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request, user model.UserIdentity) {
		campaignID := r.PathValue("id")
		if campaignID == "" {
			writeError(w, http.StatusBadRequest, "missing_id", "ID da campanha obrigatório")
			return
		}
		member, err := s.Store.GetMember(r.Context(), campaignID, user.ID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusForbidden, "not_member", "Acesso restrito a membros da campanha")
				return
			}
			writeError(w, http.StatusInternalServerError, "store_error", "Erro ao verificar permissão")
			return
		}
		fn(w, r, user, member)
	})
}

func (s *Server) requireGM(fn memberHandler) http.HandlerFunc {
	return s.requireMember(func(w http.ResponseWriter, r *http.Request, user model.UserIdentity, member model.CampaignMember) {
		if member.Role != model.RoleGM {
			writeError(w, http.StatusForbidden, "gm_only", "Apenas o Mestre da campanha pode executar esta ação")
			return
		}
		fn(w, r, user, member)
	})
}

func decodeJSON(r *http.Request, dst any, maxBytes int64) error {
	if maxBytes <= 0 {
		maxBytes = 1 << 20 // 1 MiB
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, maxBytes))
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{
		"code":    code,
		"error":   message,
		"message": message,
	})
}

func newID(prefix string) string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}

func newInviteCode() string {
	var b [5]byte
	_, _ = rand.Read(b[:])
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:])[:6]
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func spaFileServer(dir string) http.Handler {
	absDir, _ := filepath.Abs(dir)
	fs := http.FileServer(http.Dir(absDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/ws" || r.URL.Path == "/healthz" {
			http.NotFound(w, r)
			return
		}
		clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
		target := filepath.Join(absDir, clean)
		if info, err := os.Stat(target); err == nil && !info.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		indexPath := filepath.Join(absDir, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			http.ServeFile(w, r, indexPath)
			return
		}
		http.NotFound(w, r)
	})
}

// Simple in-memory fixed-window rate limiter.
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	count int
	reset time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{buckets: make(map[string]*bucket)}
}

func (rl *rateLimiter) allow(key string, limit int, window time.Duration) bool {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()
	b, ok := rl.buckets[key]
	if !ok || now.After(b.reset) {
		rl.buckets[key] = &bucket{count: 1, reset: now.Add(window)}
		return true
	}
	if b.count >= limit {
		return false
	}
	b.count++
	return true
}

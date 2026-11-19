package api

import (
	"net/http"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/auth"
	"github.com/chadvictor/mesa-vtt/server/internal/model"
)

func (s *Server) handleSSOTicket(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow("auth:"+clientIP(r), 30, time.Minute) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Muitas tentativas de autenticação, aguarde um instante.")
		return
	}

	var in struct {
		Ticket string `json:"ticket"`
		RoomID string `json:"roomId"`
		Create *bool  `json:"create"`
	}
	if err := decodeJSON(r, &in, 16*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}

	res, err := s.Auth.ConsumeSSOTicket(r.Context(), in.Ticket, in.RoomID, in.Create)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "ticket_invalid", err.Error())
		return
	}

	tok, err := s.Auth.IssueToken(res.User)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token_error", "Falha ao emitir token de sessão")
		return
	}
	s.setSessionCookie(w, r, tok)

	writeJSON(w, http.StatusOK, map[string]any{
		"token":        tok,
		"user":         res.User,
		"launchRoomId": res.LaunchRoomID,
		"create":       res.Create,
	})
}

func (s *Server) handleLocalLogin(w http.ResponseWriter, r *http.Request) {
	if !s.Config.LocalAuthEnabled() {
		writeError(w, http.StatusForbidden, "local_auth_disabled", "Login local desabilitado nesta instância (AUTH_MODE=sso); autentique-se pelo provedor SSO configurado.")
		return
	}
	if !s.limiter.allow("local_auth:"+clientIP(r), 40, time.Minute) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Muitas tentativas, aguarde um instante.")
		return
	}

	var in struct {
		DisplayName string `json:"displayName"`
		AvatarURL   string `json:"avatarUrl"`
	}
	if err := decodeJSON(r, &in, 16*1024); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Payload inválido")
		return
	}

	user, tok, err := s.Auth.IssueLocalUser(in.DisplayName, in.AvatarURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_profile", err.Error())
		return
	}
	s.setSessionCookie(w, r, tok)

	writeJSON(w, http.StatusOK, map[string]any{
		"token": tok,
		"user":  user,
	})
}

func (s *Server) handleMe(w http.ResponseWriter, _ *http.Request, user model.UserIdentity) {
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   int(auth.TokenTTL.Seconds()),
	})
}

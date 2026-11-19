package auth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/model"
)

const (
	CookieName = "mesa_session"
	TokenTTL   = 7 * 24 * time.Hour
)

type Service struct {
	Secret            []byte
	LocalAuthEnabled  bool
	ExternalTicketURL string
	ExternalAuthToken string
	HTTPClient        *http.Client
}

type tokenClaims struct {
	User model.UserIdentity `json:"user"`
	Iat  int64              `json:"iat"`
	Exp  int64              `json:"exp"`
}

// SSOTicketResult holds the verified identity and optional room launch intent from an external SSO provider.
type SSOTicketResult struct {
	User         model.UserIdentity
	LaunchRoomID string
	Create       bool
}

func NewService(secret string, localAuthEnabled bool, externalTicketURL, externalAuthToken string) *Service {
	return &Service{
		Secret:            []byte(secret),
		LocalAuthEnabled:  localAuthEnabled,
		ExternalTicketURL: strings.TrimSpace(externalTicketURL),
		ExternalAuthToken: strings.TrimSpace(externalAuthToken),
		HTTPClient:        &http.Client{Timeout: 6 * time.Second},
	}
}

// IssueToken signs an HMAC-SHA256 stateless bearer token for the given user.
func (s *Service) IssueToken(user model.UserIdentity) (string, error) {
	now := time.Now().UTC()
	claims := tokenClaims{
		User: user,
		Iat:  now.Unix(),
		Exp:  now.Add(TokenTTL).Unix(),
	}
	raw, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	sig := s.sign(payload)
	return payload + "." + sig, nil
}

// VerifyToken validates signature and expiry, returning the embedded UserIdentity.
func (s *Service) VerifyToken(token string) (model.UserIdentity, error) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 2 {
		return model.UserIdentity{}, errors.New("malformed token")
	}
	expected := s.sign(parts[0])
	if !hmac.Equal([]byte(parts[1]), []byte(expected)) {
		return model.UserIdentity{}, errors.New("invalid token signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return model.UserIdentity{}, errors.New("invalid token payload")
	}
	var claims tokenClaims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return model.UserIdentity{}, errors.New("invalid token claims")
	}
	if time.Now().UTC().Unix() > claims.Exp {
		return model.UserIdentity{}, errors.New("token expired")
	}
	if claims.User.ID == "" || claims.User.DisplayName == "" {
		return model.UserIdentity{}, errors.New("incomplete token identity")
	}
	return claims.User, nil
}

// ExtractToken checks Authorization: Bearer, ?token= query param, and mesa_session cookie.
func ExtractToken(r *http.Request) string {
	if authz := strings.TrimSpace(r.Header.Get("Authorization")); authz != "" {
		if tok, ok := strings.CutPrefix(authz, "Bearer "); ok {
			return strings.TrimSpace(tok)
		}
		if tok, ok := strings.CutPrefix(authz, "bearer "); ok {
			return strings.TrimSpace(tok)
		}
	}
	if q := strings.TrimSpace(r.URL.Query().Get("token")); q != "" {
		return q
	}
	if c, err := r.Cookie(CookieName); err == nil && strings.TrimSpace(c.Value) != "" {
		return strings.TrimSpace(c.Value)
	}
	return ""
}

// AuthenticateRequest extracts and verifies the bearer/cookie/query token.
func (s *Service) AuthenticateRequest(r *http.Request) (model.UserIdentity, error) {
	tok := ExtractToken(r)
	if tok == "" {
		return model.UserIdentity{}, errors.New("missing authentication token")
	}
	return s.VerifyToken(tok)
}

// IssueLocalUser creates a standalone quick-login user identity.
func (s *Service) IssueLocalUser(displayName, avatarURL string) (model.UserIdentity, string, error) {
	if !s.LocalAuthEnabled {
		return model.UserIdentity{}, "", errors.New("local login is disabled when AUTH_MODE=sso")
	}
	name := strings.TrimSpace(displayName)
	if len(name) < 2 || len(name) > 40 {
		return model.UserIdentity{}, "", errors.New("displayName must be between 2 and 40 characters")
	}
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return model.UserIdentity{}, "", err
	}
	user := model.UserIdentity{
		ID:          "local_" + hex.EncodeToString(suffix[:]),
		DisplayName: name,
		AvatarURL:   strings.TrimSpace(avatarURL),
		Source:      "local",
	}
	tok, err := s.IssueToken(user)
	if err != nil {
		return model.UserIdentity{}, "", err
	}
	return user, tok, nil
}

// ConsumeSSOTicket verifies a one-time external SSO launch ticket against EXTERNAL_TICKET_URL.
func (s *Service) ConsumeSSOTicket(ctx context.Context, ticket, roomID string, create *bool) (SSOTicketResult, error) {
	ticket = strings.TrimSpace(ticket)
	roomID = strings.ToUpper(strings.TrimSpace(roomID))
	if ticket == "" {
		return SSOTicketResult{}, errors.New("ticket is required")
	}

	// Local-mode helper supporting `dev:<name>` tickets when EXTERNAL_TICKET_URL is unset.
	if s.ExternalTicketURL == "" {
		if !s.LocalAuthEnabled {
			return SSOTicketResult{}, errors.New("external SSO ticket URL is not configured")
		}
		name, ok := strings.CutPrefix(ticket, "dev:")
		if !ok {
			return SSOTicketResult{}, errors.New("development tickets must use dev:<name>")
		}
		name = strings.TrimSpace(name)
		if len(name) < 2 || len(name) > 40 {
			return SSOTicketResult{}, errors.New("invalid development display name")
		}
		cr := false
		if create != nil {
			cr = *create
		}
		return SSOTicketResult{
			User: model.UserIdentity{
				ID:          "dev_" + strings.ToLower(strings.ReplaceAll(name, " ", "_")),
				DisplayName: name,
				Source:      "sso",
			},
			LaunchRoomID: roomID,
			Create:       cr,
		}, nil
	}

	body, _ := json.Marshal(map[string]string{"ticket": ticket})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.ExternalTicketURL, bytes.NewReader(body))
	if err != nil {
		return SSOTicketResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.ExternalAuthToken)

	client := s.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 6 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return SSOTicketResult{}, fmt.Errorf("external SSO ticket check failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return SSOTicketResult{}, errors.New("ticket rejected by SSO provider")
	}

	var result struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
		AvatarURL   string `json:"avatar_url"`
		RoomID      string `json:"room_id"`
		Create      bool   `json:"create"`
		IsAdmin     bool   `json:"is_admin"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&result); err != nil {
		return SSOTicketResult{}, errors.New("invalid ticket response")
	}
	if result.ID == "" || result.DisplayName == "" {
		return SSOTicketResult{}, errors.New("incomplete ticket identity")
	}
	if roomID != "" && result.RoomID != "" && strings.ToUpper(result.RoomID) != roomID {
		return SSOTicketResult{}, errors.New("ticket room scope mismatch")
	}
	if create != nil && result.Create != *create {
		return SSOTicketResult{}, errors.New("ticket create scope mismatch")
	}

	return SSOTicketResult{
		User: model.UserIdentity{
			ID:          result.ID,
			DisplayName: result.DisplayName,
			AvatarURL:   strings.TrimSpace(result.AvatarURL),
			Source:      "sso",
			IsAdmin:     result.IsAdmin,
		},
		LaunchRoomID: strings.ToUpper(strings.TrimSpace(result.RoomID)),
		Create:       result.Create,
	}, nil
}

func (s *Service) sign(payload string) string {
	mac := hmac.New(sha256.New, s.Secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

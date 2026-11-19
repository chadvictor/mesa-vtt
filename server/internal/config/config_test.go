package config

import "testing"

func TestLoadDefaultsToLocalAuth(t *testing.T) {
	t.Setenv("LISTEN_ADDRESS", "")
	t.Setenv("AUTH_MODE", "")
	t.Setenv("EXTERNAL_TICKET_URL", "")
	t.Setenv("EXTERNAL_AUTH_TOKEN", "")
	t.Setenv("APP_ORIGIN", "")
	t.Setenv("MESA_DATA_FILE", "")
	t.Setenv("MESA_ICE_SERVERS", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.ListenAddress != ":8094" {
		t.Fatalf("expected default :8094, got %q", cfg.ListenAddress)
	}
	if cfg.AuthMode != AuthModeLocal || !cfg.LocalAuthEnabled() {
		t.Fatalf("expected default AUTH_MODE=local, got %q", cfg.AuthMode)
	}
	if len(cfg.ICEServers) == 0 {
		t.Fatalf("expected default STUN ICE servers")
	}
}

func TestLoadSSORequiresTicketAndToken(t *testing.T) {
	t.Setenv("AUTH_MODE", "sso")
	t.Setenv("EXTERNAL_TICKET_URL", "")
	t.Setenv("EXTERNAL_AUTH_TOKEN", "")
	if _, err := Load(); err == nil {
		t.Fatalf("expected error when AUTH_MODE=sso without EXTERNAL_TICKET_URL and EXTERNAL_AUTH_TOKEN")
	}

	t.Setenv("EXTERNAL_TICKET_URL", "https://auth.example.org/api/ticket/consume")
	t.Setenv("EXTERNAL_AUTH_TOKEN", "0123456789abcdef0123456789abcdef0123456789abcdef")
	t.Setenv("APP_ORIGIN", "https://vtt.example.org")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() valid SSO failed: %v", err)
	}
	if cfg.AuthMode != AuthModeSSO || cfg.LocalAuthEnabled() {
		t.Fatalf("expected SSO mode with local auth disabled")
	}
	if len(cfg.OriginPatterns) != 1 || cfg.OriginPatterns[0] != "vtt.example.org" {
		t.Fatalf("unexpected origin patterns: %+v", cfg.OriginPatterns)
	}
}

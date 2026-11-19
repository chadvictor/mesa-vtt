package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const (
	AuthModeLocal = "local"
	AuthModeSSO   = "sso"
)

// ICEServer matches the standard WebRTC RTCIceServer JSON shape.
type ICEServer struct {
	URLs       any    `json:"urls"`
	Username   string `json:"username,omitempty"`
	Credential string `json:"credential,omitempty"`
}

// Config holds all runtime settings for the Mesa VTT authoritative backend.
type Config struct {
	ListenAddress     string
	DatabaseURL       string
	DataFile          string
	AuthMode          string // "local" (default) | "sso"
	ExternalTicketURL string
	ExternalAuthToken string
	SessionSecret     string
	AppOrigin         string
	OriginPatterns    []string
	ICEServers        []ICEServer
	GeminiAPIKey      string
	GeminiImageModel  string
	StaticDir         string
	DataDir           string
}

// LocalAuthEnabled reports whether standalone quick login (/api/v1/auth/local) is enabled.
func (c Config) LocalAuthEnabled() bool {
	return c.AuthMode != AuthModeSSO
}

var defaultICEServers = []ICEServer{
	{URLs: "stun:stun.l.google.com:19302"},
	{URLs: "stun:stun1.l.google.com:19302"},
}

// Load reads configuration from environment variables with zero-config standalone defaults.
func Load() (Config, error) {
	listenAddr := strings.TrimSpace(os.Getenv("LISTEN_ADDRESS"))
	if listenAddr == "" {
		listenAddr = ":8094"
	}

	ticketURL := strings.TrimSpace(os.Getenv("EXTERNAL_TICKET_URL"))
	authToken := strings.TrimSpace(os.Getenv("EXTERNAL_AUTH_TOKEN"))

	authMode := strings.TrimSpace(strings.ToLower(os.Getenv("AUTH_MODE")))
	if authMode == "" {
		authMode = AuthModeLocal
	}
	if authMode != AuthModeLocal && authMode != AuthModeSSO {
		return Config{}, fmt.Errorf("invalid AUTH_MODE %q: must be %q or %q", authMode, AuthModeLocal, AuthModeSSO)
	}

	appOrigin := strings.TrimSpace(os.Getenv("APP_ORIGIN"))
	patterns := []string{"*"}
	if appOrigin != "" {
		u, err := url.Parse(appOrigin)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return Config{}, fmt.Errorf("invalid APP_ORIGIN: %q", appOrigin)
		}
		if authMode == AuthModeSSO {
			localOrigin := u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1")
			if u.Scheme != "https" && !localOrigin {
				return Config{}, fmt.Errorf("AUTH_MODE=sso requires HTTPS APP_ORIGIN (or loopback HTTP)")
			}
		}
		patterns = []string{u.Host}
	}

	if authMode == AuthModeSSO {
		tURL, tErr := url.Parse(ticketURL)
		if tErr != nil || tURL.Host == "" || tURL.User != nil ||
			(tURL.Scheme != "http" && tURL.Scheme != "https") || len(authToken) < 32 {
			return Config{}, fmt.Errorf("AUTH_MODE=sso requires a valid EXTERNAL_TICKET_URL and a 32+ byte EXTERNAL_AUTH_TOKEN")
		}
	}

	sessionSecret := strings.TrimSpace(os.Getenv("SESSION_SECRET"))
	if sessionSecret == "" {
		sessionSecret = authToken
	}
	if sessionSecret == "" {
		var b [32]byte
		if _, err := rand.Read(b[:]); err != nil {
			return Config{}, err
		}
		sessionSecret = hex.EncodeToString(b[:])
	}

	iceServers := append([]ICEServer(nil), defaultICEServers...)
	if rawICE := strings.TrimSpace(os.Getenv("MESA_ICE_SERVERS")); rawICE != "" {
		var parsed []ICEServer
		if err := json.Unmarshal([]byte(rawICE), &parsed); err != nil {
			return Config{}, fmt.Errorf("invalid MESA_ICE_SERVERS JSON: %w", err)
		}
		if len(parsed) > 0 {
			iceServers = parsed
		}
	}

	dataFile := strings.TrimSpace(os.Getenv("MESA_DATA_FILE"))
	if dataFile == "" {
		dataFile = ResolveDefaultDataFile()
	}

	staticDir := strings.TrimSpace(os.Getenv("STATIC_DIR"))
	dataDir := strings.TrimSpace(os.Getenv("DATA_DIR"))
	if dataDir == "" {
		dataDir = ResolveDefaultDataDir()
	}

	geminiModel := strings.TrimSpace(os.Getenv("GEMINI_IMAGE_MODEL"))
	if geminiModel == "" {
		geminiModel = "gemini-2.5-flash-image"
	}

	return Config{
		ListenAddress:     listenAddr,
		DatabaseURL:       strings.TrimSpace(os.Getenv("DATABASE_URL")),
		DataFile:          dataFile,
		AuthMode:          authMode,
		ExternalTicketURL: ticketURL,
		ExternalAuthToken: authToken,
		SessionSecret:     sessionSecret,
		AppOrigin:         appOrigin,
		OriginPatterns:    patterns,
		ICEServers:        iceServers,
		GeminiAPIKey:      strings.TrimSpace(os.Getenv("GEMINI_API_KEY")),
		GeminiImageModel:  geminiModel,
		StaticDir:         staticDir,
		DataDir:           dataDir,
	}, nil
}

// ResolveDefaultDataFile picks ./.mesa-vtt-data.json if writable, falling back to /tmp/mesa-vtt-data.json.
func ResolveDefaultDataFile() string {
	candidate := "./.mesa-vtt-data.json"
	if cwd, err := os.Getwd(); err == nil {
		probe := filepath.Join(cwd, ".mesa-vtt-write-probe")
		if f, err := os.OpenFile(probe, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600); err == nil {
			_ = f.Close()
			_ = os.Remove(probe)
			return candidate
		}
	}
	return filepath.Join(os.TempDir(), "mesa-vtt-data.json")
}

// ResolveDefaultDataDir looks for the compendium data directory across dev and container layouts.
func ResolveDefaultDataDir() string {
	candidates := []string{
		"./data",
		"../data",
		"../../data",
		"/app/data",
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			if abs, err := filepath.Abs(c); err == nil {
				return abs
			}
			return c
		}
	}
	return "./data"
}

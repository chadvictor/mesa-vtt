package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/chadvictor/mesa-vtt/server/internal/api"
	"github.com/chadvictor/mesa-vtt/server/internal/auth"
	"github.com/chadvictor/mesa-vtt/server/internal/config"
	"github.com/chadvictor/mesa-vtt/server/internal/hub"
	"github.com/chadvictor/mesa-vtt/server/internal/seed"
	"github.com/chadvictor/mesa-vtt/server/internal/store"
)

func main() {
	addrFlag := flag.String("addr", "", "HTTP listen address (overrides LISTEN_ADDRESS, default :8094)")
	staticFlag := flag.String("static", "", "Optional static SPA directory to serve on / (overrides STATIC_DIR)")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	if a := strings.TrimSpace(*addrFlag); a != "" {
		cfg.ListenAddress = a
	}
	if st := strings.TrimSpace(*staticFlag); st != "" {
		cfg.StaticDir = st
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var st store.Store
	storageMode := "filestore"
	if cfg.DatabaseURL != "" {
		pgCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		pgStore, pgErr := store.NewPostgresStore(pgCtx, cfg.DatabaseURL)
		cancel()
		if pgErr != nil {
			slog.Error("failed to initialize PostgreSQL store", "error", pgErr)
			os.Exit(1)
		}
		st = pgStore
		storageMode = "postgres"
	} else {
		fsStore, fsErr := store.NewFileStore(cfg.DataFile)
		if fsErr != nil {
			slog.Error("failed to initialize JSON file store", "path", cfg.DataFile, "error", fsErr)
			os.Exit(1)
		}
		st = fsStore
	}
	defer func() { _ = st.Close() }()

	if err := seed.EnsureSeeded(ctx, st); err != nil {
		slog.Error("failed to seed demo campaign", "error", err)
		os.Exit(1)
	}

	authSvc := auth.NewService(cfg.SessionSecret, cfg.LocalAuthEnabled(), cfg.ExternalTicketURL, cfg.ExternalAuthToken)
	roomHub := hub.New(st)
	defer roomHub.Close()

	apiServer := api.NewServer(cfg, st, authSvc, roomHub)

	srv := &http.Server{
		Addr:              cfg.ListenAddress,
		Handler:           apiServer.Handler,
		ReadHeaderTimeout: 8 * time.Second,
		MaxHeaderBytes:    32768,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	slog.Info("mesa-vtt authoritative server started",
		"address", cfg.ListenAddress,
		"storage", storageMode,
		"auth_mode", cfg.AuthMode,
		"local_auth_enabled", cfg.LocalAuthEnabled(),
		"static_dir", cfg.StaticDir,
		"ai_image_enabled", cfg.GeminiAPIKey != "",
	)

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}

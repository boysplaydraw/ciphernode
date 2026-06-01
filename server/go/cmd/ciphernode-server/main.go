package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/boysplaydraw/ciphernode/server/go/internal/config"
	"github.com/boysplaydraw/ciphernode/server/go/internal/files"
	cnhttp "github.com/boysplaydraw/ciphernode/server/go/internal/http"
	"github.com/boysplaydraw/ciphernode/server/go/internal/ratelimit"
	"github.com/boysplaydraw/ciphernode/server/go/internal/security"
	"github.com/boysplaydraw/ciphernode/server/go/internal/storage"
	"github.com/boysplaydraw/ciphernode/server/go/internal/ws"
)

func main() {
	cfg := config.Load()
	store := storage.NewMemory(storage.Options{
		MessageTTL: cfg.MessageTTL,
		FileTTL:    cfg.FileTTL,
	})
	replay := security.NewReplayProtector(cfg.ReplayTTL, cfg.TimestampSkew)
	limiter := ratelimit.New(cfg.RateLimitPerMinute, time.Minute)
	fileSvc := files.NewService(store, cfg.MaxFileSizeBytes, cfg.MaxFileDownloads)

	hub := ws.NewHub(store, replay, limiter)
	go hub.Run()

	mux := cnhttp.NewRouter(cfg, store, fileSvc, hub)
	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("ciphernode go relay listening on %s", cfg.Addr())
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server stopped: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	hub.Close()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

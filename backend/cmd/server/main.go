// Command server runs the PDFEditor backend API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/api"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/config"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/pdf"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/raster"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	st, err := store.NewFSStore(cfg.DataDir)
	if err != nil {
		return err
	}

	svc := document.NewService(st, pdf.NewEngine())
	h := api.NewHandlers(svc, cfg.MaxUploadBytes())
	// Thumbnail cache lives inside each document's dir: {dataDir}/documents/{id}/thumbs.
	h.SetThumbs(document.NewThumbService(svc, raster.New(), filepath.Join(cfg.DataDir, "documents")))
	router := api.NewRouter(h, cfg.AllowedOrigins)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		// Uploads can be slow but must be bounded; reads (incl. body) get 5m.
		ReadTimeout:  5 * time.Minute,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "port", cfg.Port, "dataDir", cfg.DataDir)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		slog.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
		if err := <-errCh; !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	return nil
}

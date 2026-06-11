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
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/sign"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

// buildServer wires the full application stack — store, service, thumbnail
// cache, router — into an http.Server bound to cfg.Port. Pure construction:
// nothing listens until the caller serves it, which keeps it testable.
func buildServer(cfg config.Config) (*http.Server, error) {
	st, err := store.NewFSStore(cfg.DataDir, store.WithMaxVersions(cfg.MaxVersionsPerDoc))
	if err != nil {
		return nil, err
	}

	eng := pdf.NewEngine()
	svc := document.NewService(st, eng)

	// Digital signing identity: env-provided PEM files, or a self-signed
	// per-installation identity generated under {dataDir}/keys on first use.
	identity, err := loadSigningIdentity(cfg)
	if err != nil {
		return nil, err
	}
	// Trust our own certificate so signatures made here validate as
	// "valid" locally. Must happen before the server starts serving.
	if err := eng.TrustCert(identity.Cert); err != nil {
		return nil, err
	}
	svc.SetSigning(sign.New(identity), eng)
	slog.Info("signing identity ready", "signer", identity.Name())

	h := api.NewHandlers(svc, cfg.MaxUploadBytes())
	// Thumbnail cache lives inside each document's dir: {dataDir}/documents/{id}/thumbs.
	h.SetThumbs(document.NewThumbService(svc, raster.New(), filepath.Join(cfg.DataDir, "documents")))
	router := api.NewRouter(h, cfg.AllowedOrigins)

	return &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		// Uploads can be slow but must be bounded; reads (incl. body) get 5m.
		ReadTimeout:  5 * time.Minute,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}, nil
}

// loadSigningIdentity returns the identity from SIGNING_CERT_FILE /
// SIGNING_KEY_FILE when configured, else the (possibly freshly generated)
// per-installation identity in {dataDir}/keys.
func loadSigningIdentity(cfg config.Config) (*sign.Identity, error) {
	if cfg.SigningCertFile != "" {
		return sign.LoadIdentity(cfg.SigningCertFile, cfg.SigningKeyFile)
	}
	return sign.LoadOrCreateIdentity(filepath.Join(cfg.DataDir, "keys"))
}

func run() error {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	srv, err := buildServer(cfg)
	if err != nil {
		return err
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

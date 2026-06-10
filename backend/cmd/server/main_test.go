package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/config"
)

func TestBuildServerServesHealthzAndShutsDown(t *testing.T) {
	cfg := config.Config{
		Port:           "0",
		DataDir:        t.TempDir(),
		MaxUploadMB:    1,
		AllowedOrigins: []string{"http://localhost:5199"},
	}
	srv, err := buildServer(cfg)
	if err != nil {
		t.Fatalf("buildServer: %v", err)
	}

	// Serve on an OS-assigned port so parallel test runs never collide.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- srv.Serve(l) }()

	resp, err := http.Get("http://" + l.Addr().String() + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if resp.StatusCode != http.StatusOK || string(body) != "ok" {
		t.Errorf("healthz: want 200 %q, got %d %q", "ok", resp.StatusCode, body)
	}

	// Graceful shutdown completes and Serve reports the expected sentinel.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			t.Errorf("Serve: want http.ErrServerClosed, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve did not return after Shutdown")
	}
}

func TestBuildServerRejectsUnusableDataDir(t *testing.T) {
	// A regular file where the data dir should be must fail construction fast.
	path := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	if _, err := buildServer(config.Config{Port: "0", DataDir: path}); err == nil {
		t.Error("want error for data dir path occupied by a file, got nil")
	}
}

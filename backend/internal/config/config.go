// Package config loads server configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// DefaultAllowedOrigins is the CORS allowlist applied when ALLOWED_ORIGINS is
// unset: the nginx frontend and the Vite dev server.
const DefaultAllowedOrigins = "http://localhost:8880,http://localhost:5199"

// Config holds all server settings.
type Config struct {
	Port           string   // PORT, default 8000
	DataDir        string   // DATA_DIR, default ./data
	MaxUploadMB    int64    // MAX_UPLOAD_MB, default 50
	AllowedOrigins []string // ALLOWED_ORIGINS, comma-separated CORS allowlist
}

// Load reads configuration from the environment, applying defaults.
func Load() (Config, error) {
	cfg := Config{
		Port:           envOr("PORT", "8000"),
		DataDir:        envOr("DATA_DIR", "data"),
		MaxUploadMB:    50,
		AllowedOrigins: splitOrigins(envOr("ALLOWED_ORIGINS", DefaultAllowedOrigins)),
	}
	if v := os.Getenv("MAX_UPLOAD_MB"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			return Config{}, fmt.Errorf("invalid MAX_UPLOAD_MB %q", v)
		}
		cfg.MaxUploadMB = n
	}
	return cfg, nil
}

// MaxUploadBytes returns the upload cap in bytes.
func (c Config) MaxUploadBytes() int64 { return c.MaxUploadMB << 20 }

// splitOrigins parses a comma-separated origin list, trimming whitespace and
// dropping empty entries.
func splitOrigins(s string) []string {
	var out []string
	for _, o := range strings.Split(s, ",") {
		if o = strings.TrimSpace(o); o != "" {
			out = append(out, o)
		}
	}
	return out
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

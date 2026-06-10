package config

import (
	"reflect"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != "8000" || cfg.DataDir != "data" || cfg.MaxUploadMB != 50 {
		t.Errorf("unexpected defaults: %+v", cfg)
	}
	if cfg.MaxVersionsPerDoc != 20 {
		t.Errorf("MaxVersionsPerDoc default: want 20, got %d", cfg.MaxVersionsPerDoc)
	}
	if cfg.MaxUploadBytes() != 50<<20 {
		t.Errorf("MaxUploadBytes: %d", cfg.MaxUploadBytes())
	}
	wantOrigins := []string{"http://localhost:8880", "http://localhost:5199"}
	if !reflect.DeepEqual(cfg.AllowedOrigins, wantOrigins) {
		t.Errorf("AllowedOrigins default: want %v, got %v", wantOrigins, cfg.AllowedOrigins)
	}
}

func TestLoadAllowedOrigins(t *testing.T) {
	tests := []struct {
		name string
		env  string
		want []string
	}{
		{"single origin", "https://pdf.example.com", []string{"https://pdf.example.com"}},
		{"multiple with spaces", " https://a.example , https://b.example ", []string{"https://a.example", "https://b.example"}},
		{"empty entries dropped", "https://a.example,,", []string{"https://a.example"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("ALLOWED_ORIGINS", tt.env)
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if !reflect.DeepEqual(cfg.AllowedOrigins, tt.want) {
				t.Errorf("want %v, got %v", tt.want, cfg.AllowedOrigins)
			}
		})
	}
}

func TestLoadFromEnv(t *testing.T) {
	t.Setenv("PORT", "9000")
	t.Setenv("DATA_DIR", "/tmp/x")
	t.Setenv("MAX_UPLOAD_MB", "10")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != "9000" || cfg.DataDir != "/tmp/x" || cfg.MaxUploadMB != 10 {
		t.Errorf("env not applied: %+v", cfg)
	}
}

func TestLoadInvalidMaxUpload(t *testing.T) {
	for _, v := range []string{"abc", "0", "-5"} {
		t.Run(v, func(t *testing.T) {
			t.Setenv("MAX_UPLOAD_MB", v)
			if _, err := Load(); err == nil {
				t.Errorf("want error for MAX_UPLOAD_MB=%q", v)
			}
		})
	}
}

func TestLoadMaxVersionsPerDoc(t *testing.T) {
	tests := []struct {
		name    string
		env     string
		want    int
		wantErr bool
	}{
		{"explicit cap", "3", 3, false},
		{"zero means unlimited", "0", 0, false},
		{"negative rejected", "-1", 0, true},
		{"non-numeric rejected", "abc", 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("MAX_VERSIONS_PER_DOC", tt.env)
			cfg, err := Load()
			if tt.wantErr {
				if err == nil {
					t.Errorf("want error for MAX_VERSIONS_PER_DOC=%q", tt.env)
				}
				return
			}
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if cfg.MaxVersionsPerDoc != tt.want {
				t.Errorf("MaxVersionsPerDoc: want %d, got %d", tt.want, cfg.MaxVersionsPerDoc)
			}
		})
	}
}

package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != "8000" || cfg.DataDir != "data" || cfg.MaxUploadMB != 50 {
		t.Errorf("unexpected defaults: %+v", cfg)
	}
	if cfg.MaxUploadBytes() != 50<<20 {
		t.Errorf("MaxUploadBytes: %d", cfg.MaxUploadBytes())
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

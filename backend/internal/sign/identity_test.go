package sign

import (
	"crypto/ecdsa"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadOrCreateIdentityGenerates(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "keys")

	id, err := LoadOrCreateIdentity(dir)
	if err != nil {
		t.Fatalf("LoadOrCreateIdentity: %v", err)
	}

	if _, ok := id.Key.(*ecdsa.PrivateKey); !ok {
		t.Errorf("want ECDSA key, got %T", id.Key)
	}
	if !strings.HasPrefix(id.Name(), "PDFEditor personal signing") {
		t.Errorf("unexpected signer name %q", id.Name())
	}
	if !id.Cert.IsCA && id.Cert.Subject.CommonName == "" {
		t.Error("certificate has empty common name")
	}

	for _, f := range []string{certFileName, keyFileName} {
		info, err := os.Stat(filepath.Join(dir, f))
		if err != nil {
			t.Fatalf("stat %s: %v", f, err)
		}
		if perm := info.Mode().Perm(); perm != 0o600 {
			t.Errorf("%s permissions = %o, want 0600", f, perm)
		}
	}
	if info, err := os.Stat(dir); err != nil || info.Mode().Perm() != 0o700 {
		t.Errorf("keys dir permissions: err=%v perm=%o, want 0700", err, info.Mode().Perm())
	}
}

func TestLoadOrCreateIdentityIsStable(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "keys")

	first, err := LoadOrCreateIdentity(dir)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := LoadOrCreateIdentity(dir)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if first.Cert.SerialNumber.Cmp(second.Cert.SerialNumber) != 0 {
		t.Error("second call generated a different certificate; want the stored one reused")
	}
}

func TestLoadOrCreateIdentityIncompleteDir(t *testing.T) {
	tests := []struct {
		name string
		keep string
	}{
		{"key missing", certFileName},
		{"cert missing", keyFileName},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "keys")
			if _, err := LoadOrCreateIdentity(dir); err != nil {
				t.Fatalf("seed identity: %v", err)
			}
			for _, f := range []string{certFileName, keyFileName} {
				if f != tt.keep {
					if err := os.Remove(filepath.Join(dir, f)); err != nil {
						t.Fatal(err)
					}
				}
			}

			_, err := LoadOrCreateIdentity(dir)
			if !errors.Is(err, ErrIdentity) {
				t.Errorf("want ErrIdentity for incomplete dir, got %v", err)
			}
		})
	}
}

func TestLoadIdentityErrors(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "keys")
	if _, err := LoadOrCreateIdentity(dir); err != nil {
		t.Fatalf("seed identity: %v", err)
	}
	good := func(name string) string { return filepath.Join(dir, name) }

	junk := filepath.Join(t.TempDir(), "junk.pem")
	if err := os.WriteFile(junk, []byte("not pem at all"), 0o600); err != nil {
		t.Fatal(err)
	}

	// A second identity's key does not match the first identity's cert.
	otherDir := filepath.Join(t.TempDir(), "other")
	if _, err := LoadOrCreateIdentity(otherDir); err != nil {
		t.Fatalf("seed other identity: %v", err)
	}

	tests := []struct {
		name     string
		certFile string
		keyFile  string
	}{
		{"missing cert file", filepath.Join(dir, "nope.crt"), good(keyFileName)},
		{"missing key file", good(certFileName), filepath.Join(dir, "nope.key")},
		{"junk cert", junk, good(keyFileName)},
		{"junk key", good(certFileName), junk},
		{"mismatched pair", good(certFileName), filepath.Join(otherDir, keyFileName)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := LoadIdentity(tt.certFile, tt.keyFile)
			if !errors.Is(err, ErrIdentity) {
				t.Errorf("want ErrIdentity, got %v", err)
			}
		})
	}
}

func TestLoadIdentityRoundTrip(t *testing.T) {
	// Env-override path: point LoadIdentity at the generated PEM files.
	dir := filepath.Join(t.TempDir(), "keys")
	gen, err := LoadOrCreateIdentity(dir)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	id, err := LoadIdentity(filepath.Join(dir, certFileName), filepath.Join(dir, keyFileName))
	if err != nil {
		t.Fatalf("LoadIdentity: %v", err)
	}
	if id.Cert.SerialNumber.Cmp(gen.Cert.SerialNumber) != 0 {
		t.Error("loaded certificate differs from generated one")
	}
}

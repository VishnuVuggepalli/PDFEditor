// Package sign provides cryptographic PDF signing (PKCS#7 detached, an
// approval signature per PDF 32000) using a per-installation signing
// identity. This is the ONLY package in the codebase allowed to import the
// digitorus/pdfsign library, mirroring how internal/pdf confines pdfcpu.
//
// Trust model: by default the identity is a self-signed ECDSA P-256
// certificate generated on first use — a personal-tool trust model. The
// signature proves the document has not been modified since signing, but
// external viewers (Acrobat etc.) will report an "unknown signer" because
// the certificate does not chain to a public CA. Users with a real
// certificate can point SIGNING_CERT_FILE/SIGNING_KEY_FILE at PEM files
// (e.g. extracted from a PKCS#12 bundle with openssl).
package sign

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"time"
)

// ErrIdentity is the sentinel for any failure loading or creating the
// signing identity (corrupt key files, unreadable env-override paths, ...).
var ErrIdentity = errors.New("signing identity error")

// File names of the generated per-installation identity inside the keys dir.
const (
	certFileName = "signing.crt"
	keyFileName  = "signing.key"
)

// certValidityYears is how long a generated self-signed certificate lasts.
// Long-lived on purpose: this is a personal identity, not a CA-issued one.
const certValidityYears = 10

// Identity is a signing key pair plus its X.509 certificate.
type Identity struct {
	Cert *x509.Certificate
	Key  crypto.Signer
}

// Name returns the certificate's subject common name (the signer name shown
// in PDF viewers and in visible signature marks).
func (id *Identity) Name() string { return id.Cert.Subject.CommonName }

// LoadIdentity loads a certificate + private key from explicit PEM files
// (the SIGNING_CERT_FILE / SIGNING_KEY_FILE override for real certificates).
func LoadIdentity(certFile, keyFile string) (*Identity, error) {
	cert, err := readCertPEM(certFile)
	if err != nil {
		return nil, fmt.Errorf("%w: cert file %s: %v", ErrIdentity, certFile, err)
	}
	key, err := readKeyPEM(keyFile)
	if err != nil {
		return nil, fmt.Errorf("%w: key file %s: %v", ErrIdentity, keyFile, err)
	}
	id := &Identity{Cert: cert, Key: key}
	if err := id.check(); err != nil {
		return nil, err
	}
	return id, nil
}

// LoadOrCreateIdentity returns the per-installation identity stored in dir,
// generating a new ECDSA P-256 key + self-signed certificate on first use.
// Files are written atomically with 0600 permissions (dir 0700).
func LoadOrCreateIdentity(dir string) (*Identity, error) {
	certPath := filepath.Join(dir, certFileName)
	keyPath := filepath.Join(dir, keyFileName)

	certExists := fileExists(certPath)
	keyExists := fileExists(keyPath)

	switch {
	case certExists && keyExists:
		return LoadIdentity(certPath, keyPath)
	case certExists != keyExists:
		// One of the two files is missing: refuse to guess, the user should
		// remove the leftover so a fresh identity can be generated.
		return nil, fmt.Errorf("%w: incomplete identity in %s (one of %s/%s is missing); remove the leftover file to regenerate",
			ErrIdentity, dir, certFileName, keyFileName)
	}
	return generateIdentity(dir, certPath, keyPath)
}

// generateIdentity creates the key pair + certificate and persists both.
func generateIdentity(dir, certPath, keyPath string) (*Identity, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("%w: create keys dir: %v", ErrIdentity, err)
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("%w: generate key: %v", ErrIdentity, err)
	}

	der, err := selfSignedCertDER(key)
	if err != nil {
		return nil, err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, fmt.Errorf("%w: parse generated cert: %v", ErrIdentity, err)
	}

	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("%w: marshal key: %v", ErrIdentity, err)
	}

	// Key first: if the cert write fails we are left with a key-only dir,
	// which LoadOrCreateIdentity reports explicitly instead of regenerating.
	if err := writeFileAtomic(keyPath, pemEncode("PRIVATE KEY", keyDER)); err != nil {
		return nil, fmt.Errorf("%w: write key: %v", ErrIdentity, err)
	}
	if err := writeFileAtomic(certPath, pemEncode("CERTIFICATE", der)); err != nil {
		return nil, fmt.Errorf("%w: write cert: %v", ErrIdentity, err)
	}

	return &Identity{Cert: cert, Key: key}, nil
}

// selfSignedCertDER builds the self-signed X.509 certificate for key.
func selfSignedCertDER(key crypto.Signer) ([]byte, error) {
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("%w: serial: %v", ErrIdentity, err)
	}

	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "local"
	}

	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   fmt.Sprintf("PDFEditor personal signing (%s)", host),
			Organization: []string{"PDFEditor"},
		},
		NotBefore: now.Add(-time.Hour), // tolerate clock skew
		NotAfter:  now.AddDate(certValidityYears, 0, 0),
		// KeyCertSign + IsCA let the certificate verify as its own issuer
		// (Go's CheckSignatureFrom enforces basic constraints), which is
		// how validators recognize a well-formed self-signed identity.
		KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageContentCommitment | x509.KeyUsageCertSign,
		ExtKeyUsage: []x509.ExtKeyUsage{
			x509.ExtKeyUsageEmailProtection, // closest standard EKU to doc signing
		},
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLenZero:        true,
	}

	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, key.Public(), key)
	if err != nil {
		return nil, fmt.Errorf("%w: create cert: %v", ErrIdentity, err)
	}
	return der, nil
}

// check verifies the certificate matches the private key and is usable.
func (id *Identity) check() error {
	now := time.Now()
	if now.After(id.Cert.NotAfter) {
		return fmt.Errorf("%w: certificate expired %s", ErrIdentity, id.Cert.NotAfter.Format(time.RFC3339))
	}
	certKey, err := x509.MarshalPKIXPublicKey(id.Cert.PublicKey)
	if err != nil {
		return fmt.Errorf("%w: unsupported cert public key: %v", ErrIdentity, err)
	}
	signerKey, err := x509.MarshalPKIXPublicKey(id.Key.Public())
	if err != nil {
		return fmt.Errorf("%w: unsupported private key: %v", ErrIdentity, err)
	}
	if string(certKey) != string(signerKey) {
		return fmt.Errorf("%w: certificate does not match private key", ErrIdentity)
	}
	return nil
}

func readCertPEM(path string) (*x509.Certificate, error) {
	bb, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(bb)
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, errors.New("no CERTIFICATE PEM block found")
	}
	return x509.ParseCertificate(block.Bytes)
}

// readKeyPEM parses a PEM private key, accepting PKCS#8, EC and PKCS#1 forms.
func readKeyPEM(path string) (crypto.Signer, error) {
	bb, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(bb)
	if block == nil {
		return nil, errors.New("no PEM block found")
	}
	if k, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		signer, ok := k.(crypto.Signer)
		if !ok {
			return nil, fmt.Errorf("unsupported PKCS#8 key type %T", k)
		}
		return signer, nil
	}
	if k, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	return nil, errors.New("not a PKCS#8, EC or PKCS#1 private key")
}

func pemEncode(blockType string, der []byte) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: blockType, Bytes: der})
}

// writeFileAtomic writes data to path via a same-dir temp file + rename,
// with 0600 permissions from the moment of creation.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // no-op after successful rename

	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

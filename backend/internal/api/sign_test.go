package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/pdf"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/sign"
	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/store"
)

// newSigningServer wires the real stack including a trusted signing
// identity, mirroring buildServer.
func newSigningServer(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	st, err := store.NewFSStore(t.TempDir())
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	eng := pdf.NewEngine()
	svc := document.NewService(st, eng)

	id, err := sign.LoadOrCreateIdentity(filepath.Join(t.TempDir(), "keys"))
	if err != nil {
		t.Fatalf("identity: %v", err)
	}
	if err := eng.TrustCert(id.Cert); err != nil {
		t.Fatalf("TrustCert: %v", err)
	}
	svc.SetSigning(sign.New(id), eng)

	return NewRouter(NewHandlers(svc, 10<<20), []string{"http://localhost:8880"})
}

func doJSON(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestSignEndpointValidation(t *testing.T) {
	r := newSigningServer(t)
	id := uploadedID(t, doUpload(t, r, "a.pdf", fixture(t)))

	tests := []struct {
		name       string
		path       string
		body       string
		wantStatus int
	}{
		{"not json", "/api/v1/documents/" + id + "/sign", "{", http.StatusBadRequest},
		{"rect without page", "/api/v1/documents/" + id + "/sign", `{"visibleRect":[0,0,10,10]}`, http.StatusBadRequest},
		{"page without rect", "/api/v1/documents/" + id + "/sign", `{"page":1}`, http.StatusBadRequest},
		{"page out of range", "/api/v1/documents/" + id + "/sign", `{"page":99,"visibleRect":[0,0,10,10]}`, http.StatusBadRequest},
		{"inverted rect", "/api/v1/documents/" + id + "/sign", `{"page":1,"visibleRect":[10,0,0,10]}`, http.StatusBadRequest},
		{"unknown document", "/api/v1/documents/nope/sign", `{}`, http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := doJSON(t, r, http.MethodPost, tt.path, tt.body)
			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body %s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestSignAndSignaturesFlow(t *testing.T) {
	r := newSigningServer(t)
	id := uploadedID(t, doUpload(t, r, "a.pdf", fixture(t)))

	// Unsigned: empty signature list.
	rec := doJSON(t, r, http.MethodGet, "/api/v1/documents/"+id+"/signatures", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET signatures: %d (%s)", rec.Code, rec.Body.String())
	}
	env := decode(t, rec)
	if list, ok := env.Data.([]any); !ok || len(list) != 0 {
		t.Fatalf("want empty list on unsigned doc, got %#v", env.Data)
	}

	// Sign (invisible, with metadata) → new head version 2.
	rec = doJSON(t, r, http.MethodPost, "/api/v1/documents/"+id+"/sign",
		`{"reason":"approval","location":"home"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST sign: %d (%s)", rec.Code, rec.Body.String())
	}
	env = decode(t, rec)
	doc := env.Data.(map[string]any)
	if hv := doc["headVersion"].(float64); hv != 2 {
		t.Errorf("head version after sign = %v, want 2", hv)
	}
	versions := doc["versions"].([]any)
	last := versions[len(versions)-1].(map[string]any)
	if last["ops"] != "digitally signed" {
		t.Errorf("ops = %v, want %q", last["ops"], "digitally signed")
	}

	// Signed: one valid signature covering the whole document.
	rec = doJSON(t, r, http.MethodGet, "/api/v1/documents/"+id+"/signatures", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET signatures: %d", rec.Code)
	}
	env = decode(t, rec)
	list := env.Data.([]any)
	if len(list) != 1 {
		t.Fatalf("want 1 signature, got %d", len(list))
	}
	sig := list[0].(map[string]any)
	if sig["valid"] != true || sig["status"] != "valid" {
		t.Errorf("want valid signature, got %v", sig)
	}
	if sig["coversWholeDocument"] != true {
		t.Errorf("want coversWholeDocument, got %v", sig)
	}
	if sig["signingReason"] != "approval" || sig["location"] != "home" {
		t.Errorf("metadata mismatch: %v", sig)
	}

	// Edit after signing → signature invalidated (the UI-warning invariant).
	rec = doJSON(t, r, http.MethodPost, "/api/v1/documents/"+id+"/annotations",
		`{"annotations":[{"type":"note","page":1,"rect":[50,50,70,70],"color":"#ff0000","contents":"x"}]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST annotations: %d (%s)", rec.Code, rec.Body.String())
	}
	rec = doJSON(t, r, http.MethodGet, "/api/v1/documents/"+id+"/signatures", "")
	env = decode(t, rec)
	for _, item := range env.Data.([]any) {
		s := item.(map[string]any)
		if s["valid"] == true {
			t.Errorf("signature still valid after edit: %v", s)
		}
	}
}

func TestSignVisibleEndpoint(t *testing.T) {
	r := newSigningServer(t)
	id := uploadedID(t, doUpload(t, r, "a.pdf", fixture(t)))

	rec := doJSON(t, r, http.MethodPost, "/api/v1/documents/"+id+"/sign",
		`{"reason":"ok","page":1,"visibleRect":[100,100,320,170]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST sign visible: %d (%s)", rec.Code, rec.Body.String())
	}

	rec = doJSON(t, r, http.MethodGet, "/api/v1/documents/"+id+"/signatures", "")
	env := decode(t, rec)
	list := env.Data.([]any)
	if len(list) != 1 {
		t.Fatalf("want 1 signature, got %d", len(list))
	}
	sig := list[0].(map[string]any)
	if sig["visible"] != true {
		t.Errorf("want visible signature, got %v", sig)
	}
	if sig["page"] != float64(1) {
		t.Errorf("page = %v, want 1", sig["page"])
	}
}

func TestSignaturesUnavailableWithoutSigner(t *testing.T) {
	// The default test server has no signing wired: 503, not 500.
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "a.pdf", fixture(t)))

	rec := doJSON(t, r, http.MethodPost, "/api/v1/documents/"+id+"/sign", `{}`)
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("POST sign without signer: %d, want 503", rec.Code)
	}
}

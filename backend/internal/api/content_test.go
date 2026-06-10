package api

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// contentBody builds a multipart body with a single "pdf" field.
func contentBody(t *testing.T, field string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile(field, "edited.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(data); err != nil {
		t.Fatal(err)
	}
	w.Close()
	return &buf, w.FormDataContentType()
}

func postContent(t *testing.T, r *gin.Engine, id, field string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	body, ctype := contentBody(t, field, data)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents/"+id+"/content", body)
	req.Header.Set("Content-Type", ctype)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestReplaceContentEndpoint(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "doc.pdf", fixture(t)))

	t.Run("valid edit creates version 2", func(t *testing.T) {
		rec := postContent(t, r, id, "pdf", fixture(t))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
		}
		env := decode(t, rec)
		doc := env.Data.(map[string]any)
		if hv := doc["headVersion"].(float64); hv != 2 {
			t.Fatalf("headVersion = %v, want 2", hv)
		}
		versions := doc["versions"].([]any)
		last := versions[len(versions)-1].(map[string]any)
		if last["ops"] != "content edit" {
			t.Fatalf("ops = %v, want 'content edit'", last["ops"])
		}
	})

	t.Run("invalid pdf bytes rejected with 422", func(t *testing.T) {
		rec := postContent(t, r, id, "pdf", []byte("garbage"))
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("missing pdf field rejected with 400", func(t *testing.T) {
		rec := postContent(t, r, id, "file", fixture(t))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("unknown document 404", func(t *testing.T) {
		rec := postContent(t, r, "does-not-exist", "pdf", fixture(t))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
		}
	})
}

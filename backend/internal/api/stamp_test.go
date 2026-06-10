package api

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// stampBody builds the multipart body for POST /documents/:id/stamp.
func stampBody(t *testing.T, img []byte, page, rect string) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if img != nil {
		fw, err := w.CreateFormFile("image", "sig.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fw.Write(img); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.WriteField("page", page); err != nil {
		t.Fatal(err)
	}
	if err := w.WriteField("rect", rect); err != nil {
		t.Fatal(err)
	}
	w.Close()
	return &buf, w.FormDataContentType()
}

func sigPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 60, 30))
	for y := 0; y < 30; y++ {
		for x := 0; x < 60; x++ {
			img.Set(x, y, color.RGBA{R: 10, G: 10, B: 120, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func doStamp(t *testing.T, r *gin.Engine, id string, img []byte, page, rect string) *httptest.ResponseRecorder {
	t.Helper()
	body, ctype := stampBody(t, img, page, rect)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents/"+id+"/stamp", body)
	req.Header.Set("Content-Type", ctype)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestStampEndpoint(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "doc.pdf", fixture(t)))

	rec := doStamp(t, r, id, sigPNG(t), "2", "[100,100,260,180]")
	if rec.Code != http.StatusOK {
		t.Fatalf("stamp: status %d body %s", rec.Code, rec.Body.String())
	}
	env := decode(t, rec)
	doc, ok := env.Data.(map[string]any)
	if !ok || doc["headVersion"].(float64) != 2 {
		t.Fatalf("want headVersion 2, got %v", env.Data)
	}
	versions := doc["versions"].([]any)
	head := versions[len(versions)-1].(map[string]any)
	if head["ops"] != "signature stamp p2" {
		t.Errorf("ops summary: %v", head["ops"])
	}
}

func TestStampEndpointRejectsBadInput(t *testing.T) {
	r := newTestServer(t)
	id := uploadedID(t, doUpload(t, r, "doc.pdf", fixture(t)))

	tests := []struct {
		name string
		img  []byte
		page string
		rect string
	}{
		{"missing image", nil, "1", "[0,0,100,100]"},
		{"bad page", sigPNG(t), "zero", "[0,0,100,100]"},
		{"page out of range", sigPNG(t), "9", "[0,0,100,100]"},
		{"bad rect json", sigPNG(t), "1", "not json"},
		{"inverted rect", sigPNG(t), "1", "[100,0,0,100]"},
		{"non-image payload", []byte("plain text"), "1", "[0,0,100,100]"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := doStamp(t, r, id, tt.img, tt.page, tt.rect)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status %d body %s", rec.Code, rec.Body.String())
			}
		})
	}
}

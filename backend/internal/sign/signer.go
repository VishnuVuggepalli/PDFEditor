package sign

import (
	"bytes"
	"crypto"
	"errors"
	"fmt"
	"time"

	"github.com/digitorus/pdf"
	pdfsign "github.com/digitorus/pdfsign/sign"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// ErrSign is the sentinel for signing failures (unparseable input,
// signing-library errors, empty output).
var ErrSign = errors.New("pdf signing failed")

// Signer implements document.Signer using the digitorus/pdfsign library.
type Signer struct {
	id *Identity
}

// New returns a Signer backed by the given identity.
func New(id *Identity) *Signer { return &Signer{id: id} }

// Name returns the signer display name (certificate common name).
func (s *Signer) Name() string { return s.id.Name() }

// Sign produces a signed copy of pdfBytes as an incremental update: a PKCS#7
// detached approval signature over the whole document. Invisible by default;
// with req.Visible a signature widget showing the signer name is placed at
// req.Rect on req.Page.
func (s *Signer) Sign(pdfBytes []byte, req document.SignRequest) ([]byte, error) {
	rs := bytes.NewReader(pdfBytes)
	rdr, err := pdf.NewReader(rs, int64(len(pdfBytes)))
	if err != nil {
		return nil, fmt.Errorf("%w: read pdf: %v", ErrSign, err)
	}

	data := pdfsign.SignData{
		Signature: pdfsign.SignDataSignature{
			CertType: pdfsign.ApprovalSignature,
			Info: pdfsign.SignDataSignatureInfo{
				Name:     s.id.Name(),
				Location: req.Location,
				Reason:   req.Reason,
				Date:     time.Now(),
			},
		},
		Signer:          s.id.Key,
		DigestAlgorithm: crypto.SHA256,
		Certificate:     s.id.Cert,
	}
	if req.Visible {
		data.Appearance = pdfsign.Appearance{
			Visible:     true,
			Page:        uint32(req.Page),
			LowerLeftX:  req.Rect[0],
			LowerLeftY:  req.Rect[1],
			UpperRightX: req.Rect[2],
			UpperRightY: req.Rect[3],
		}
	}

	var out bytes.Buffer
	if err := pdfsign.Sign(rs, &out, rdr, int64(len(pdfBytes)), data); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSign, err)
	}
	if out.Len() == 0 {
		return nil, fmt.Errorf("%w: signing produced no output", ErrSign)
	}
	return out.Bytes(), nil
}

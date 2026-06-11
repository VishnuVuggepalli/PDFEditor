package document

import (
	"context"
	"fmt"
	"time"
)

// SignRequest describes one digital-signing operation on the head version.
// The signature is invisible unless Visible is set, in which case a visible
// signature widget (signer name + date) is placed on Page at Rect
// ([llx,lly,urx,ury] in PDF points, lower-left origin).
type SignRequest struct {
	Reason   string
	Location string
	Visible  bool
	Page     int
	Rect     [4]float64
}

// MaxSignFieldBytes caps the reason/location free-text fields.
const MaxSignFieldBytes = 512

// Signer applies a cryptographic signature to PDF bytes. Defined here, in
// the consumer package; the implementation lives in internal/sign (the only
// package allowed to import the signing library).
type Signer interface {
	// Name returns the signer display name (certificate common name).
	Name() string
	// Sign returns a signed copy of pdf (incremental update; the input
	// bytes are not modified).
	Sign(pdf []byte, req SignRequest) ([]byte, error)
}

// SignatureValidator reports the validation status of all digital
// signatures in PDF bytes. Implemented by internal/pdf (pdfcpu).
type SignatureValidator interface {
	// ValidateSignatures returns one SignatureInfo per signature, oldest
	// first, or an empty slice when the document has none.
	ValidateSignatures(pdf []byte) ([]SignatureInfo, error)
}

// Signature status values reported by the GET signatures endpoint.
const (
	// SigStatusValid: digest verified and the certificate chains to a
	// trusted root (incl. this installation's own identity).
	SigStatusValid = "valid"
	// SigStatusInvalid: the document was modified after signing, or the
	// signature is forged/expired/revoked.
	SigStatusInvalid = "invalid"
	// SigStatusUnknown: digest checks passed but the signer's certificate
	// is not trusted (e.g. a self-signed identity from another
	// installation) — the "unknown signer" badge.
	SigStatusUnknown = "unknown"
)

// SignatureInfo is the per-signature validation report.
type SignatureInfo struct {
	Signer              string    `json:"signer"`
	SignedAt            time.Time `json:"signedAt"`
	Valid               bool      `json:"valid"`
	Status              string    `json:"status"` // valid | invalid | unknown
	Reason              string    `json:"reason,omitempty"`
	CoversWholeDocument bool      `json:"coversWholeDocument"`
	Visible             bool      `json:"visible"`
	Page                int       `json:"page,omitempty"`
	Location            string    `json:"location,omitempty"`
	SigningReason       string    `json:"signingReason,omitempty"`
	SelfSigned          bool      `json:"selfSigned"`
}

// SetSigning wires the signing dependencies. Optional: when absent, the
// signing endpoints report ErrSigningUnavailable.
func (s *Service) SetSigning(signer Signer, validator SignatureValidator) {
	s.signer = signer
	s.sigValidator = validator
}

// validateSignRequest rejects malformed sign parameters before touching
// the PDF. pageCount guards the visible-widget placement.
func validateSignRequest(req SignRequest, pageCount int) error {
	if len(req.Reason) > MaxSignFieldBytes {
		return fmt.Errorf("%w: reason exceeds %d bytes", ErrInvalidInput, MaxSignFieldBytes)
	}
	if len(req.Location) > MaxSignFieldBytes {
		return fmt.Errorf("%w: location exceeds %d bytes", ErrInvalidInput, MaxSignFieldBytes)
	}
	if !req.Visible {
		return nil
	}
	if req.Page < 1 || req.Page > pageCount {
		return fmt.Errorf("%w: page %d out of range 1..%d", ErrInvalidInput, req.Page, pageCount)
	}
	if req.Rect[0] >= req.Rect[2] || req.Rect[1] >= req.Rect[3] {
		return fmt.Errorf("%w: rect must be [llx,lly,urx,ury] with llx<urx and lly<ury", ErrInvalidInput)
	}
	return nil
}

// Sign cryptographically signs the head version and stores the result as a
// new version with ops summary "digitally signed".
func (s *Service) Sign(ctx context.Context, id string, req SignRequest) (*Document, error) {
	if s.signer == nil {
		return nil, fmt.Errorf("%w: no signing identity configured", ErrSigningUnavailable)
	}

	cur, _, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	info, err := s.engine.Info(cur)
	if err != nil {
		return nil, fmt.Errorf("read pdf info: %w", err)
	}
	if err := validateSignRequest(req, info.PageCount); err != nil {
		return nil, err
	}

	out, err := s.signer.Sign(cur, req)
	if err != nil {
		return nil, fmt.Errorf("sign pdf: %w", err)
	}

	doc, err := s.store.AddVersion(ctx, id, out, "digitally signed")
	if err != nil {
		return nil, fmt.Errorf("save signed version: %w", err)
	}
	return doc, nil
}

// Signatures reports the validation status of every digital signature in
// the head version (empty slice when there are none).
func (s *Service) Signatures(ctx context.Context, id string) ([]SignatureInfo, error) {
	if s.sigValidator == nil {
		return nil, fmt.Errorf("%w: no signature validator configured", ErrSigningUnavailable)
	}

	cur, _, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	infos, err := s.sigValidator.ValidateSignatures(cur)
	if err != nil {
		return nil, fmt.Errorf("validate signatures: %w", err)
	}
	if infos == nil {
		infos = []SignatureInfo{}
	}
	return infos, nil
}

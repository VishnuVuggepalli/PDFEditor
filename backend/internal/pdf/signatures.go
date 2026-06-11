package pdf

import (
	"bytes"
	"crypto/x509"
	"fmt"
	"sync"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	pdfcpulib "github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// trustMu serializes mutations of pdfcpu's global user cert pool. The pool
// itself is read concurrently by validations, so TrustCert must only be
// called during startup, before the server begins handling requests.
var trustMu sync.Mutex

// TrustCert adds cert to pdfcpu's trusted root pool for this process, so
// signatures produced by this installation's own (self-signed) identity
// validate as "valid" locally. Call during startup only.
func (e *Engine) TrustCert(cert *x509.Certificate) error {
	trustMu.Lock()
	defer trustMu.Unlock()

	// Loads the installed trust store exactly once (sync.Once inside);
	// afterwards model.UserCertPool is non-nil and safe to extend.
	if err := pdfcpulib.LoadCertificates(); err != nil {
		return fmt.Errorf("load pdfcpu trust store: %w", err)
	}
	model.UserCertPool.AddCert(cert)
	return nil
}

// ValidateSignatures implements document.SignatureValidator via pdfcpu.
// It returns one report per signature (empty when the document has none).
// Validation runs offline: no OCSP/CRL fetches.
func (e *Engine) ValidateSignatures(pdfBytes []byte) ([]document.SignatureInfo, error) {
	if err := pdfcpulib.LoadCertificates(); err != nil {
		return nil, fmt.Errorf("load pdfcpu trust store: %w", err)
	}

	conf := *e.conf
	conf.Cmd = model.VALIDATESIGNATURES
	conf.Offline = true

	rs := bytes.NewReader(pdfBytes)
	ctx, err := api.ReadValidateAndOptimize(rs, &conf)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", document.ErrInvalidPDF, err)
	}

	if len(ctx.Signatures) == 0 && ctx.URSignature == nil {
		return nil, nil
	}

	results, err := pdfcpulib.ValidateSignatures(rs, ctx, true)
	if err != nil {
		return nil, fmt.Errorf("validate signatures: %w", err)
	}

	infos := make([]document.SignatureInfo, 0, len(results))
	for _, svr := range results {
		infos = append(infos, toSignatureInfo(svr, coversWholeDocument(ctx, svr.ObjNr, int64(len(pdfBytes)))))
	}
	return infos, nil
}

// toSignatureInfo maps pdfcpu's validation result onto the API DTO.
func toSignatureInfo(svr *model.SignatureValidationResult, covers bool) document.SignatureInfo {
	status := mapStatus(svr)

	info := document.SignatureInfo{
		Signer:              signerName(svr),
		SignedAt:            svr.Details.SigningTime,
		Valid:               status == document.SigStatusValid,
		Status:              status,
		Reason:              svr.Reason.String(),
		CoversWholeDocument: covers,
		Visible:             svr.Signature.Visible,
		Location:            svr.Details.Location,
		SigningReason:       svr.Details.Reason,
	}
	if info.Visible {
		// PageNr is only meaningful for visible signature widgets.
		info.Page = svr.Signature.PageNr
	}
	if len(svr.Details.Signers) > 0 {
		if cd := svr.Details.Signers[0].Certificate; cd != nil {
			info.SelfSigned = cd.SelfSigned
			if info.Signer == "" {
				info.Signer = cd.Subject
			}
		}
	}
	return info
}

// mapStatus reduces pdfcpu's (status, reason) pair to the API's three-way
// status. pdfcpu leaves Status "unknown" for every non-proven case; we keep
// "unknown" only for certificate-trust problems (the document is intact but
// the signer cannot be verified — the "unknown signer" badge) and report
// any other unverifiable signature as invalid, e.g. a digest that no longer
// matches after the file was rewritten by an edit.
func mapStatus(svr *model.SignatureValidationResult) string {
	switch svr.Status {
	case model.SignatureStatusValid:
		return document.SigStatusValid
	case model.SignatureStatusInvalid:
		return document.SigStatusInvalid
	}
	switch svr.Reason {
	case model.SignatureReasonCertNotTrusted,
		model.SignatureReasonSelfSignedCertErr,
		model.SignatureReasonCertExpired,
		model.SignatureReasonCertInvalid,
		model.SignatureReasonCertRevoked:
		return document.SigStatusUnknown
	}
	return document.SigStatusInvalid
}

// signerName prefers the signature dict's Name entry, then the identity
// extracted from a verified certificate chain.
func signerName(svr *model.SignatureValidationResult) string {
	if svr.Details.SignerName != "" {
		return svr.Details.SignerName
	}
	if svr.Details.SignerIdentity != "" && svr.Details.SignerIdentity != "Unknown" {
		return svr.Details.SignerIdentity
	}
	return ""
}

// coversWholeDocument reports whether the signature with the given field
// object number digests the entire file: its ByteRange must end at EOF.
// Signatures followed by later incremental updates (e.g. a second
// signature) cover only a prefix and return false. Unresolvable dicts
// (timestamps, usage-rights signatures) conservatively return false.
func coversWholeDocument(ctx *model.Context, objNr int, fileSize int64) bool {
	if objNr <= 0 {
		return false
	}
	field, err := ctx.DereferenceDict(*types.NewIndirectRef(objNr, 0))
	if err != nil || field == nil {
		return false
	}
	indRef := field.IndirectRefEntry("V")
	if indRef == nil {
		return false
	}
	sigDict, err := ctx.DereferenceDict(*indRef)
	if err != nil || sigDict == nil {
		return false
	}
	br := sigDict.ArrayEntry("ByteRange")
	if len(br) != 4 {
		return false
	}
	offset, ok1 := byteRangeInt(br[2])
	length, ok2 := byteRangeInt(br[3])
	return ok1 && ok2 && offset+length == fileSize
}

// byteRangeInt extracts an integer ByteRange element.
func byteRangeInt(obj types.Object) (int64, bool) {
	i, ok := obj.(types.Integer)
	if !ok {
		return 0, false
	}
	return int64(i.Value()), true
}

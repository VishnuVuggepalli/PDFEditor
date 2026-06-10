package document

import "errors"

var (
	// ErrNotFound is returned when a document or version does not exist.
	ErrNotFound = errors.New("document not found")
	// ErrInvalidPDF is returned when uploaded bytes are not a valid PDF.
	ErrInvalidPDF = errors.New("invalid PDF")
	// ErrInvalidInput is returned for bad request parameters.
	ErrInvalidInput = errors.New("invalid input")
)

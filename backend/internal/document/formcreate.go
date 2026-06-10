package document

import (
	"context"
	"fmt"
	"regexp"
)

// Form-field types accepted by AddFormFields.
const (
	FieldText     = "text"
	FieldCheckbox = "checkbox"
)

// Caps for new-field input: generous for real forms, tight enough that a
// runaway client can't bloat documents or meta.
const (
	maxNewFields         = 100
	maxFieldIDBytes      = 128
	maxFieldLabelBytes   = 512
	maxFieldDefaultBytes = 1024
)

// NewFormField describes one AcroForm field to create on an existing page.
// Rect is in PDF points with a lower-left origin, like annotations.
type NewFormField struct {
	Type      string     `json:"type"`                // text | checkbox
	ID        string     `json:"id"`                  // field name (/T), unique within the document
	Label     string     `json:"label,omitempty"`     // tooltip (/TU)
	Page      int        `json:"page"`                // 1-based
	Rect      [4]float64 `json:"rect"`                // llx, lly, urx, ury
	Multiline bool       `json:"multiline,omitempty"` // text only
	Default   string     `json:"default,omitempty"`   // text: initial value; checkbox: true/false
}

// fieldIDPattern rejects dots (AcroForm hierarchy separators) and control
// characters; anything else is a legal field name.
var fieldIDPattern = regexp.MustCompile(`^[^.\x00-\x1f]+$`)

// checkboxDefaults are the accepted spellings of a checkbox default state,
// matching what FillForm accepts as truthy/falsy values.
var checkboxDefaults = map[string]bool{
	"": true, "true": true, "false": true, "on": true, "off": true, "1": true, "0": true,
}

// validateNewFormField checks one field against the document's page count and
// the set of names already taken (existing fields + earlier fields in the
// same batch).
func validateNewFormField(f NewFormField, pageCount int, taken map[string]bool) error {
	switch f.Type {
	case FieldText, FieldCheckbox:
	default:
		return fmt.Errorf("%w: unknown field type %q", ErrInvalidInput, f.Type)
	}
	if f.ID == "" {
		return fmt.Errorf("%w: field id must not be empty", ErrInvalidInput)
	}
	if len(f.ID) > maxFieldIDBytes {
		return fmt.Errorf("%w: field id exceeds %d bytes", ErrInvalidInput, maxFieldIDBytes)
	}
	if !fieldIDPattern.MatchString(f.ID) {
		return fmt.Errorf("%w: field id %q must not contain dots or control characters", ErrInvalidInput, f.ID)
	}
	if taken[f.ID] {
		return fmt.Errorf("%w: field id %q already exists", ErrInvalidInput, f.ID)
	}
	if f.Page < 1 || f.Page > pageCount {
		return fmt.Errorf("%w: page %d out of range 1..%d", ErrInvalidInput, f.Page, pageCount)
	}
	if f.Rect[0] >= f.Rect[2] || f.Rect[1] >= f.Rect[3] {
		return fmt.Errorf("%w: rect must be [llx,lly,urx,ury] with llx<urx and lly<ury", ErrInvalidInput)
	}
	if len(f.Label) > maxFieldLabelBytes {
		return fmt.Errorf("%w: label exceeds %d bytes", ErrInvalidInput, maxFieldLabelBytes)
	}
	if len(f.Default) > maxFieldDefaultBytes {
		return fmt.Errorf("%w: default exceeds %d bytes", ErrInvalidInput, maxFieldDefaultBytes)
	}
	if f.Type == FieldCheckbox {
		if f.Multiline {
			return fmt.Errorf("%w: multiline is only valid for text fields", ErrInvalidInput)
		}
		if !checkboxDefaults[f.Default] {
			return fmt.Errorf("%w: checkbox default must be true/false, got %q", ErrInvalidInput, f.Default)
		}
	}
	return nil
}

// AddFormFields creates new AcroForm fields on the head version and stores
// the result as a new version. New fields must not collide with existing
// field IDs or names (FillForm addresses fields by either).
func (s *Service) AddFormFields(ctx context.Context, id string, fields []NewFormField) (*Document, error) {
	if len(fields) == 0 {
		return nil, fmt.Errorf("%w: no fields given", ErrInvalidInput)
	}
	if len(fields) > maxNewFields {
		return nil, fmt.Errorf("%w: at most %d fields per request", ErrInvalidInput, maxNewFields)
	}

	cur, _, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	info, err := s.engine.Info(cur)
	if err != nil {
		return nil, fmt.Errorf("read pdf info: %w", err)
	}

	taken := make(map[string]bool)
	if info.HasForm {
		existing, err := s.engine.FormFields(cur)
		if err != nil {
			return nil, fmt.Errorf("read existing form fields: %w", err)
		}
		for _, f := range existing {
			taken[f.ID] = true
			if f.Name != "" {
				taken[f.Name] = true
			}
		}
	}

	for i, f := range fields {
		if err := validateNewFormField(f, info.PageCount, taken); err != nil {
			return nil, fmt.Errorf("field %d: %w", i+1, err)
		}
		taken[f.ID] = true
	}

	out, err := s.engine.AddFormFields(cur, fields)
	if err != nil {
		return nil, fmt.Errorf("add form fields: %w", err)
	}

	doc, err := s.store.AddVersion(ctx, id, out, fmt.Sprintf("add %d form field(s)", len(fields)))
	if err != nil {
		return nil, fmt.Errorf("save new version: %w", err)
	}
	return doc, nil
}

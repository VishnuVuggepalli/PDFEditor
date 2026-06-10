package document

import (
	"context"
	"fmt"
)

// FormField is one AcroForm field, engine-agnostic.
type FormField struct {
	ID     string `json:"id"`
	Name   string `json:"name,omitempty"`
	Type   string `json:"type"` // text | date | checkbox | radio | combo | list
	Value  string `json:"value"`
	Pages  []int  `json:"pages"`
	Locked bool   `json:"locked"`
}

// FormFields lists the AcroForm fields of the head version.
func (s *Service) FormFields(ctx context.Context, id string) ([]FormField, error) {
	cur, _, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}
	fields, err := s.engine.FormFields(cur)
	if err != nil {
		return nil, fmt.Errorf("read form fields: %w", err)
	}
	return fields, nil
}

// FillForm sets field values (keyed by field ID or name) on the head version
// and stores the result as a new version.
func (s *Service) FillForm(ctx context.Context, id string, values map[string]string) (*Document, error) {
	if len(values) == 0 {
		return nil, fmt.Errorf("%w: no field values given", ErrInvalidInput)
	}

	cur, _, err := s.Download(ctx, id)
	if err != nil {
		return nil, err
	}

	out, err := s.engine.FillForm(cur, values)
	if err != nil {
		return nil, fmt.Errorf("fill form: %w", err)
	}

	doc, err := s.store.AddVersion(ctx, id, out, fmt.Sprintf("fill %d form field(s)", len(values)))
	if err != nil {
		return nil, fmt.Errorf("save new version: %w", err)
	}
	return doc, nil
}

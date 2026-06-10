package pdf

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/form"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// fieldTypeName maps pdfcpu field types to API-friendly strings.
func fieldTypeName(t form.FieldType) string {
	switch t {
	case form.FTText:
		return "text"
	case form.FTDate:
		return "date"
	case form.FTCheckBox:
		return "checkbox"
	case form.FTRadioButtonGroup:
		return "radio"
	case form.FTComboBox:
		return "combo"
	case form.FTListBox:
		return "list"
	default:
		return "unknown"
	}
}

// FormFields lists AcroForm fields of the PDF.
func (e *Engine) FormFields(pdf []byte) ([]document.FormField, error) {
	fields, err := api.FormFields(bytes.NewReader(pdf), e.conf)
	if err != nil {
		return nil, fmt.Errorf("pdfcpu form fields: %w", err)
	}
	out := make([]document.FormField, 0, len(fields))
	for _, f := range fields {
		out = append(out, document.FormField{
			ID:     f.ID,
			Name:   f.Name,
			Type:   fieldTypeName(f.Typ),
			Value:  f.V,
			Pages:  f.Pages,
			Locked: f.Locked,
		})
	}
	return out, nil
}

// FillForm sets field values keyed by field ID or name. It exports the
// current form structure, patches the requested values, and feeds the result
// back through pdfcpu's form filler. Unknown keys are rejected.
func (e *Engine) FillForm(pdf []byte, values map[string]string) ([]byte, error) {
	group, err := api.ExportForm(bytes.NewReader(pdf), "", e.conf)
	if err != nil {
		return nil, fmt.Errorf("pdfcpu export form: %w", err)
	}
	if group == nil || len(group.Forms) == 0 {
		return nil, fmt.Errorf("%w: document has no form", document.ErrInvalidInput)
	}

	remaining := make(map[string]string, len(values))
	for k, v := range values {
		remaining[k] = v
	}
	patchForm(&group.Forms[0], remaining)
	if len(remaining) > 0 {
		for k := range remaining {
			return nil, fmt.Errorf("%w: unknown form field %q", document.ErrInvalidInput, k)
		}
	}

	jsonBytes, err := json.Marshal(group)
	if err != nil {
		return nil, fmt.Errorf("marshal form group: %w", err)
	}

	var buf bytes.Buffer
	if err := api.FillForm(bytes.NewReader(pdf), bytes.NewReader(jsonBytes), &buf, e.conf); err != nil {
		return nil, fmt.Errorf("pdfcpu fill form: %w", err)
	}
	return buf.Bytes(), nil
}

// patchForm applies values to matching fields (by ID or name), deleting each
// applied key from values so the caller can detect unknown keys.
func patchForm(f *form.Form, values map[string]string) {
	take := func(id, name string) (string, bool) {
		if v, ok := values[id]; ok {
			delete(values, id)
			return v, true
		}
		if name != "" {
			if v, ok := values[name]; ok {
				delete(values, name)
				return v, true
			}
		}
		return "", false
	}

	for _, tf := range f.TextFields {
		if v, ok := take(tf.ID, tf.Name); ok {
			tf.Value = v
		}
	}
	for _, df := range f.DateFields {
		if v, ok := take(df.ID, df.Name); ok {
			df.Value = v
		}
	}
	for _, cb := range f.CheckBoxes {
		if v, ok := take(cb.ID, cb.Name); ok {
			cb.Value = v == "true" || v == "on" || v == "1"
		}
	}
	for _, rb := range f.RadioButtonGroups {
		if v, ok := take(rb.ID, rb.Name); ok {
			rb.Value = v
		}
	}
	for _, cb := range f.ComboBoxes {
		if v, ok := take(cb.ID, cb.Name); ok {
			cb.Value = v
		}
	}
	for _, lb := range f.ListBoxes {
		if v, ok := take(lb.ID, lb.Name); ok {
			lb.Values = []string{v}
		}
	}
}

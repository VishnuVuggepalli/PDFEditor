package pdf

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/pdfcpu/pdfcpu/pkg/api"

	"github.com/VishnuVuggepalli/PDFEditor/backend/internal/document"
)

// AddFormFields creates AcroForm fields on existing pages via pdfcpu's
// form-creation path: api.Create with the current PDF as the seed and a
// generated create-JSON document.
//
// Design note — why api.Create and not hand-built AcroForm dicts: Create's
// create.FromJSON → UpdatePageTree updates pages whose number is within the
// existing page count IN PLACE (it merges the new widget annotations into the
// page's Annots and appends only pages beyond the count), and handleForm
// extends an existing AcroForm or creates a fresh one. Verified empirically:
// fields land on the targeted existing page, the page count is unchanged, and
// pre-existing fields coexist with the new ones. That makes Create strictly
// more robust than assembling field/widget dicts from pdfcpu primitives by
// hand, so we use it.
func (e *Engine) AddFormFields(pdf []byte, fields []document.NewFormField) ([]byte, error) {
	createJSON, err := buildCreateJSON(fields)
	if err != nil {
		return nil, fmt.Errorf("build create json: %w", err)
	}

	// api.Create mutates conf.Cmd; work on a copy so the shared engine
	// configuration stays untouched.
	conf := *e.conf
	var buf bytes.Buffer
	if err := api.Create(bytes.NewReader(pdf), bytes.NewReader(createJSON), &buf, &conf); err != nil {
		return nil, fmt.Errorf("pdfcpu create form fields: %w", err)
	}
	return buf.Bytes(), nil
}

// formFontID is the font resource id pdfcpu's textfield widgets resolve
// their appearance font from when the field itself names none.
const formFontID = "input"

// formFontSize is the appearance font size for created text fields.
const formFontSize = 12

/* createDoc and friends mirror the subset of pdfcpu's create-JSON schema
 * (pkg/pdfcpu/primitives) that field creation needs. */

type createFont struct {
	Name string `json:"name"`
	Size int    `json:"size"`
}

type createTextField struct {
	ID        string     `json:"id"`
	Tip       string     `json:"tip,omitempty"`
	Value     string     `json:"value,omitempty"`
	Pos       [2]float64 `json:"pos"` // lower-left corner, PDF points
	Width     float64    `json:"width"`
	Height    float64    `json:"height"`
	Multiline bool       `json:"multiline,omitempty"`
}

type createCheckBox struct {
	ID    string     `json:"id"`
	Tip   string     `json:"tip,omitempty"`
	Value bool       `json:"value"`
	Pos   [2]float64 `json:"pos"` // lower-left corner, PDF points
	Width float64    `json:"width"`
}

type createContent struct {
	TextFields []createTextField `json:"textfield,omitempty"`
	CheckBoxes []createCheckBox  `json:"checkbox,omitempty"`
}

type createPage struct {
	Content createContent `json:"content"`
}

type createDoc struct {
	// Origin LowerLeft makes pos coordinates plain PDF points, matching the
	// rect convention used by annotations and stamps.
	Origin string                `json:"origin"`
	Fonts  map[string]createFont `json:"fonts"`
	Pages  map[string]createPage `json:"pages"`
}

// buildCreateJSON renders pre-validated fields into pdfcpu create-JSON,
// grouped by page.
func buildCreateJSON(fields []document.NewFormField) ([]byte, error) {
	pages := make(map[string]createPage, len(fields))
	for _, f := range fields {
		key := fmt.Sprintf("%d", f.Page)
		page := pages[key]
		switch f.Type {
		case document.FieldText:
			page.Content.TextFields = append(page.Content.TextFields, createTextField{
				ID:        f.ID,
				Tip:       f.Label,
				Value:     f.Default,
				Pos:       [2]float64{f.Rect[0], f.Rect[1]},
				Width:     f.Rect[2] - f.Rect[0],
				Height:    f.Rect[3] - f.Rect[1],
				Multiline: f.Multiline,
			})
		case document.FieldCheckbox:
			// Checkboxes render square; use the smaller rect edge.
			w := f.Rect[2] - f.Rect[0]
			if h := f.Rect[3] - f.Rect[1]; h < w {
				w = h
			}
			page.Content.CheckBoxes = append(page.Content.CheckBoxes, createCheckBox{
				ID:    f.ID,
				Tip:   f.Label,
				Value: checkboxChecked(f.Default),
				Pos:   [2]float64{f.Rect[0], f.Rect[1]},
				Width: w,
			})
		default:
			return nil, fmt.Errorf("%w: unknown field type %q", document.ErrInvalidInput, f.Type)
		}
		pages[key] = page
	}

	doc := createDoc{
		Origin: "LowerLeft",
		Fonts:  map[string]createFont{formFontID: {Name: "Helvetica", Size: formFontSize}},
		Pages:  pages,
	}
	return json.Marshal(doc)
}

// checkboxChecked interprets the validated checkbox default spellings.
func checkboxChecked(s string) bool {
	return s == "true" || s == "on" || s == "1"
}

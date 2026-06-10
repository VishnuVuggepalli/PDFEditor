/** AcroForm fields: load, edit locally, save changed values via the form
 * endpoint (creates a new version). Also hosts the form designer: queue new
 * text/checkbox fields drawn on the page; they're created on Save. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fillForm, getFormFields } from '../../api/documents';
import { useEditorStore } from '../../state/editorStore';
import type { FieldDraftType } from '../../state/editorStore';
import { useToast } from '../shared/toastContext';
import { Icon } from '../shared/Icon';
import type { FormField } from '../../types/document';

interface Props {
  docId: string;
  /** whether the head PDF carries an AcroForm at all */
  hasForm: boolean;
  readonly: boolean;
}

export function FormsTab({ docId, hasForm, readonly }: Props) {
  const push = useToast();
  const qc = useQueryClient();
  const store = useEditorStore();
  const [edits, setEdits] = useState<Record<string, string>>({});

  const fieldsQuery = useQuery({
    queryKey: ['form', docId],
    queryFn: () => getFormFields(docId),
    enabled: hasForm,
  });

  const saveMut = useMutation({
    mutationFn: (values: Record<string, string>) => fillForm(docId, values),
    onSuccess: (doc) => {
      setEdits({});
      void qc.invalidateQueries({ queryKey: ['form', docId] });
      void qc.invalidateQueries({ queryKey: ['meta', docId] });
      void qc.invalidateQueries({ queryKey: ['documents'] });
      push({ type: 'success', title: `Saved form as v${doc.headVersion}` });
    },
  });

  /** Toggle field-placement mode; the rect is drawn on the page itself. */
  function toggleDraft(t: Exclude<FieldDraftType, null>) {
    if (store.fieldDraft === t) {
      store.setFieldDraft(null);
      return;
    }
    store.setTool('forms');
    store.setFieldDraft(t);
  }

  const pendingNames = store.fields.map((f) => f.name);
  const dupName = (name: string) => pendingNames.filter((n) => n === name).length > 1;

  const designer = !readonly && (
    <div className="ff-add">
      <div className="ff-add-title">Add fields</div>
      <div className="ff-add-btns">
        <button
          className={`btn sm ${store.fieldDraft === 'text' ? 'primary' : ''}`}
          onClick={() => toggleDraft('text')}
        >
          <Icon name="text" size={14} />
          Text field
        </button>
        <button
          className={`btn sm ${store.fieldDraft === 'checkbox' ? 'primary' : ''}`}
          onClick={() => toggleDraft('checkbox')}
        >
          <Icon name="check" size={14} />
          Checkbox
        </button>
      </div>
      {store.fieldDraft != null && (
        <p className="ff-add-hint">
          Draw a rectangle on the page to place the
          {store.fieldDraft === 'text' ? ' text field' : ' checkbox'}. Esc stops placing.
        </p>
      )}
      {store.fields.length > 0 && (
        <div className="ff-pending">
          {store.fields.map((f) => (
            <div className="ff-pending-row" key={f.id}>
              <span className="ffp-type" title={f.type}>
                <Icon name={f.type === 'text' ? 'text' : 'check'} size={13} />
              </span>
              <input
                className={dupName(f.name) || f.name.trim() === '' ? 'invalid' : ''}
                value={f.name}
                aria-label="Field name"
                onChange={(e) => store.updateField(f.id, { name: e.target.value })}
              />
              {f.type === 'text' && (
                <label className="ffp-multi" title="Multi-line text">
                  <input
                    type="checkbox"
                    checked={!!f.multiline}
                    onChange={(e) => store.updateField(f.id, { multiline: e.target.checked })}
                  />
                  multi
                </label>
              )}
              <span className="ff-pages tnum">p{f.page}</span>
              <button
                className="iconbtn"
                aria-label={`Remove field ${f.name}`}
                onClick={() => store.removeField(f.id)}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          <p className="ff-add-hint">New fields are created when you save (Ctrl+S).</p>
        </div>
      )}
    </div>
  );

  if (!hasForm) {
    return (
      <div className="forms-tab">
        {designer}
        <div className="forms-empty">
          <div className="fe-title">This document has no form fields</div>
          <p>
            Fillable (AcroForm) fields show up here automatically when a PDF
            contains them. Use “Add fields” to create your own, or annotate,
            sign and type text directly on the pages.
          </p>
        </div>
      </div>
    );
  }

  if (fieldsQuery.isLoading) {
    return (
      <div className="forms-tab">
        {designer}
        <div className="skel" style={{ height: 34, marginBottom: 8 }}></div>
        <div className="skel" style={{ height: 34, marginBottom: 8 }}></div>
        <div className="skel" style={{ height: 34 }}></div>
      </div>
    );
  }
  const fields = fieldsQuery.data ?? [];
  if (fields.length === 0) {
    return (
      <div className="forms-tab">
        {designer}
        <div className="muted">No form fields in this document.</div>
      </div>
    );
  }

  const valueOf = (f: FormField) => edits[f.name || f.id] ?? f.value;
  const dirty = Object.keys(edits).length > 0;

  return (
    <div className="forms-tab">
      {designer}
      {fields.map((f) => {
        const key = f.name || f.id;
        const disabled = readonly || f.locked;
        return (
          <div className="form-field" key={f.id}>
            <label title={f.type}>
              {key}
              {f.locked ? ' (locked)' : ''}
            </label>
            {f.type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={['on', 'yes', 'true', '1'].includes(valueOf(f).toLowerCase())}
                disabled={disabled}
                onChange={(e) =>
                  setEdits((s) => ({ ...s, [key]: e.target.checked ? 'on' : 'off' }))
                }
              />
            ) : (
              <input
                type="text"
                value={valueOf(f)}
                disabled={disabled}
                placeholder="Type here…"
                onChange={(e) => setEdits((s) => ({ ...s, [key]: e.target.value }))}
              />
            )}
            <span className="ff-pages tnum">p{f.pages.join(', p')}</span>
          </div>
        );
      })}
      <button
        className="btn primary ff-save"
        disabled={!dirty || readonly || saveMut.isPending}
        onClick={() => saveMut.mutate(edits)}
      >
        {saveMut.isPending ? 'Saving…' : 'Save form values'}
      </button>
    </div>
  );
}

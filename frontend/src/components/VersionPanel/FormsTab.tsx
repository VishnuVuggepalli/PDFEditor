/** AcroForm fields: load, edit locally, save changed values via the form
 * endpoint (creates a new version). */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fillForm, getFormFields } from '../../api/documents';
import { useToast } from '../shared/Toasts';
import type { FormField } from '../../types/document';

interface Props {
  docId: string;
  readonly: boolean;
}

export function FormsTab({ docId, readonly }: Props) {
  const push = useToast();
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});

  const fieldsQuery = useQuery({
    queryKey: ['form', docId],
    queryFn: () => getFormFields(docId),
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

  if (fieldsQuery.isLoading) {
    return (
      <div className="forms-tab">
        <div className="skel" style={{ height: 34, marginBottom: 8 }}></div>
        <div className="skel" style={{ height: 34, marginBottom: 8 }}></div>
        <div className="skel" style={{ height: 34 }}></div>
      </div>
    );
  }
  const fields = fieldsQuery.data ?? [];
  if (fields.length === 0) {
    return <div className="forms-tab muted">No form fields in this document.</div>;
  }

  const valueOf = (f: FormField) => edits[f.name || f.id] ?? f.value;
  const dirty = Object.keys(edits).length > 0;

  return (
    <div className="forms-tab">
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

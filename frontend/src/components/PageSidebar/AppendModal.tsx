/** "Append from document…" picker: choose another stored document and an
 * optional page selection to append to the end of the open one. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listDocuments } from '../../api/documents';
import { parsePageSelection } from '../../utils/pageSelection';
import { Modal } from '../shared/Modal';

interface Props {
  /** the open document — excluded from the picker */
  currentId: string;
  busy: boolean;
  onAppend: (sourceId: string, pages?: number[]) => void;
  onCancel: () => void;
}

export function AppendModal({ currentId, busy, onAppend, onCancel }: Props) {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [pagesRaw, setPagesRaw] = useState('');

  const docsQuery = useQuery({ queryKey: ['documents'], queryFn: listDocuments });
  const others = (docsQuery.data ?? []).filter((d) => d.id !== currentId);

  const pages = parsePageSelection(pagesRaw);
  const ok = sourceId != null && pages != null;

  const confirm = () => {
    if (busy || !ok || sourceId == null || pages == null) return;
    onAppend(sourceId, pages.length > 0 ? pages : undefined);
  };

  return (
    <Modal
      title="Append from document"
      confirmLabel={busy ? 'Appending…' : 'Append'}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <p className="split-hint">
        Pages are added to the end of this document as a new version. The source document is kept
        unchanged.
      </p>
      {docsQuery.isLoading ? (
        <div className="skel" style={{ height: 80 }}></div>
      ) : others.length === 0 ? (
        <p className="muted">No other documents in your library.</p>
      ) : (
        <>
          <div className="append-list scroll" role="radiogroup" aria-label="Source document">
            {others.map((d) => (
              <label key={d.id} className={`append-doc ${sourceId === d.id ? 'on' : ''}`}>
                <input
                  type="radio"
                  name="append-source"
                  checked={sourceId === d.id}
                  onChange={() => setSourceId(d.id)}
                />
                <span className="ad-name">{d.name}</span>
                <span className="ad-ver tnum">v{d.headVersion}</span>
              </label>
            ))}
          </div>
          <div className={`append-pages ${pages == null ? 'invalid' : ''}`}>
            <label htmlFor="append-pages-input">Pages</label>
            <input
              id="append-pages-input"
              type="text"
              placeholder="all (e.g. 1,3-5)"
              value={pagesRaw}
              onChange={(e) => setPagesRaw(e.target.value)}
            />
          </div>
          {pages == null && (
            <div className="split-err">Use page numbers and ranges, e.g. 1,3-5</div>
          )}
        </>
      )}
    </Modal>
  );
}

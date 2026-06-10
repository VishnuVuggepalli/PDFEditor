/** Split modal: page-range builder (from/to rows, validated against the
 * document's page count) with a live preview of the documents it creates. */
import { useState } from 'react';
import { splitPreview, validateRanges } from '../../utils/splitRanges';
import type { RangeRow } from '../../utils/splitRanges';
import type { SplitRange } from '../../types/document';
import { Icon } from '../shared/Icon';
import { Modal } from '../shared/Modal';

interface Props {
  pageCount: number;
  busy: boolean;
  onSplit: (ranges: SplitRange[]) => void;
  onCancel: () => void;
}

const rowUid = () => 'rr_' + Math.random().toString(36).slice(2, 9);

export function SplitModal({ pageCount, busy, onSplit, onCancel }: Props) {
  const [rows, setRows] = useState<RangeRow[]>([{ id: rowUid(), from: '1', to: String(pageCount) }]);
  const validation = validateRanges(rows, pageCount);
  const preview = splitPreview(validation.ranges);

  const setField = (id: string, field: 'from' | 'to', value: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  const addRow = () => setRows((rs) => [...rs, { id: rowUid(), from: '', to: '' }]);
  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));

  const confirm = () => {
    if (busy || !validation.ok) return;
    onSplit(validation.ranges);
  };

  return (
    <Modal
      title="Split document"
      confirmLabel={busy ? 'Splitting…' : 'Split'}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <p className="split-hint">
        Each range becomes a new document ({pageCount} {pageCount === 1 ? 'page' : 'pages'} total).
        The original is kept unchanged.
      </p>
      <div className="split-rows">
        {rows.map((r, i) => (
          <div key={r.id}>
            <div className={`split-row ${validation.rowErrors[i] ? 'invalid' : ''}`}>
              <span className="sr-label">Pages</span>
              <input
                type="number"
                name="from"
                min={1}
                max={pageCount}
                aria-label={`Range ${i + 1} from`}
                value={r.from}
                onChange={(e) => setField(r.id, 'from', e.target.value)}
              />
              <span className="sr-dash">–</span>
              <input
                type="number"
                name="to"
                min={1}
                max={pageCount}
                aria-label={`Range ${i + 1} to`}
                value={r.to}
                onChange={(e) => setField(r.id, 'to', e.target.value)}
              />
              <button
                className="iconbtn"
                aria-label={`Remove range ${i + 1}`}
                disabled={rows.length === 1}
                onClick={() => removeRow(r.id)}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
            {validation.rowErrors[i] && r.from !== '' && r.to !== '' && (
              <div className="split-err">{validation.rowErrors[i]}</div>
            )}
          </div>
        ))}
      </div>
      <button className="btn sm split-add" onClick={addRow}>
        <Icon name="plus" size={14} />
        Add range
      </button>
      <div className={`split-preview ${validation.ok ? '' : 'muted'}`}>
        {validation.ok ? preview : 'Enter valid page ranges to split.'}
      </div>
    </Modal>
  );
}

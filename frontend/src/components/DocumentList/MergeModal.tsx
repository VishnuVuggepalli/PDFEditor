/** Merge modal: orderable list of the selected documents (up/down buttons)
 * plus a name input for the combined document. */
import { useEffect, useRef, useState } from 'react';
import { moveItem } from '../../utils/mergeOrder';
import { Icon } from '../shared/Icon';
import { Modal } from '../shared/Modal';
import type { DocumentRecord } from '../../types/document';

interface Props {
  /** selected documents, in selection order (initial merge order) */
  docs: DocumentRecord[];
  busy: boolean;
  onMerge: (ids: string[], name: string) => void;
  onCancel: () => void;
}

const DEFAULT_NAME = 'merged.pdf';

export function MergeModal({ docs, busy, onMerge, onCancel }: Props) {
  const [order, setOrder] = useState<DocumentRecord[]>(docs);
  const [name, setName] = useState(DEFAULT_NAME);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const confirm = () => {
    if (busy || !name.trim()) return;
    onMerge(
      order.map((d) => d.id),
      name.trim(),
    );
  };

  return (
    <Modal
      title={`Merge ${order.length} documents`}
      confirmLabel={busy ? 'Merging…' : 'Merge'}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <p className="merge-hint">Pages are combined in this order. Sources are kept unchanged.</p>
      <div className="merge-list">
        {order.map((d, i) => (
          <div className="merge-item" key={d.id}>
            <span className="mi-pos">{i + 1}</span>
            <span className="mi-name" title={d.name}>
              {d.name}
            </span>
            <button
              className="iconbtn"
              aria-label={`Move ${d.name} up`}
              disabled={i === 0}
              onClick={() => setOrder((o) => moveItem(o, i, -1))}
            >
              <Icon name="chevUp" size={15} />
            </button>
            <button
              className="iconbtn"
              aria-label={`Move ${d.name} down`}
              disabled={i === order.length - 1}
              onClick={() => setOrder((o) => moveItem(o, i, 1))}
            >
              <Icon name="chevDown" size={15} />
            </button>
          </div>
        ))}
      </div>
      <label className="merge-name">
        <span>Name</span>
        <input
          ref={nameRef}
          className="rename-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
    </Modal>
  );
}

import { useState } from 'react';
import { fmtBytes, relTime } from '../../utils/format';
import { Icon } from '../shared/Icon';
import { Modal } from '../shared/Modal';
import type { Version } from '../../types/document';

interface Props {
  versions: Version[];
  headVersion: number;
  viewing: number | null;
  onView: (n: number) => void;
  onRestore: (n: number) => void;
  onDelete: (n: number) => void;
}

/** Pending confirmation for a destructive/creative version action. */
type Confirm = { kind: 'restore' | 'delete'; n: number } | null;

export function VersionsTab({ versions, headVersion, viewing, onView, onRestore, onDelete }: Props) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const newestFirst = [...versions].sort((a, b) => b.n - a.n);
  return (
    <div className="vtl">
      {newestFirst.map((v) => {
        const isHead = v.n === headVersion;
        // v1 (the original upload) and the head can never be deleted.
        const deletable = !isHead && v.n !== 1;
        return (
          <div key={v.n} className={`vrow ${isHead ? 'head' : ''} ${viewing === v.n ? 'viewing' : ''}`}>
            <span className="vdot"></span>
            <div className="vcard">
              <div className="v-top">
                <span className="v-name">v{v.n}</span>
                {isHead && (
                  <span className="badge current" style={{ height: 18, fontSize: 10.5, padding: '0 7px' }}>
                    current
                  </span>
                )}
                {viewing === v.n && (
                  <span className="badge amber" style={{ height: 18, fontSize: 10.5 }}>
                    viewing
                  </span>
                )}
                <span className="v-time">{relTime(v.createdAt)}</span>
              </div>
              <div className="v-sum">{v.ops}</div>
              <div className="v-size">{fmtBytes(v.size)}</div>
              {!isHead && (
                <div className="v-acts">
                  <button onClick={() => onView(v.n)}>
                    <Icon name="eye" />
                    View
                  </button>
                  <button onClick={() => setConfirm({ kind: 'restore', n: v.n })}>
                    <Icon name="restore" />
                    Restore
                  </button>
                  {deletable && (
                    <button onClick={() => setConfirm({ kind: 'delete', n: v.n })}>
                      <Icon name="trash" />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {confirm?.kind === 'restore' && (
        <Modal
          title={`Restore v${confirm.n}?`}
          confirmLabel="Restore"
          cancelLabel="Cancel"
          onConfirm={() => {
            const v = confirm.n;
            setConfirm(null);
            onRestore(v);
          }}
          onCancel={() => setConfirm(null)}
        >
          This creates a new version from the contents of{' '}
          <strong style={{ color: 'var(--text)' }}>v{confirm.n}</strong>. Your current version is kept
          in history — nothing is lost.
        </Modal>
      )}
      {confirm?.kind === 'delete' && (
        <Modal
          title={`Delete v${confirm.n}?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          onConfirm={() => {
            const v = confirm.n;
            setConfirm(null);
            onDelete(v);
          }}
          onCancel={() => setConfirm(null)}
        >
          <strong style={{ color: 'var(--text)' }}>v{confirm.n}</strong> will be permanently removed
          from this document’s history. The original (v1) and your current version are not affected.
          This can’t be undone.
        </Modal>
      )}
    </div>
  );
}

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
}

export function VersionsTab({ versions, headVersion, viewing, onView, onRestore }: Props) {
  const [confirm, setConfirm] = useState<number | null>(null);
  const newestFirst = [...versions].sort((a, b) => b.n - a.n);
  return (
    <div className="vtl">
      {newestFirst.map((v) => {
        const isHead = v.n === headVersion;
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
                  <button onClick={() => setConfirm(v.n)}>
                    <Icon name="restore" />
                    Restore
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {confirm != null && (
        <Modal
          title={`Restore v${confirm}?`}
          confirmLabel="Restore"
          cancelLabel="Cancel"
          onConfirm={() => {
            const v = confirm;
            setConfirm(null);
            onRestore(v);
          }}
          onCancel={() => setConfirm(null)}
        >
          This creates a new version from the contents of{' '}
          <strong style={{ color: 'var(--text)' }}>v{confirm}</strong>. Your current version is kept
          in history — nothing is lost.
        </Modal>
      )}
    </div>
  );
}

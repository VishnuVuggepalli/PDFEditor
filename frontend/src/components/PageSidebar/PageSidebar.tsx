/** Left page-thumbnail rail with rotate/delete/restore and drag reorder. */
import { Fragment, useState } from 'react';
import { Icon } from '../shared/Icon';
import { Tip } from '../shared/Tip';
import { PdfThumb } from '../../pdf/PdfThumb';
import type { PdfHandle } from '../../pdf/engine';
import type { EditorPage } from '../../state/opsQueue';

interface Props {
  pdf?: PdfHandle | null;
  pages?: ReadonlyArray<EditorPage>;
  activeId?: string | null;
  onJump?: (id: string) => void;
  onRotate?: (id: string, delta: number) => void;
  onDelete?: (id: string) => void;
  onRestore?: (id: string) => void;
  onReorder?: (from: number, to: number) => void;
  readonly?: boolean;
  loading?: boolean;
}

export function PageSidebar(props: Props) {
  const { pdf, pages = [], activeId, onJump, onRotate, onDelete, onRestore, onReorder, readonly, loading } = props;
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  function handleDrop() {
    if (drag != null && over != null && onReorder) {
      let to = over;
      if (to > drag) to -= 1;
      if (to !== drag) onReorder(drag, to);
    }
    setDrag(null);
    setOver(null);
  }

  if (loading || !pdf) {
    return (
      <aside className="psb">
        <div className="psb-head">
          <span className="ttl">Pages</span>
        </div>
        <div className="psb-list scroll">
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="psb-skel" key={i}>
              <div className="sk skel"></div>
            </div>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="psb">
      <div className="psb-head">
        <span className="ttl">Pages</span>
        <span className="ttl" style={{ letterSpacing: 0, textTransform: 'none', fontWeight: 600 }}>
          {pages.filter((p) => !p.deleted).length}
        </span>
      </div>
      <div className="psb-list scroll" onDragOver={(e) => e.preventDefault()}>
        {pages.map((p, i) => (
          <Fragment key={p.id}>
            {over === i && drag != null && <div className="drop-line"></div>}
            <div
              className={`thumb-item ${activeId === p.id ? 'current' : ''} ${p.deleted ? 'deleted' : ''} ${drag === i ? 'dragging' : ''}`}
              draggable={!readonly && !p.deleted}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnter={() => {
                if (drag != null) setOver(i > drag ? i + 1 : i);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                setOver(after ? i + 1 : i);
              }}
              onDragEnd={handleDrop}
              onDrop={handleDrop}
              onClick={() => onJump?.(p.id)}
            >
              <div className="thumb-frame">
                <div className="thumb-pdf">
                  <PdfThumb pdf={pdf} page={p.origN} width={132} rotation={p.rotDelta} />
                </div>
                {!p.deleted && !readonly && (
                  <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
                    <Tip label="Rotate left" pos="bottom">
                      <button className="ta" onClick={() => onRotate?.(p.id, -90)}>
                        <Icon name="rotL" />
                      </button>
                    </Tip>
                    <Tip label="Rotate right" pos="bottom">
                      <button className="ta" onClick={() => onRotate?.(p.id, 90)}>
                        <Icon name="rotR" />
                      </button>
                    </Tip>
                    <Tip label="Delete page" pos="bottom">
                      <button className="ta danger" onClick={() => onDelete?.(p.id)}>
                        <Icon name="trash" />
                      </button>
                    </Tip>
                  </div>
                )}
                {p.deleted && !readonly && (
                  <div className="thumb-restore" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => onRestore?.(p.id)}>
                      <Icon name="restore" />
                      Restore
                    </button>
                  </div>
                )}
              </div>
              <div className="thumb-num">{i + 1}</div>
            </div>
          </Fragment>
        ))}
        {over === pages.length && drag != null && <div className="drop-line"></div>}
      </div>
    </aside>
  );
}

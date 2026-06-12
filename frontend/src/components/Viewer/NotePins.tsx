/** Numbered comment pins with an open/edit popover. */
import { useState } from 'react';
import { pdfRectToViewport } from '../../pdf/coords';
import type { ViewportParams } from '../../pdf/coords';
import type { PendingAnnotation } from '../../state/opsQueue';
import { Icon } from '../shared/Icon';

interface Props {
  notes: ReadonlyArray<PendingAnnotation>;
  vp: ViewportParams;
  readonly: boolean;
  openNote: string | null;
  setOpenNote: (id: string | null) => void;
  onUpdate: (id: string, patch: { contents?: string }) => void;
  onRemove: (id: string) => void;
  /** present while the Select tool is active: pins become drag-to-move */
  dragHandlers?: (a: PendingAnnotation) => React.DOMAttributes<HTMLElement>;
  dragOffset?: (id: string) => React.CSSProperties;
}

export function NotePins({
  notes, vp, readonly, openNote, setOpenNote, onUpdate, onRemove, dragHandlers, dragOffset,
}: Props) {
  // Editor text, keyed by the note it belongs to; re-seeded during render
  // when a different note is opened (React's "adjust state on prop change"
  // pattern — avoids an extra effect pass).
  const [edit, setEdit] = useState<{ id: string | null; text: string }>({ id: null, text: '' });
  if (openNote !== edit.id) {
    setEdit({ id: openNote, text: notes.find((n) => n.id === openNote)?.contents ?? '' });
  }
  const noteText = edit.text;
  const setNoteText = (text: string) => setEdit((e) => ({ ...e, text }));

  return (
    <>
      {notes.map((a, i) => {
        const r = pdfRectToViewport(a.rect, vp);
        const open = openNote === a.id;
        return (
          <div
            key={a.id}
            className={'cm-pin' + (dragHandlers ? ' an-drag' : '')}
            style={{ left: r.x + r.w / 2, top: r.y + r.h / 2, ...dragOffset?.(a.id) }}
            {...dragHandlers?.(a)}
          >
            <button
              className={'cm-dot' + (open ? ' open' : '')}
              onClick={(e) => {
                e.stopPropagation();
                setOpenNote(open ? null : a.id);
                setNoteText(a.contents ?? '');
              }}
            >
              {i + 1}
            </button>
            {open && (
              <div className="cm-pop" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                {readonly ? (
                  <div className="cm-read">{a.contents || <span className="muted">No comment</span>}</div>
                ) : (
                  <textarea
                    autoFocus
                    value={noteText}
                    placeholder="Add a comment…"
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={3}
                  />
                )}
                {!readonly && (
                  <div className="cm-acts">
                    <button
                      className="cm-del"
                      onClick={() => {
                        onRemove(a.id);
                        setOpenNote(null);
                      }}
                    >
                      <Icon name="trash" size={13} />
                      Delete
                    </button>
                    <button
                      className="cm-save"
                      onClick={() => {
                        if (!noteText.trim()) onRemove(a.id);
                        else onUpdate(a.id, { contents: noteText });
                        setOpenNote(null);
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

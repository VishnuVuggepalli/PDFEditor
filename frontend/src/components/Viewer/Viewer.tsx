/** Center continuous page viewer: zoom, scroll tracking, search, amber
 * read-only banner when viewing an old version. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PdfHandle } from '../../pdf/engine';
import type { PdfRect, ViewportParams } from '../../pdf/coords';
import type { EditorPage, PendingAnnotation, PendingStamp } from '../../state/opsQueue';
import type { AnnotStyle, Tool, Zoom } from '../../state/editorStore';
import { Icon } from '../shared/Icon';
import { AnnotToolbar } from './AnnotToolbar';
import { PageView } from './PageView';
import { SearchPopover } from './SearchPopover';

const BASE_W = 660;

export interface SearchState {
  open: boolean;
  q: string;
  active: number;
}

interface Props {
  pdf: PdfHandle;
  pages: ReadonlyArray<EditorPage>;
  activeId: string | null;
  zoom: Zoom;
  jumpToken: { id: string; t: number } | null;
  onActivePage: (id: string) => void;
  search: SearchState;
  setSearch: (s: SearchState) => void;
  viewing: number | null;
  onExitVersion: () => void;
  tool: Tool;
  annotStyle: AnnotStyle;
  setAnnotStyle: (patch: Partial<AnnotStyle>) => void;
  annots: ReadonlyArray<PendingAnnotation>;
  stamps: ReadonlyArray<PendingStamp>;
  onAddAnnot: (a: PendingAnnotation) => void;
  onUpdateAnnot: (id: string, patch: { contents?: string; rect?: PdfRect }) => void;
  onRemoveAnnot: (id: string) => void;
  onRemoveStamp: (id: string) => void;
  onSign: (page: number, at: [number, number], vp: ViewportParams) => void;
  /** in-place text edit result (mupdf engine only) */
  onContentEdited?: (bytes: Uint8Array) => Promise<void>;
}

export function Viewer(props: Props) {
  const {
    pdf, pages, activeId, zoom, jumpToken, onActivePage, search, setSearch,
    viewing, onExitVersion, tool, annotStyle, setAnnotStyle,
    annots, stamps, onAddAnnot, onUpdateAnnot, onRemoveAnnot, onRemoveStamp, onSign,
    onContentEdited,
  } = props;
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageNodes = useRef<Record<string, HTMLDivElement | null>>({});
  const [dims, setDims] = useState({ w: 900, h: 700 });
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});

  const visible = useMemo(() => pages.filter((p) => !p.deleted), [pages]);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  let pageW: number;
  if (zoom === 'fit-width') pageW = Math.max(320, dims.w - 64);
  else if (zoom === 'fit-page') pageW = Math.max(320, (dims.h - 64) * (8.5 / 11));
  else pageW = BASE_W * (zoom / 100);
  pageW = Math.min(pageW, 1100);

  // Track the page closest to viewport center.
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    let raf = 0;
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const host = viewerRef.current;
        if (!host) return;
        const center = host.scrollTop + host.clientHeight / 2;
        let best: string | null = null;
        let bestD = Infinity;
        for (const p of visible) {
          const node = pageNodes.current[p.id];
          if (!node) continue;
          const mid = node.offsetTop + node.offsetHeight / 2;
          const d = Math.abs(mid - center);
          if (d < bestD) {
            bestD = d;
            best = p.id;
          }
        }
        if (best) onActivePage(best);
      });
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [visible, onActivePage]);

  // External jump (sidebar click / keyboard).
  useEffect(() => {
    if (!jumpToken) return;
    const node = pageNodes.current[jumpToken.id];
    const viewer = viewerRef.current;
    if (node && viewer) {
      viewer.scrollTo({ top: node.offsetTop - 28, behavior: 'smooth' });
    }
  }, [jumpToken]);

  // Cache page plain text for search counting.
  useEffect(() => {
    if (!search.open || !search.q.trim()) return;
    let alive = true;
    void (async () => {
      try {
        const texts: Record<number, string> = {};
        for (const p of visible) {
          const h = await pdf.page(p.origN);
          texts[p.origN] = (await h.text()).toLowerCase();
          if (!alive) return;
        }
        if (alive) setPageTexts(texts);
      } catch {
        // document was destroyed mid-extraction; search simply has no counts
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdf, visible, search.open, search.q]);

  const q = search.q.trim().toLowerCase();
  const counts = useMemo(() => {
    if (!q) return visible.map(() => 0);
    return visible.map((p) => {
      const text = pageTexts[p.origN];
      if (!text) return 0;
      let n = 0;
      let pos = 0;
      for (;;) {
        const idx = text.indexOf(q, pos);
        if (idx === -1) break;
        n += 1;
        pos = idx + q.length;
      }
      return n;
    });
  }, [q, visible, pageTexts]);
  const total = counts.reduce((a, b) => a + b, 0);
  const active = total > 0 ? Math.min(search.active, total - 1) : 0;

  // Page index + local match index of the active match.
  let activePageIdx = -1;
  let activeLocal = -1;
  if (q && total > 0) {
    let acc = 0;
    for (let i = 0; i < counts.length; i++) {
      if (active < acc + counts[i]) {
        activePageIdx = i;
        activeLocal = active - acc;
        break;
      }
      acc += counts[i];
    }
  }

  // Jump to the page containing the active match.
  useEffect(() => {
    if (activePageIdx < 0) return;
    const p = visible[activePageIdx];
    if (!p) return;
    const node = pageNodes.current[p.id];
    const viewer = viewerRef.current;
    if (node && viewer) {
      const top = node.offsetTop - 28;
      if (Math.abs(viewer.scrollTop - top) > viewer.clientHeight * 0.9) {
        viewer.scrollTo({ top, behavior: 'smooth' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageIdx, q]);

  const activeIdx = Math.max(0, visible.findIndex((p) => p.id === activeId));

  return (
    <div className="viewer-wrap">
      {viewing == null && <AnnotToolbar tool={tool} style={annotStyle} setStyle={setAnnotStyle} />}
      {viewing != null && (
        <div className="amber-banner">
          <span>
            <Icon name="eye" size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
            Viewing v{viewing} (read-only)
          </span>
          <button onClick={onExitVersion}>
            <Icon name="back" size={14} />
            Back to current
          </button>
        </div>
      )}
      <div className="viewer scroll" ref={viewerRef}>
        {visible.length === 0 ? (
          <div className="viewer-empty">
            All pages are pending deletion. Restore a page or save to continue.
          </div>
        ) : (
          <div className="viewer-pages">
            {visible.map((p, i) => (
              <PageView
                key={p.id}
                pdf={pdf}
                page={p}
                targetW={pageW}
                tool={viewing != null ? 'select' : tool}
                style={annotStyle}
                readonly={viewing != null}
                annots={annots.filter((a) => a.page === p.origN)}
                stamps={stamps.filter((s) => s.page === p.origN)}
                onAdd={onAddAnnot}
                onUpdate={onUpdateAnnot}
                onRemove={onRemoveAnnot}
                onRemoveStamp={onRemoveStamp}
                onSign={onSign}
                searchQ={search.open ? search.q : ''}
                searchActiveLocal={i === activePageIdx ? activeLocal : -1}
                registerNode={(id, el) => {
                  pageNodes.current[id] = el;
                }}
                onContentEdited={viewing != null ? undefined : onContentEdited}
              />
            ))}
          </div>
        )}
        {search.open && (
          <SearchPopover
            q={search.q}
            setQ={(qq) => setSearch({ ...search, q: qq, active: 0 })}
            count={total}
            active={active}
            setActive={(a) => setSearch({ ...search, active: a })}
            onClose={() => setSearch({ open: false, q: '', active: 0 })}
          />
        )}
      </div>
      {visible.length > 0 && (
        <div className="page-pill">
          {activeIdx + 1} / {visible.length}
        </div>
      )}
    </div>
  );
}

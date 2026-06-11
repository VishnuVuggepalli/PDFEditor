import { fmtBytes } from '../../utils/format';
import { configuredEngine, setEngineOverride } from '../../pdf/engineLoader';
import { useSignatures } from '../../api/useSignatures';
import { signatureBadge } from '../../utils/signature';
import { Icon } from '../shared/Icon';
import type { DocumentMeta } from '../../types/document';

/** Debug toggle: persist the other engine as a localStorage override and
 * reload so every open document re-renders through it. */
function EngineRow() {
  const engine = configuredEngine();
  const other = engine === 'mupdf' ? 'pdfjs' : 'mupdf';
  return (
    <div className="info-row">
      <span className="k">Renderer</span>
      <span className="v">
        {engine}{' '}
        <button
          className="badge"
          type="button"
          title={`Switch to the ${other} engine (persists in this browser)`}
          onClick={() => {
            setEngineOverride(other);
            window.location.reload();
          }}
        >
          use {other}
        </button>
      </span>
    </div>
  );
}

/** Validation badges for the document's digital signatures; hidden when the
 * head version has none. "Unknown signer" is the expected status for
 * documents signed elsewhere with a self-signed identity. */
function SignaturesRow({ docId, headVersion }: { docId: string; headVersion: number }) {
  const sigs = useSignatures(docId, headVersion);
  if (sigs.length === 0) return null;
  return (
    <div className="info-row">
      <span className="k">Signatures</span>
      <span className="v info-sigs">
        {sigs.map((s, i) => {
          const b = signatureBadge(s);
          const when = s.signedAt ? new Date(s.signedAt).toLocaleString() : '';
          const detail = [s.signingReason, s.location, when].filter(Boolean).join(' · ');
          return (
            <span key={i} className={`badge ${b.tone}`} title={detail || undefined}>
              <Icon name={s.status === 'valid' ? 'checkCircle' : 'alert'} size={12} />
              {b.label}
            </span>
          );
        })}
      </span>
    </div>
  );
}

export function InfoTab({ meta, visiblePages }: { meta: DocumentMeta; visiblePages: number }) {
  const doc = meta.document;
  const head = doc.versions[doc.versions.length - 1];
  const created = new Date(doc.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return (
    <div>
      <div className="info-row">
        <span className="k">Filename</span>
        <span className="v">{doc.name}</span>
      </div>
      <div className="info-row">
        <span className="k">Pages</span>
        <span className="v tnum">{visiblePages}</span>
      </div>
      <div className="info-row">
        <span className="k">File size</span>
        <span className="v tnum">{head ? fmtBytes(head.size) : '—'}</span>
      </div>
      <div className="info-row">
        <span className="k">Version</span>
        <span className="v">v{doc.headVersion}</span>
      </div>
      <div className="info-row">
        <span className="k">Created</span>
        <span className="v">{created}</span>
      </div>
      <EngineRow />
      <SignaturesRow docId={doc.id} headVersion={doc.headVersion} />
      <div className="info-badges">
        {meta.pdf.hasForm && (
          <span className="badge accent">
            <Icon name="forms" size={12} />
            Form fields
          </span>
        )}
        {meta.pdf.encrypted && (
          <span className="badge amber">
            <Icon name="lock" size={12} />
            Encrypted
          </span>
        )}
        {!meta.pdf.hasForm && !meta.pdf.encrypted && <span className="badge">No special attributes</span>}
      </div>
    </div>
  );
}

import { fmtBytes, relTime, truncMid } from '../../utils/format';
import { Kebab } from '../shared/Kebab';
import { docMenu } from './docMenu';
import type { DocActions } from './docMenu';
import { DocThumb, useDocPdf } from './DocThumb';
import type { DocumentRecord } from '../../types/document';

interface Props {
  doc: DocumentRecord;
  actions: DocActions;
}

export function DocCard({ doc, actions }: Props) {
  const { pdf } = useDocPdf(doc.id, doc.headVersion);
  const head = doc.versions[doc.versions.length - 1];
  const pages = pdf?.pageCount ?? null;
  return (
    <div className="doc-card" onClick={() => actions.onOpen(doc.id)}>
      <div className="dc-thumb">
        <DocThumb pdf={pdf} width={210} />
        {pages !== null && (
          <span className="dc-pagecount">
            {pages} {pages === 1 ? 'page' : 'pages'}
          </span>
        )}
      </div>
      <div className="dc-meta">
        <div className="dc-name">
          <span className="nm" title={doc.name}>
            {truncMid(doc.name, 28)}
          </span>
        </div>
        <div className="dc-sub">
          <span>{head ? fmtBytes(head.size) : ''}</span>
        </div>
        <div className="dc-foot">
          <span className="dc-ver">
            <span className="vtag">v{doc.headVersion}</span> · {relTime(head?.createdAt ?? doc.createdAt)}
          </span>
          <div className="kebab-host" onClick={(e) => e.stopPropagation()}>
            <Kebab items={docMenu(doc, actions)} />
          </div>
        </div>
      </div>
    </div>
  );
}

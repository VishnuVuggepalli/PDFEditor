import { fmtBytes, relTime, truncMid } from '../../utils/format';
import { Kebab } from '../shared/Kebab';
import { docMenu } from './docMenu';
import type { DocActions } from './docMenu';
import { DocThumb } from './DocThumb';
import { useDocPageCount } from './useDocPageCount';
import type { DocumentRecord } from '../../types/document';

interface Props {
  doc: DocumentRecord;
  actions: DocActions;
}

export function DocRow({ doc, actions }: Props) {
  const pages = useDocPageCount(doc.id, doc.headVersion);
  const head = doc.versions[doc.versions.length - 1];
  return (
    <div className="doc-row" onClick={() => actions.onOpen(doc.id)}>
      <div className="dr-thumb">
        <DocThumb docId={doc.id} headVersion={doc.headVersion} width={40} />
      </div>
      <div className="dr-main">
        <div className="dr-name">
          <span className="nm" title={doc.name}>
            {truncMid(doc.name, 44)}
          </span>
        </div>
      </div>
      <div className="dr-col tnum">
        {pages !== null ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : '—'}
      </div>
      <div className="dr-col tnum">{head ? fmtBytes(head.size) : ''}</div>
      <div className="dr-col">
        <span className="dc-ver">
          <span className="vtag">v{doc.headVersion}</span> · {relTime(head?.createdAt ?? doc.createdAt)}
        </span>
      </div>
      <div className="dr-kebab" onClick={(e) => e.stopPropagation()}>
        <Kebab items={docMenu(doc, actions)} />
      </div>
    </div>
  );
}

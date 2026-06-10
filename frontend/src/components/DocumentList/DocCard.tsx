import { fmtBytes, relTime, truncMid } from '../../utils/format';
import { Icon } from '../shared/Icon';
import { Kebab } from '../shared/Kebab';
import { docMenu } from './docMenu';
import type { DocActions } from './docMenu';
import { DocThumb } from './DocThumb';
import { useDocPageCount } from './useDocPageCount';
import type { DocumentRecord } from '../../types/document';

export interface SelectionProps {
  /** select mode is on — checkboxes always visible, click toggles */
  selecting: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  /** freshly created (e.g. by merge) — briefly highlighted */
  highlight?: boolean;
}

interface Props {
  doc: DocumentRecord;
  actions: DocActions;
  selection: SelectionProps;
}

export function DocCard({ doc, actions, selection }: Props) {
  const pages = useDocPageCount(doc.id, doc.headVersion);
  const head = doc.versions[doc.versions.length - 1];
  const { selecting, selected, onToggleSelect, highlight } = selection;
  const cls = [
    'doc-card',
    selecting ? 'selecting' : '',
    selected ? 'selected' : '',
    highlight ? 'is-new' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={cls}
      onClick={() => (selecting ? onToggleSelect(doc.id) : actions.onOpen(doc.id))}
    >
      <div className="dc-thumb">
        <DocThumb docId={doc.id} headVersion={doc.headVersion} width={210} />
        <button
          className="dc-check"
          aria-label={selected ? `Deselect ${doc.name}` : `Select ${doc.name}`}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(doc.id);
          }}
        >
          {selected && <Icon name="check" size={13} stroke={2.6} />}
        </button>
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

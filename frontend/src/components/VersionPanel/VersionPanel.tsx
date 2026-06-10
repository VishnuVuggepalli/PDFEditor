/** Right panel: Info / Versions / Forms tabs, collapsible rail. */
import { Icon } from '../shared/Icon';
import { Tip } from '../shared/Tip';
import { FormsTab } from './FormsTab';
import { InfoTab } from './InfoTab';
import { VersionsTab } from './VersionsTab';
import type { DocumentMeta } from '../../types/document';

export type PanelTab = 'info' | 'versions' | 'forms';

interface Props {
  meta: DocumentMeta;
  visiblePages: number;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  viewing: number | null;
  onView: (n: number) => void;
  onRestore: (n: number) => void;
}

export function VersionPanel(props: Props) {
  const { meta, visiblePages, collapsed, setCollapsed, tab, setTab, viewing, onView, onRestore } = props;
  const hasForm = meta.pdf.hasForm;

  if (collapsed) {
    return (
      <aside className="rpanel collapsed">
        <div className="rp-tabs">
          <Tip label="Expand panel" pos="bottom">
            <button className="iconbtn" onClick={() => setCollapsed(false)}>
              <Icon name="chevLeft" />
            </button>
          </Tip>
        </div>
        <div className="rp-rail">
          <Tip label="Info" pos="bottom">
            <button
              className="iconbtn"
              onClick={() => {
                setCollapsed(false);
                setTab('info');
              }}
            >
              <Icon name="info" />
            </button>
          </Tip>
          <Tip label="Versions" pos="bottom">
            <button
              className="iconbtn"
              onClick={() => {
                setCollapsed(false);
                setTab('versions');
              }}
            >
              <Icon name="clock" />
            </button>
          </Tip>
          <Tip label="Forms" pos="bottom">
            <button
              className="iconbtn"
              onClick={() => {
                setCollapsed(false);
                setTab('forms');
              }}
            >
              <Icon name="forms" />
            </button>
          </Tip>
        </div>
      </aside>
    );
  }
  return (
    <aside className="rpanel">
      <div className="rp-tabs">
        <button className={`rp-tab ${tab === 'info' ? 'on' : ''}`} onClick={() => setTab('info')}>
          Info
        </button>
        <button
          className={`rp-tab ${tab === 'versions' ? 'on' : ''}`}
          onClick={() => setTab('versions')}
        >
          Versions
        </button>
        <button className={`rp-tab ${tab === 'forms' ? 'on' : ''}`} onClick={() => setTab('forms')}>
          Forms
        </button>
        <Tip label="Collapse" pos="bottom">
          <button className="iconbtn rp-collapse" onClick={() => setCollapsed(true)}>
            <Icon name="chevRight" />
          </button>
        </Tip>
      </div>
      <div className="rp-body scroll">
        {tab === 'info' && <InfoTab meta={meta} visiblePages={visiblePages} />}
        {tab === 'versions' && (
          <VersionsTab
            versions={meta.document.versions}
            headVersion={meta.document.headVersion}
            viewing={viewing}
            onView={onView}
            onRestore={onRestore}
          />
        )}
        {tab === 'forms' && (
          <FormsTab docId={meta.document.id} hasForm={hasForm} readonly={viewing != null} />
        )}
      </div>
    </aside>
  );
}

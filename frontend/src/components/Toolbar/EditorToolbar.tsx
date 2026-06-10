/** Top toolbar: breadcrumbs, annotation tools, zoom, undo/redo, save. */
import { Icon } from '../shared/Icon';
import { Kebab } from '../shared/Kebab';
import { Tip } from '../shared/Tip';
import { ZoomControl } from './ZoomControl';
import type { Tool, Zoom } from '../../state/editorStore';

interface ToolDef {
  id: Tool;
  label: string;
  icon: string;
  enabled: boolean;
  sub?: string;
}

interface Props {
  name: string;
  tool: Tool;
  setTool: (t: Tool) => void;
  dirty: boolean;
  hasForm: boolean;
  zoom: Zoom;
  zoomLabel: string;
  setZoom: (z: Zoom) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  pendingCount: number;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
  onToggleSearch: () => void;
  viewing: number | null;
  onRename: () => void;
  onDuplicate: () => void;
  onSplit: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

export function EditorToolbar(props: Props) {
  const {
    name, tool, setTool, dirty, hasForm, zoom, zoomLabel, setZoom,
    canUndo, canRedo, undo, redo, pendingCount, saving, onSave, onBack,
    onToggleSearch, viewing, onRename, onDuplicate, onSplit, onDownload, onDelete,
  } = props;
  const readonly = viewing != null;

  const tools: ToolDef[] = [
    { id: 'select', label: 'Select', icon: 'cursor', enabled: true },
    { id: 'highlight', label: 'Highlight', icon: 'highlight', enabled: true },
    { id: 'comment', label: 'Comment', icon: 'comment', enabled: true },
    { id: 'draw', label: 'Draw', icon: 'pen', enabled: true },
    { id: 'shapes', label: 'Shapes', icon: 'shapes', enabled: true },
    { id: 'text', label: 'Text', icon: 'text', enabled: true },
    { id: 'sign', label: 'Sign', icon: 'sign', enabled: true },
    { id: 'forms', label: 'Forms', icon: 'forms', enabled: true, sub: hasForm ? '' : 'no form fields' },
  ];

  return (
    <div className="toolbar">
      <div className="tb-left">
        <Tip label="Back to library">
          <button className="iconbtn" onClick={onBack}>
            <Icon name="back" />
          </button>
        </Tip>
        <nav className="crumbs">
          <button className="crumb" onClick={onBack}>
            Documents
          </button>
          <Icon name="chevRight" size={13} className="crumb-sep" />
          <button
            className="tb-filename crumb-file"
            onClick={() => !readonly && onRename()}
            title={readonly ? name : 'Rename'}
          >
            {dirty && !readonly && <span className="dot" title="Unsaved changes"></span>}
            <span className="nm">{name}</span>
          </button>
        </nav>
        {!readonly && (
          <Kebab
            align="left"
            items={[
              { label: 'Rename', icon: 'pen', onClick: onRename },
              { label: 'Duplicate', icon: 'copy', onClick: onDuplicate },
              { label: 'Split…', icon: 'split', onClick: onSplit },
              { label: 'Download', icon: 'download', onClick: onDownload },
              { sep: true },
              { label: 'Delete', icon: 'trash', danger: true, onClick: onDelete },
            ]}
          />
        )}
      </div>

      <div className="tb-center">
        {tools.map((t) => (
          <Tip key={t.id} label={t.label} sub={t.sub ?? ''}>
            <button
              className={`iconbtn ${tool === t.id ? 'active' : ''}`}
              disabled={!t.enabled || readonly}
              onClick={() => t.enabled && setTool(t.id)}
              aria-label={t.label}
            >
              <Icon name={t.icon} />
            </button>
          </Tip>
        ))}
      </div>

      <div className="tb-right">
        <Tip label="Search" sub="⌘F">
          <button className="iconbtn" onClick={onToggleSearch}>
            <Icon name="search" />
          </button>
        </Tip>
        <ZoomControl zoom={zoom} label={zoomLabel} setZoom={setZoom} />
        <span className="tb-divider"></span>
        <Tip label="Undo" sub="⌘Z">
          <button className="iconbtn" disabled={!canUndo || readonly} onClick={undo}>
            <Icon name="undo" />
          </button>
        </Tip>
        <Tip label="Redo" sub="⌘⇧Z">
          <button className="iconbtn" disabled={!canRedo || readonly} onClick={redo}>
            <Icon name="redo" />
          </button>
        </Tip>
        <span className="tb-divider"></span>
        <button className="btn primary" disabled={!dirty || readonly || saving} onClick={onSave}>
          <Icon name="save" size={15} />
          {saving ? 'Saving…' : 'Save'}
          {pendingCount > 0 && <span className="count">{pendingCount}</span>}
        </button>
      </div>
    </div>
  );
}

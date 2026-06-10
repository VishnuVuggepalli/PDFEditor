/** Floating annotation toolbar: hints + per-tool controls (color swatches,
 * stroke widths, shape kind, text size). */
import type { AnnotStyle, ShapeKind, Tool } from '../../state/editorStore';
import { DRAW_COLORS, HIGHLIGHT_COLORS, TEXT_SIZES } from './annotColors';
import { Icon } from '../shared/Icon';

const HINTS: Partial<Record<Tool, string>> = {
  comment: 'Click anywhere on a page to drop a comment',
  sign: 'Click where you want to place your signature',
  forms: 'Fill the fields in the Forms panel on the right',
};

const LABELS: Partial<Record<Tool, string>> = {
  highlight: 'Highlight',
  draw: 'Pen',
  shapes: 'Shape',
  text: 'Text',
};

const SHAPES: ReadonlyArray<{ id: ShapeKind; icon: string }> = [
  { id: 'square', icon: 'rect' },
  { id: 'circle', icon: 'ellipse' },
  { id: 'line', icon: 'line' },
];

interface Props {
  tool: Tool;
  style: AnnotStyle;
  setStyle: (patch: Partial<AnnotStyle>) => void;
}

export function AnnotToolbar({ tool, style, setStyle }: Props) {
  const hint = HINTS[tool];
  if (hint) {
    return (
      <div className="annot-bar hint">
        <span className="ab-label">{hint}</span>
      </div>
    );
  }
  if (!['highlight', 'draw', 'shapes', 'text'].includes(tool)) return null;
  const palette = tool === 'highlight' ? HIGHLIGHT_COLORS : DRAW_COLORS;
  return (
    <div className="annot-bar">
      <span className="ab-label">{LABELS[tool]}</span>
      {tool === 'shapes' && (
        <>
          <span className="ab-sep"></span>
          <div className="ab-widths">
            {SHAPES.map((s) => (
              <button
                key={s.id}
                className={'ab-w' + (style.shape === s.id ? ' on' : '')}
                onClick={() => setStyle({ shape: s.id })}
                aria-label={s.id}
              >
                <Icon name={s.icon} size={15} style={{ color: '#fff' }} />
              </button>
            ))}
          </div>
        </>
      )}
      <span className="ab-sep"></span>
      <div className="ab-swatches">
        {palette.map((c) => (
          <button
            key={c}
            className={'ab-sw' + (style.color === c ? ' on' : '')}
            style={{ background: c }}
            onClick={() => setStyle({ color: c })}
            aria-label={c}
          />
        ))}
      </div>
      {(tool === 'draw' || tool === 'shapes') && (
        <>
          <span className="ab-sep"></span>
          <div className="ab-widths">
            {[2, 4, 7].map((w) => (
              <button
                key={w}
                className={'ab-w' + (style.width === w ? ' on' : '')}
                onClick={() => setStyle({ width: w })}
                aria-label={`${w}px`}
              >
                <span className="wdot" style={{ width: w + 2, height: w + 2 }}></span>
              </button>
            ))}
          </div>
        </>
      )}
      {tool === 'text' && (
        <>
          <span className="ab-sep"></span>
          <div className="ab-widths">
            {TEXT_SIZES.map((s, i) => (
              <button
                key={s}
                className={'ab-w' + (style.fontSize === s ? ' on' : '')}
                onClick={() => setStyle({ fontSize: s })}
                aria-label={`${s}pt`}
              >
                <span style={{ fontSize: 11 + i * 3, color: '#fff', fontWeight: 700 }}>A</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

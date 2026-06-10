/** Floating annotation toolbar: hints + color swatches + stroke widths. */
import type { AnnotStyle, Tool } from '../../state/editorStore';
import { DRAW_COLORS, HIGHLIGHT_COLORS } from './annotColors';

const HINTS: Partial<Record<Tool, string>> = {
  comment: 'Click anywhere on a page to drop a comment',
  forms: 'Fill the fields in the Forms panel on the right',
};

const LABELS: Partial<Record<Tool, string>> = {
  highlight: 'Highlight',
  draw: 'Pen',
  shapes: 'Square',
};

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
  if (!['highlight', 'draw', 'shapes'].includes(tool)) return null;
  const palette = tool === 'highlight' ? HIGHLIGHT_COLORS : DRAW_COLORS;
  return (
    <div className="annot-bar">
      <span className="ab-label">{LABELS[tool]}</span>
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
    </div>
  );
}

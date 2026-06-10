import { useRef, useState } from 'react';
import { Icon } from '../shared/Icon';
import { Tip } from '../shared/Tip';
import { useOutside } from '../shared/useOutside';
import type { Zoom } from '../../state/editorStore';

const PRESETS = [50, 75, 100, 150, 200];

interface Props {
  zoom: Zoom;
  label: string;
  setZoom: (z: Zoom) => void;
}

export function ZoomControl({ zoom, label, setZoom }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);
  const num = typeof zoom === 'number' ? zoom : 100;
  return (
    <div className="zoom">
      <Tip label="Zoom out" sub="−">
        <button className="iconbtn" onClick={() => setZoom(Math.max(50, num - 25))}>
          <Icon name="minus" size={16} />
        </button>
      </Tip>
      <div className="zval" ref={ref}>
        <button className="zbtn" onClick={() => setOpen((o) => !o)}>
          {label}
          <Icon name="chevDown" size={13} />
        </button>
        {open && (
          <div className="menu zoom-menu" onClick={() => setOpen(false)}>
            {PRESETS.map((p) => (
              <button
                key={p}
                className={`item ${zoom === p ? 'on' : ''}`}
                onClick={() => setZoom(p)}
              >
                {p}%
              </button>
            ))}
            <div className="sep" />
            <button
              className={`item ${zoom === 'fit-width' ? 'on' : ''}`}
              onClick={() => setZoom('fit-width')}
            >
              <span>Fit width</span>
            </button>
            <button
              className={`item ${zoom === 'fit-page' ? 'on' : ''}`}
              onClick={() => setZoom('fit-page')}
            >
              <span>Fit page</span>
            </button>
          </div>
        )}
      </div>
      <Tip label="Zoom in" sub="+">
        <button className="iconbtn" onClick={() => setZoom(Math.min(200, num + 25))}>
          <Icon name="plus" size={16} />
        </button>
      </Tip>
    </div>
  );
}

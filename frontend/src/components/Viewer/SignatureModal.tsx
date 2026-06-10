/** "Add your signature" modal: Draw (canvas pad → ink annotation) or Image
 * (PNG/JPEG upload → server-side stamp). Cryptographic signing is out of
 * scope and shown as a disabled item. */
import { useEffect, useRef, useState } from 'react';
import { useOutside } from '../shared/useOutside';
import { useToast } from '../shared/toastContext';
import { validateSignatureFile } from '../../utils/signature';
import type { SignaturePayload } from '../../utils/signature';
import { Icon } from '../shared/Icon';

const PAD_W = 460;
const PAD_H = 150;
const SIGN_COLORS = ['#1d4ed8', '#111827', '#b91c1c'];

type Stroke = Array<readonly [number, number]>;

interface Props {
  onApply: (sig: SignaturePayload) => void;
  onCancel: () => void;
}

export function SignatureModal({ onApply, onCancel }: Props) {
  const push = useToast();
  const [mode, setMode] = useState<'draw' | 'image'>('draw');
  const [color, setColor] = useState(SIGN_COLORS[0]);
  const [hasInk, setHasInk] = useState(false);
  const [image, setImage] = useState<{ dataUrl: string; aspect: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useOutside(boxRef, onCancel, true);

  function redraw(strokeColor: string) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokesRef.current) {
      ctx.beginPath();
      s.forEach(([nx, ny], i) => {
        const x = nx * c.width;
        const y = ny * c.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  useEffect(() => {
    if (mode === 'draw') redraw(color);
  }, [mode, color]);

  function padPoint(e: React.MouseEvent): readonly [number, number] {
    const c = canvasRef.current;
    if (!c) return [0, 0];
    const r = c.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  }
  function penDown(e: React.MouseEvent) {
    drawingRef.current = true;
    strokesRef.current = [...strokesRef.current, [padPoint(e)]];
  }
  function penMove(e: React.MouseEvent) {
    if (!drawingRef.current) return;
    const strokes = strokesRef.current;
    const last = strokes[strokes.length - 1];
    strokesRef.current = [...strokes.slice(0, -1), [...last, padPoint(e)]];
    setHasInk(true);
    redraw(color);
  }
  function penUp() {
    drawingRef.current = false;
  }
  function clearPad() {
    strokesRef.current = [];
    setHasInk(false);
    redraw(color);
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    const problem = validateSignatureFile(file);
    if (problem) {
      push({ type: 'error', title: 'Invalid signature image', msg: problem });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () =>
      push({ type: 'error', title: 'Could not read file', msg: file.name });
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () =>
        push({ type: 'error', title: 'Not a usable image', msg: file.name });
      img.onload = () => {
        if (img.naturalWidth < 1 || img.naturalHeight < 1) {
          push({ type: 'error', title: 'Not a usable image', msg: file.name });
          return;
        }
        setImage({ dataUrl, aspect: img.naturalHeight / img.naturalWidth });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  const canApply = mode === 'draw' ? hasInk : image !== null;
  function apply() {
    if (!canApply) return;
    if (mode === 'draw') {
      onApply({
        kind: 'draw',
        strokes: strokesRef.current.filter((s) => s.length > 1),
        aspect: PAD_H / PAD_W,
        color,
      });
    } else if (image) {
      onApply({ kind: 'image', dataUrl: image.dataUrl, aspect: image.aspect });
    }
  }

  return (
    <div className="modal-scrim">
      <div className="modal sig-modal" ref={boxRef} role="dialog" aria-modal="true">
        <div className="m-head">
          <div className="m-title">Add your signature</div>
        </div>
        <div className="m-body" style={{ paddingBottom: 4 }}>
          <div className="sig-tabs">
            <button className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')}>
              Draw
            </button>
            <button className={mode === 'image' ? 'on' : ''} onClick={() => setMode('image')}>
              Image
            </button>
          </div>
          {mode === 'draw' ? (
            <>
              <div className="sig-draw">
                <canvas
                  ref={canvasRef}
                  width={PAD_W}
                  height={PAD_H}
                  onMouseDown={penDown}
                  onMouseMove={penMove}
                  onMouseUp={penUp}
                  onMouseLeave={penUp}
                ></canvas>
                <button className="sig-clear" onClick={clearPad}>
                  Clear
                </button>
              </div>
              <div className="sig-colors">
                {SIGN_COLORS.map((c) => (
                  <button
                    key={c}
                    className={'sig-sw' + (color === c ? ' on' : '')}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={c}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="sig-upload">
              {image ? (
                <div className="sig-img-preview">
                  <img src={image.dataUrl} alt="Signature preview" />
                  <button className="sig-clear" onClick={() => setImage(null)}>
                    Remove
                  </button>
                </div>
              ) : (
                <label className="sig-drop">
                  <Icon name="upload" size={18} />
                  <span>Choose a PNG or JPEG (max 5 MB)</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => pickImage(e.target.files?.[0])}
                  />
                </label>
              )}
            </div>
          )}
          <button className="sig-cert" disabled title="Coming later">
            <Icon name="lock" size={14} />
            Certificates &amp; digital signing — not available
          </button>
        </div>
        <div className="m-foot">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!canApply} onClick={apply}>
            Place signature
          </button>
        </div>
      </div>
    </div>
  );
}

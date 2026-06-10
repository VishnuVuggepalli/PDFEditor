/** First-page thumbnail for library cards/rows, rendered from real bytes. */
import type { PdfHandle } from '../../pdf/engine';
import { PdfThumb } from '../../pdf/PdfThumb';

export function DocThumb({ pdf, width }: { pdf: PdfHandle | null; width: number }) {
  return <div className="sheet-mini">{pdf ? <PdfThumb pdf={pdf} page={1} width={width} /> : null}</div>;
}

/** First-page preview for library cards/rows: a server-rendered PNG
 * (GET /documents/{id}/thumbnail) instead of downloading the whole PDF.
 * Skeleton while loading; placeholder icon if the render fails. */
import { useState } from 'react';
import { thumbnailUrl } from '../../api/thumbnails';
import { Icon } from '../shared/Icon';

interface Props {
  docId: string;
  headVersion: number;
  /** target CSS width in px; requested at 2x for crisp HiDPI rendering */
  width: number;
}

type ThumbState = 'loading' | 'ready' | 'error';

export function DocThumb({ docId, headVersion, width }: Props) {
  const [state, setState] = useState<ThumbState>('loading');

  if (state === 'error') {
    return (
      <div className="sheet-mini doc-thumb-fallback">
        <Icon name="fileText" size={Math.max(16, Math.round(width / 6))} />
      </div>
    );
  }
  return (
    <div className="sheet-mini">
      {state === 'loading' && <div className="skel doc-thumb-skel" />}
      {/* opacity (not display:none) while loading: lazy images with no
          layout box never start loading. */}
      <img
        className="doc-thumb-img"
        src={thumbnailUrl(docId, headVersion, width * 2)}
        alt=""
        loading="lazy"
        draggable={false}
        style={state === 'ready' ? undefined : { opacity: 0 }}
        onLoad={() => setState('ready')}
        onError={() => setState('error')}
      />
    </div>
  );
}

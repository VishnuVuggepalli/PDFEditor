/** First-page preview for library cards/rows: a server-rendered PNG
 * (GET /documents/{id}/thumbnail) instead of downloading the whole PDF.
 * Skeleton while loading; placeholder icon if the render fails. */
import { useState } from 'react';
import { thumbnailUrl, thumbRequestWidth } from '../../api/thumbnails';
import { Icon } from '../shared/Icon';

interface Props {
  docId: string;
  headVersion: number;
  /** target CSS width in px; requested oversampled for crisp rendering
   * (see thumbRequestWidth) */
  width: number;
}

type ThumbState = 'loading' | 'ready' | 'error';

export function DocThumb({ docId, headVersion, width }: Props) {
  const [state, setState] = useState<ThumbState>('loading');
  // Rotated pages (e.g. /Rotate 90) render landscape; object-fit:cover would
  // crop a landscape image in the portrait card box down to a blank strip,
  // so those switch to contain (letterboxed on the paper-white background).
  const [landscape, setLandscape] = useState(false);

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
        className={landscape ? 'doc-thumb-img landscape' : 'doc-thumb-img'}
        src={thumbnailUrl(docId, headVersion, thumbRequestWidth(width, window.devicePixelRatio))}
        alt=""
        loading="lazy"
        draggable={false}
        style={state === 'ready' ? undefined : { opacity: 0 }}
        onLoad={(e) => {
          const img = e.currentTarget;
          setLandscape(img.naturalWidth > img.naturalHeight);
          setState('ready');
        }}
        onError={() => setState('error')}
      />
    </div>
  );
}

/** Server-rendered page thumbnails (GET /documents/{id}/thumbnail).
 * Library cards use these instead of downloading the full PDF per card. */

import { API_BASE } from './client';

/** Server default when no width is given. */
export const THUMB_DEFAULT_WIDTH = 240;
/** Server cap; larger requests are clamped backend-side too. */
export const THUMB_MAX_WIDTH = 1024;

/** Clamp a requested width to the server's accepted 1..1024 range. */
export function clampThumbWidth(width: number): number {
  if (!Number.isFinite(width)) return THUMB_DEFAULT_WIDTH;
  return Math.min(Math.max(Math.round(width), 1), THUMB_MAX_WIDTH);
}

/** Pixel width to request from the server for a thumbnail displayed at
 * cssWidth: 3x on HiDPI screens (DPR >= 2), 2x otherwise, clamped to the
 * server cap. Oversampling keeps cards crisp; CSS only ever scales the
 * image DOWN from its natural size, never up. */
export function thumbRequestWidth(cssWidth: number, devicePixelRatio: number): number {
  const multiplier = (devicePixelRatio || 1) >= 2 ? 3 : 2;
  return clampThumbWidth(cssWidth * multiplier);
}

/** URL of a server-rendered PNG of one page of the head version.
 * Version-tagged (?v=) so browser caches bust when a new version is saved. */
export function thumbnailUrl(
  id: string,
  headVersion: number,
  width: number = THUMB_DEFAULT_WIDTH,
  page = 1,
): string {
  const w = clampThumbWidth(width);
  return (
    `${API_BASE}/documents/${encodeURIComponent(id)}/thumbnail` +
    `?page=${page}&width=${w}&v=${headVersion}`
  );
}

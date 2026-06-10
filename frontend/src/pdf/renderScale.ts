/** Pure math for how many device pixels back one CSS pixel of PDF canvas.
 *
 * Plain devicePixelRatio looks soft on DPR-1 displays: pdf.js rasterizes
 * glyphs at exactly 1x and antialiasing smears stems across pixels. Rendering
 * at a floor of 1.5x and letting CSS scale the canvas down supersamples the
 * page, which sharpens text dramatically. The factor is capped so huge zoom
 * levels on high-DPR screens cannot allocate unbounded canvas memory.
 */

/** Minimum supersampling factor (floor applied on low-DPR displays). */
export const MIN_RENDER_SCALE = 1.5;
/** Maximum supersampling factor (memory bound on high-DPR + deep zoom). */
export const MAX_RENDER_SCALE = 3;

/** Device-pixel multiplier for a PDF canvas: the device pixel ratio clamped
 * into [MIN_RENDER_SCALE, MAX_RENDER_SCALE]. Falsy/invalid input (0, NaN,
 * undefined) is treated as a DPR of 1. */
export function canvasScaleFactor(devicePixelRatio: number | undefined): number {
  const dpr = devicePixelRatio || 1;
  return Math.min(Math.max(dpr, MIN_RENDER_SCALE), MAX_RENDER_SCALE);
}

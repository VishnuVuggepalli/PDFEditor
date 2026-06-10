/** Pure helpers for the library multi-select + merge-order list.
 * All functions return new arrays — inputs are never mutated. */

/** Toggle `id` in an ordered selection: absent → appended (selection order
 * becomes the default merge order), present → removed. */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Move the item at `index` by `delta` positions (e.g. -1 = up, +1 = down).
 * Out-of-range moves return an unchanged copy. */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

import { useQuery } from '@tanstack/react-query';
import { getMeta } from '../../api/documents';

/** Page count of the head version via the light meta JSON endpoint — cards
 * no longer download the entire PDF just to show a count. */
export function useDocPageCount(docId: string, headVersion: number): number | null {
  const q = useQuery({
    queryKey: ['meta', docId, headVersion],
    queryFn: () => getMeta(docId),
    staleTime: Infinity, // versions are immutable; a new head changes the key
  });
  return q.data?.pdf.pageCount ?? null;
}

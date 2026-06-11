/** Shared query for digital-signature validation status. Keyed on the head
 * version so any save/sign/restore (which bumps the head) refetches. */
import { useQuery } from '@tanstack/react-query';
import { getSignatures } from './documents';
import type { SignatureInfo } from '../types/document';

export function useSignatures(docId: string, headVersion: number | null): SignatureInfo[] {
  const q = useQuery({
    queryKey: ['signatures', docId, headVersion],
    queryFn: () => getSignatures(docId),
    enabled: headVersion != null,
    retry: 1,
    staleTime: 60_000,
  });
  return q.data ?? [];
}

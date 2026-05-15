'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * GET /api/vault/tags — all tags with usage frequency.
 *
 * Used by the bulk-apply toolbar combobox to suggest existing tags.
 * staleTime 60s (tags change only on apply/ingest).
 * Retry policy inherited from the global QueryClient (queries: retry false).
 */

export interface TagFrequency {
  tag: string;
  count: number;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useVaultTags(): UseQueryResult<TagFrequency[], Error> {
  return useQuery<TagFrequency[], Error>({
    queryKey: ['vault', 'tags'],
    queryFn: async () => {
      const response = await fetch(`${baseUrl}/api/vault/tags`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`/api/vault/tags failed: ${response.status}`);
      }
      return (await response.json()) as TagFrequency[];
    },
    staleTime: 60_000,
  });
}

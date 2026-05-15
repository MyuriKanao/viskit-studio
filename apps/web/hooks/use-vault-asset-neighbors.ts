'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * GET /api/vault/{id}/neighbors — EPIC-9 vault drawer payload.
 *
 * Returns the top-k nearest neighbors plus a corpus-wide similarity
 * histogram. ``sampled`` + ``sample_size`` let the drawer caption the
 * histogram honestly when the corpus exceeds the FLAT-index sampling cap.
 *
 * Retry policy inherited from the global QueryClient (queries: retry false).
 */

export interface VaultNeighbor {
  id: number;
  image_path: string;
  image_url: string;
  distance: number;
  category: string | null;
  season: string | null;
  description: string | null;
  sales_count: number | null;
  price: number | null;
  locale: string | null;
}

export interface VaultHistogram {
  bins: number[];
  edges: number[];
}

export interface VaultNeighborsResponse {
  neighbors: VaultNeighbor[];
  histogram: VaultHistogram;
  sampled: boolean;
  sample_size: number | null;
  total_corpus: number;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useVaultAssetNeighbors(
  assetId: number | null,
  k = 9
): UseQueryResult<VaultNeighborsResponse, Error> {
  return useQuery<VaultNeighborsResponse, Error>({
    queryKey: ['vault', 'neighbors', assetId, k],
    enabled: assetId !== null,
    queryFn: async () => {
      if (assetId === null) {
        throw new Error('assetId is null');
      }
      const url = `${baseUrl}/api/vault/${encodeURIComponent(String(assetId))}/neighbors?k=${k}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`/api/vault/${assetId}/neighbors failed: ${response.status}`);
      }
      return (await response.json()) as VaultNeighborsResponse;
    },
    staleTime: 60_000,
  });
}

'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

import type { KitListItem, KitListResponse } from '@/hooks/use-recent-kits';

/**
 * GET /api/kits?sku=<sku> — Kit history for a single SKU.
 *
 * EPIC-9 Catalog drawer reads this list to render the per-SKU Kit timeline.
 * The endpoint is the same /api/kits route that ``useKitsCatalog`` already
 * targets — only the ``sku`` filter is new (shape stable; query-param only).
 */

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useSkuKits(sku: string | null, limit = 30): UseQueryResult<KitListResponse, Error> {
  return useQuery<KitListResponse, Error>({
    queryKey: ['kits', 'by-sku', sku, limit],
    enabled: sku !== null && sku.length > 0,
    queryFn: async () => {
      if (sku === null || sku.length === 0) {
        throw new Error('sku is empty');
      }
      const params = new URLSearchParams({
        sku,
        limit: String(limit),
        offset: '0',
        sort: 'created_at',
        order: 'desc',
      });
      const response = await fetch(`${baseUrl}/api/kits?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`/api/kits?sku=${sku} failed: ${response.status}`);
      }
      return (await response.json()) as KitListResponse;
    },
    staleTime: 30_000,
  });
}

export type { KitListItem };

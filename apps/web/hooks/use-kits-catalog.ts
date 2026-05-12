'use client';

import { type UseQueryResult, keepPreviousData, useQuery } from '@tanstack/react-query';

import type { KitListItem, KitListResponse } from '@/hooks/use-recent-kits';

/**
 * GET /api/kits filter/sort/paginate inputs for the EPIC-8 Catalog screen.
 *
 * Wraps the same `/api/kits` route that `useRecentKits` already calls. The
 * backend bumped the `limit` ceiling to 100 and added `offset`, `status`,
 * `locale`, `min_score`, `category`, `sort`, `order` query params — see
 * `apps/api/routes/kits.py:list_kits`.
 */
export interface CatalogFilters {
  status: string | null;
  locale: string | null;
  minScore: number | null;
  category: string | null;
}

export type CatalogSortKey = 'created_at' | 'updated_at' | 'score';
export type CatalogSortOrder = 'asc' | 'desc';

export interface CatalogQuery extends CatalogFilters {
  limit: number;
  offset: number;
  sort: CatalogSortKey;
  order: CatalogSortOrder;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

function buildSearchParams(q: CatalogQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  params.set('sort', q.sort);
  params.set('order', q.order);
  if (q.status) params.set('status', q.status);
  if (q.locale) params.set('locale', q.locale);
  if (q.minScore !== null && q.minScore !== undefined) {
    params.set('min_score', String(q.minScore));
  }
  if (q.category) params.set('category', q.category);
  return params;
}

export function useKitsCatalog(query: CatalogQuery): UseQueryResult<KitListResponse, Error> {
  return useQuery<KitListResponse, Error>({
    queryKey: ['kits', 'catalog', query],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const url = `${baseUrl}/api/kits?${buildSearchParams(query).toString()}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`/api/kits failed: ${response.status}`);
      }
      return (await response.json()) as KitListResponse;
    },
  });
}

export type { KitListItem };

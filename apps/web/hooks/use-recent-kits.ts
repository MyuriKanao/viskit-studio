'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * GET /api/kits?recent=true&limit=N response shape.
 *
 * Inline-typed — OpenAPI schema regen runs LAST in the EPIC-7 verification
 * chain (`pnpm gen:api`), at which point callers can swap to the generated
 * `apiClient.GET('/api/kits')` without changing the component contract.
 */
export interface KitListItem {
  id: number;
  sku: string;
  name: string;
  name_en: string | null;
  status: string;
  score: number | null;
  locale: string | null;
  category?: string | null;
  updated_at?: string | null;
  thumbs: (string | null)[];
}

export interface KitListResponse {
  items: KitListItem[];
  total: number;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useRecentKits({
  limit = 6,
}: { limit?: number } = {}): UseQueryResult<KitListResponse, Error> {
  return useQuery<KitListResponse, Error>({
    queryKey: ['kits', 'recent', limit],
    queryFn: async () => {
      const url = `${baseUrl}/api/kits?recent=true&limit=${limit}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`/api/kits failed: ${response.status}`);
      }
      return (await response.json()) as KitListResponse;
    },
  });
}

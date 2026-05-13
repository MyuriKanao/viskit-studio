'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * GET /api/vault/assets — browsable bestseller corpus.
 *
 * queryKey includes all filter params + pagination so each unique
 * combination is independently cached. staleTime 30s (corpus is mostly
 * stable between ingest runs). Retry policy inherited from the global
 * QueryClient (queries: retry false).
 */
export interface VaultAsset {
  id: number;
  image_path: string;
  image_url: string;
  category: string;
  color: string;
  style: string;
  season: string;
  sales_count: number;
  description: string;
  price: number;
  locale: string;
}

export interface VaultListResponse {
  items: VaultAsset[];
  total: number;
  limit: number;
  offset: number;
}

export interface VaultFilters {
  category?: string;
  season?: string;
  color?: string;
  style?: string;
  locale?: string;
  min_sales?: number;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useVaultAssets(
  params: VaultFilters & { limit?: number; offset?: number }
): UseQueryResult<VaultListResponse, Error> {
  const { limit = 30, offset = 0, ...filters } = params;

  return useQuery<VaultListResponse, Error>({
    queryKey: ['vault', 'assets', filters, limit, offset],
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set('limit', String(limit));
      qs.set('offset', String(offset));
      if (filters.category) qs.set('category', filters.category);
      if (filters.season) qs.set('season', filters.season);
      if (filters.color) qs.set('color', filters.color);
      if (filters.style) qs.set('style', filters.style);
      if (filters.locale) qs.set('locale', filters.locale);
      if (filters.min_sales !== undefined) qs.set('min_sales', String(filters.min_sales));

      const response = await fetch(`${baseUrl}/api/vault/assets?${qs.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`/api/vault/assets failed: ${response.status}`);
      }
      return (await response.json()) as VaultListResponse;
    },
    staleTime: 30_000,
  });
}

'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * GET /api/providers/summary — workspace-ready card data.
 */
export interface ProvidersSummary {
  endpoints_count: number;
  monthly_cap_usd: number | null;
  brand_color: string | null;
  default_locale: string | null;
  export_preset: string | null;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useProvidersSummary(): UseQueryResult<ProvidersSummary, Error> {
  return useQuery<ProvidersSummary, Error>({
    queryKey: ['providers', 'summary'],
    queryFn: async () => {
      const response = await fetch(`${baseUrl}/api/providers/summary`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`/api/providers/summary failed: ${response.status}`);
      }
      return (await response.json()) as ProvidersSummary;
    },
  });
}

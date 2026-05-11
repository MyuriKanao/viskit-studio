'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * GET /api/metrics/weekly response shape.
 *
 * The OpenAPI schema hasn't been regenerated yet (pnpm gen:api runs LAST in
 * the EPIC-7 verification chain), so we declare the shape inline.  Once the
 * schema lands, callers can swap to `apiClient.GET('/api/metrics/weekly')`
 * without changing the component contract.
 */
export interface WeeklyMetricsResponse {
  kits_this_week: number;
  avg_compliance: number | null;
  avg_manual_edit_min: number | null;
  api_spend_usd_mtd: number;
  sparks: {
    kits: number[];
    compliance: number[];
    cost: number[];
  };
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useWeeklyMetrics(): UseQueryResult<WeeklyMetricsResponse, Error> {
  return useQuery<WeeklyMetricsResponse, Error>({
    queryKey: ['metrics', 'weekly'],
    queryFn: async () => {
      const response = await fetch(`${baseUrl}/api/metrics/weekly`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`/api/metrics/weekly failed: ${response.status}`);
      }
      return (await response.json()) as WeeklyMetricsResponse;
    },
  });
}

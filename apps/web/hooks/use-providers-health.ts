'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * GET /api/providers/health — per-endpoint health snapshot.
 *
 * Backend (apps/api/routes/providers.py) returns `list[ProviderHealthRow]`.
 * When a role has no binding, the row carries the role name in `unbound`.
 */
export interface ProviderHealthRow {
  endpoint_id: string;
  role: string;
  status: 'ok' | 'warn' | 'error' | null;
  latency_ms: number | null;
  last_check: string | null;
  unbound: string[] | null;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useProvidersHealth(): UseQueryResult<ProviderHealthRow[], Error> {
  return useQuery<ProviderHealthRow[], Error>({
    queryKey: ['providers', 'health'],
    queryFn: async () => {
      const response = await fetch(`${baseUrl}/api/providers/health`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`/api/providers/health failed: ${response.status}`);
      }
      return (await response.json()) as ProviderHealthRow[];
    },
    refetchInterval: 15_000,
  });
}

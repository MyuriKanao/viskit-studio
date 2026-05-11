'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';

/**
 * /health is the FastAPI route exposed by `apps/api/routes/health.py`.
 * The OpenAPI schema types the response as `unknown` (JSONResponse without
 * a pydantic model), so we declare the shape locally.
 */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  postgres: 'connected' | 'disconnected';
  milvus: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  minio: 'connected' | 'disconnected';
}

export function useHealth(): UseQueryResult<HealthResponse, Error> {
  return useQuery<HealthResponse, Error>({
    queryKey: ['health'],
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/health', {});
      if (error || !data) {
        throw new Error(`/health failed: ${response.status}`);
      }
      return data as HealthResponse;
    },
    refetchInterval: 15_000,
  });
}

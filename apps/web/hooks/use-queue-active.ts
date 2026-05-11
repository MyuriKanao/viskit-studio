'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * GET /api/queue/active — snapshot of orchestrator state.
 *
 * Backend (apps/api/routes/queue.py) returns the bare list of jobs, NOT the
 * envelope object — `response_model=list[QueueJob]`.  Surface a `jobs[]`
 * shape locally so the dashboard can iterate predictably.
 */
export type QueueStageStatus = 'done' | 'active' | 'queued';

export interface QueueJob {
  kit_id: string;
  sku: string | null;
  name: string | null;
  locale: string | null;
  stages: QueueStageStatus[];
  current_stage: string;
  eta_ms: number;
}

export interface QueueSnapshot {
  jobs: QueueJob[];
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useQueueActive(): UseQueryResult<QueueSnapshot, Error> {
  return useQuery<QueueSnapshot, Error>({
    queryKey: ['queue', 'active'],
    queryFn: async () => {
      const response = await fetch(`${baseUrl}/api/queue/active`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`/api/queue/active failed: ${response.status}`);
      }
      const jobs = (await response.json()) as QueueJob[];
      return { jobs };
    },
    refetchInterval: 4000,
  });
}

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * POST /api/vault/ingest — wraps the sync ingest pipeline.
 * On success, invalidates all ['vault'] queries so the grid refreshes.
 */
export interface VaultIngestResponse {
  total_rows: number;
  inserted: number;
  upserted: number;
  replaced: number;
  deduplicated: number;
  recomputed_embeddings: number;
  locale_counts: Record<string, number>;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useVaultIngest() {
  const queryClient = useQueryClient();

  return useMutation<VaultIngestResponse, Error, FormData>({
    mutationFn: async (formData: FormData) => {
      const response = await fetch(`${baseUrl}/api/vault/ingest`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        const error = new Error(payload.message ?? `Ingest failed: ${response.status}`);
        (error as Error & { code?: string }).code = payload.code;
        throw error;
      }
      return (await response.json()) as VaultIngestResponse;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vault'] });
    },
  });
}

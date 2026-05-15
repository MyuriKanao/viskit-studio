'use client';

import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';

import type { VaultListResponse } from '@/hooks/use-vault-assets';

/**
 * EPIC-11: POST /api/vault/inspired/toggle — idempotent flip of the
 * inspired flag for one asset.
 *
 * Optimistic update: the affected ['vault', 'assets', ...] caches have the
 * matching item.inspired toggled immediately. On error the snapshot is
 * restored. On settle, both ['vault', 'assets'] and ['vault', 'inspired']
 * are invalidated so the next read fetches truth.
 */

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export interface InspiredToggleResponse {
  asset_id: number;
  inspired: boolean;
}

type Snapshot = [readonly unknown[], VaultListResponse | undefined][];

export function useVaultInspiredToggle(): UseMutationResult<
  InspiredToggleResponse,
  Error,
  number,
  { snapshot: Snapshot }
> {
  const queryClient = useQueryClient();

  return useMutation<InspiredToggleResponse, Error, number, { snapshot: Snapshot }>({
    mutationFn: async (asset_id: number) => {
      const response = await fetch(`${baseUrl}/api/vault/inspired/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id }),
      });
      if (!response.ok) {
        throw new Error(`/api/vault/inspired/toggle failed: ${response.status}`);
      }
      return (await response.json()) as InspiredToggleResponse;
    },
    onMutate: async (asset_id) => {
      await queryClient.cancelQueries({ queryKey: ['vault', 'assets'] });
      const snapshot = queryClient.getQueriesData<VaultListResponse>({
        queryKey: ['vault', 'assets'],
      });
      queryClient.setQueriesData<VaultListResponse>(
        { queryKey: ['vault', 'assets'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === asset_id ? { ...item, inspired: !item.inspired } : item
            ),
          };
        }
      );
      return { snapshot };
    },
    onError: (_err, _asset_id, context) => {
      if (!context?.snapshot) return;
      for (const [key, data] of context.snapshot) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['vault', 'assets'] });
      queryClient.invalidateQueries({ queryKey: ['vault', 'inspired'] });
    },
  });
}

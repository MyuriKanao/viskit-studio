'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * POST /api/vault/tags/apply — bulk add or remove tags across assets.
 *
 * On success: invalidates ['vault', 'assets'] and ['vault', 'tags'] so both
 * the grid and the combobox suggestions refresh.
 *
 * Returns the full TagApplyResponse so the caller (VaultBulkToolbar) can
 * render a truthful toast distinguishing noop vs fresh inserts.
 */

export interface TagApplyRequest {
  action: 'add' | 'remove';
  tags: string[];
  asset_ids: number[];
}

export interface TagApplyResponse {
  applied_count: number;
  inserted_count: number;
  noop_count: number;
  affected_assets: number[];
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useVaultTagsApply() {
  const queryClient = useQueryClient();

  return useMutation<TagApplyResponse, Error, TagApplyRequest>({
    mutationFn: async (payload: TagApplyRequest) => {
      const response = await fetch(`${baseUrl}/api/vault/tags/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errPayload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(errPayload.message ?? `Tag apply failed: ${response.status}`);
      }
      return (await response.json()) as TagApplyResponse;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vault', 'assets'] });
      void queryClient.invalidateQueries({ queryKey: ['vault', 'tags'] });
    },
  });
}

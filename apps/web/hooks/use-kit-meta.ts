'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * GET /api/kits/{db_kit_id}/meta — Kit-specific retrieval snapshot.
 *
 * Powers the EPIC-9 Catalog drawer "上次检索到的 bestsellers" subsection. A
 * 404 maps to ``null`` (legacy Kit — no kit_meta sidecar), letting the
 * drawer render its empty-state copy without surfacing the error.
 */
export interface KitMeta {
  db_kit_id: number;
  kit_id: string | null;
  retrieved_bestseller_ids: number[];
  spec_markdown: string | null;
  spec: Record<string, unknown> | null;
  compliance: Record<string, unknown> | null;
  cost: Record<string, unknown> | null;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useKitMeta(
  dbKitId: number | null,
  enabled = true
): UseQueryResult<KitMeta | null, Error> {
  return useQuery<KitMeta | null, Error>({
    queryKey: ['kit-meta', dbKitId],
    enabled: enabled && dbKitId !== null,
    queryFn: async () => {
      if (dbKitId === null) throw new Error('dbKitId is null');
      const url = `${baseUrl}/api/kits/${encodeURIComponent(String(dbKitId))}/meta`;
      const response = await fetch(url, { cache: 'no-store' });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`/api/kits/${dbKitId}/meta failed: ${response.status}`);
      }
      return (await response.json()) as KitMeta;
    },
    staleTime: 60_000,
  });
}

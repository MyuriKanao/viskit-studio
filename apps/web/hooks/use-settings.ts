'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import { type ProvidersSummary, useProvidersSummary } from '@/hooks/use-providers-summary';

/**
 * Settings — workspace-level config (subset of providers summary).
 *
 * Read side reuses GET /api/providers/summary (the 4 fields already live
 * there alongside `endpoints_count`). Write side targets POST /api/settings,
 * which does internal read-modify-write through config_io.
 */
export interface Settings {
  brand_color: string | null;
  default_locale: string | null;
  monthly_cap_usd: number | null;
  export_preset: string | null;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

/**
 * Read the 4 workspace-level fields. Thin alias over useProvidersSummary
 * so the page can stay decoupled from the providers naming.
 */
export function useSettings(): UseQueryResult<ProvidersSummary, Error> {
  return useProvidersSummary();
}

export function useSettingsSave(): UseMutationResult<Settings, Error, Partial<Settings>> {
  const queryClient = useQueryClient();
  return useMutation<Settings, Error, Partial<Settings>>({
    mutationFn: async (payload) => {
      // Strip undefined keys so we never send `{brand_color: undefined}` —
      // the backend only merges keys that are actually present.
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined) {
          body[key] = value;
        }
      }
      const response = await fetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`POST /api/settings failed: ${response.status}`);
      }
      return (await response.json()) as Settings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providers', 'summary'] });
    },
  });
}

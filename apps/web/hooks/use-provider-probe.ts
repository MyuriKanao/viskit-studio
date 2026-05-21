'use client';

import { type UseMutationResult, useMutation } from '@tanstack/react-query';

/**
 * POST /api/providers/probe — probe an un-registered candidate endpoint so
 * the user can pick a model from the dropdown without typing.
 *
 * Backend never raises: 200 always; ``ok=false`` carries an ``error`` string.
 */
export interface ProbeRequest {
  protocol: 'openai_compatible' | 'anthropic_compatible' | 'image_generation';
  base_url: string;
  // Pass either an env-var name OR an inline key; the backend rejects
  // requests where neither is provided.
  api_key_env?: string;
  api_key?: string;
  adapter?: string;
}

export interface ProbeResponse {
  ok: boolean;
  latency_ms: number;
  models: string[];
  error: string | null;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useProviderProbe(): UseMutationResult<ProbeResponse, Error, ProbeRequest> {
  return useMutation<ProbeResponse, Error, ProbeRequest>({
    mutationFn: async (payload) => {
      const response = await fetch(`${baseUrl}/api/providers/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Probe failed (${response.status})`);
      }
      return (await response.json()) as ProbeResponse;
    },
  });
}

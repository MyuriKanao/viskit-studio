'use client';

import { type UseMutationResult, useMutation } from '@tanstack/react-query';

/**
 * POST /api/providers/endpoints — ADR-010 v2 lock+checksum protocol.
 *
 * Backend returns:
 *   200 → { new_sha256 }
 *   503 → { detail: { code: 'CONFIG_LOCKED', retry_after_s } }   + Retry-After header
 *   409 → { detail: { code: 'CHECKSUM_MISMATCH', current_yaml, current_sha256 } }
 */
export interface SaveEndpointsRequest {
  new_yaml: string;
  expected_sha256: string;
}

export interface SaveEndpointsResponse {
  new_sha256: string;
}

export type ConfigSaveErrorCode =
  | 'CONFIG_LOCKED'
  | 'CHECKSUM_MISMATCH'
  | 'INODE_CHANGED'
  | 'UNKNOWN';

export class ConfigSaveError extends Error {
  code: ConfigSaveErrorCode;
  status: number;
  currentYaml?: string;
  currentSha256?: string;
  retryAfterS?: number;

  constructor(
    code: ConfigSaveErrorCode,
    status: number,
    message: string,
    extras: { currentYaml?: string; currentSha256?: string; retryAfterS?: number } = {}
  ) {
    super(message);
    this.name = 'ConfigSaveError';
    this.code = code;
    this.status = status;
    this.currentYaml = extras.currentYaml;
    this.currentSha256 = extras.currentSha256;
    this.retryAfterS = extras.retryAfterS;
  }
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useConfigSave(): UseMutationResult<
  SaveEndpointsResponse,
  ConfigSaveError,
  SaveEndpointsRequest
> {
  return useMutation<SaveEndpointsResponse, ConfigSaveError, SaveEndpointsRequest>({
    mutationFn: async (payload) => {
      const response = await fetch(`${baseUrl}/api/providers/endpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        return (await response.json()) as SaveEndpointsResponse;
      }
      // Surface backend semantics via typed error.
      let body: {
        detail?: {
          code?: string;
          current_yaml?: string;
          current_sha256?: string;
          retry_after_s?: number;
        };
      } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        // ignore JSON parse error — body may be empty
      }
      const detail = body.detail ?? {};
      const rawCode = detail.code ?? 'UNKNOWN';
      const code: ConfigSaveErrorCode =
        rawCode === 'CONFIG_LOCKED' ||
        rawCode === 'CHECKSUM_MISMATCH' ||
        rawCode === 'INODE_CHANGED'
          ? rawCode
          : 'UNKNOWN';
      throw new ConfigSaveError(code, response.status, `Save failed (${response.status})`, {
        currentYaml: detail.current_yaml,
        currentSha256: detail.current_sha256,
        retryAfterS: detail.retry_after_s,
      });
    },
  });
}

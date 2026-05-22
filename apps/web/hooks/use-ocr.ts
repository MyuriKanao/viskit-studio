'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * Mirrors `apps/api/routes/images.py:TextBoxOut`. The OpenAPI bundle does
 * not yet export the `/api/images/{id}/ocr` shape (gen:api runs in US-012),
 * so we declare the response type locally — same pattern as use-health.ts.
 */
export interface OcrBox {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  confidence: number;
}

export interface OcrResponse {
  boxes: OcrBox[];
  engine: string;
  version: string;
  available?: boolean;
  unavailable_reason?: string | null;
}

export function useOcr(imageId: string | undefined): UseQueryResult<OcrResponse, Error> {
  return useQuery<OcrResponse, Error>({
    queryKey: ['ocr', imageId],
    enabled: typeof imageId === 'string' && imageId.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      // openapi-fetch hasn't been regenerated for the editor routes yet, so
      // drop to raw fetch with the same base URL the generated client uses.
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
      const res = await fetch(
        `${baseUrl}/api/images/${encodeURIComponent(imageId as string)}/ocr`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      if (!res.ok) {
        throw new Error(`OCR failed: ${res.status}`);
      }
      return (await res.json()) as OcrResponse;
    },
  });
}

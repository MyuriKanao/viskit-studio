'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

/**
 * GET /api/templates — curated starter-template catalogue.
 *
 * Backend returns the bare list of TemplateSummary objects; we wrap it into
 * a `{ templates[] }` envelope locally so consumers iterate predictably
 * (mirrors useQueueActive shape).
 *
 * No refetchInterval — templates are static seed data; staleTime 5 min.
 */
export interface Template {
  id: string;
  name: string;
  name_en: string | null;
  category: 'hero' | 'detail_m3' | 'lifestyle' | 'short_video' | 'amazon_hero';
  tags: string[];
  locale: 'zh' | 'en';
  description: string | null;
  thumbnail_url: string | null;
}

export interface TemplatesSnapshot {
  templates: Template[];
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useTemplates(): UseQueryResult<TemplatesSnapshot, Error> {
  return useQuery<TemplatesSnapshot, Error>({
    queryKey: ['templates', 'list'],
    queryFn: async () => {
      const response = await fetch(`${baseUrl}/api/templates`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`/api/templates failed: ${response.status}`);
      }
      const templates = (await response.json()) as Template[];
      return { templates };
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

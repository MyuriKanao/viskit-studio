'use client';

import { type UseQueryResult, useQuery } from '@tanstack/react-query';

export interface Template {
  id: string;
  name: string;
  name_en: string | null;
  category: 'hero' | 'detail_m3' | 'lifestyle' | 'short_video' | 'amazon_hero';
  tags: string[];
  locale: 'zh' | 'en';
  description: string | null;
  thumbnail_url: string | null;
  source?: 'built_in' | 'custom';
  editable?: boolean;
  copyable?: boolean;
  enabled?: boolean;
  prompt_template?: Record<string, string> | null;
  defaults?: Record<string, string> | null;
  examples?: string[];
}

export interface TemplateSchemeSlot {
  slot_id: string;
  template_ref: string;
}

export interface TemplateScheme {
  id: string;
  name: string;
  description: string | null;
  locale: 'zh' | 'en';
  source: 'built_in' | 'custom';
  editable: boolean;
  enabled: boolean;
  slots: TemplateSchemeSlot[];
}

export interface TemplatesSnapshot {
  templates: Template[];
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function useTemplates(): UseQueryResult<TemplatesSnapshot, Error> {
  return useQuery<TemplatesSnapshot, Error>({
    queryKey: ['templates', 'list'],
    queryFn: async () => {
      const response = await fetch(`${baseUrl}/api/templates/managed`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`/api/templates/managed failed: ${response.status}`);
      }
      const templates = (await response.json()) as Template[];
      return { templates };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useTemplateSchemes(locale: 'zh' | 'en'): UseQueryResult<TemplateScheme[], Error> {
  return useQuery<TemplateScheme[], Error>({
    queryKey: ['templates', 'schemes', locale],
    queryFn: async () => {
      const response = await fetch(`${baseUrl}/api/templates/schemes?locale=${locale}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`/api/templates/schemes failed: ${response.status}`);
      }
      return (await response.json()) as TemplateScheme[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

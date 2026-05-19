'use client';

import { useMutation } from '@tanstack/react-query';

import type { InferredSpec } from '@/lib/chat/types';

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export interface ExtractArgs {
  kitClientId: string;
  imageUrl: string;
  description?: string;
}

function sellingPointText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const point = value as { title?: unknown; evidence?: unknown };
    const title = typeof point.title === 'string' ? point.title : '';
    const evidence = typeof point.evidence === 'string' ? point.evidence : '';
    return [title, evidence].filter(Boolean).join('：') || JSON.stringify(value);
  }
  return String(value ?? '');
}

async function postExtract(args: ExtractArgs): Promise<InferredSpec> {
  const res = await fetch(
    `${baseUrl}/api/kits/${encodeURIComponent(args.kitClientId)}/extract`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image_url: args.imageUrl,
        description: args.description,
      }),
    }
  );
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { detail?: unknown };
      detail = typeof body.detail === 'string' ? body.detail : '';
    } catch {}
    throw new Error(detail || `提取接口失败（${res.status}）`);
  }
  const body = (await res.json()) as InferredSpec;
  return {
    ...body,
    selling_points: body.selling_points.map((point) => ({
      ...point,
      value: sellingPointText(point.value),
    })),
  };
}

export function useExtract() {
  return useMutation<InferredSpec, Error, ExtractArgs>({
    mutationFn: postExtract,
  });
}

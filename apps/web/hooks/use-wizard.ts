'use client';

import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProgressEvent, WizardLocale } from '@/lib/wizard/store';

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

// ---------------------------------------------------------------------------
// /api/kits/{kit_id}/spec
// ---------------------------------------------------------------------------

export type WizardProductType = 'blue_hat' | 'sports' | 'general_food' | 'other';

export interface WizardSkuMetaPayload {
  sku: string;
  name: string;
  brand: string;
  category: string;
  product_type: WizardProductType;
  price: number;
}

export interface WizardSellingPoint {
  title: string;
  evidence: string;
  priority: 'high' | 'medium' | 'low';
}

export interface SpecParams {
  kit_id: string;
  locale: WizardLocale;
  sku_meta: WizardSkuMetaPayload;
  selling_points: WizardSellingPoint[];
}

export type SpecOutPayload = unknown;

export interface SpecResponse {
  spec_markdown: string;
  compliance: unknown;
  spec: SpecOutPayload;
}

async function postKitSpec(p: SpecParams): Promise<SpecResponse> {
  const res = await fetch(`${baseUrl}/api/kits/${encodeURIComponent(p.kit_id)}/spec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locale: p.locale,
      sku_meta: p.sku_meta,
      selling_points: p.selling_points,
    }),
  });
  if (!res.ok) {
    throw new Error(`/api/kits/${p.kit_id}/spec failed: ${res.status}`);
  }
  return (await res.json()) as SpecResponse;
}

export function useKitSpec() {
  return useMutation<SpecResponse, Error, SpecParams>({
    mutationFn: postKitSpec,
  });
}

// ---------------------------------------------------------------------------
// /api/kits/{kit_id}/generate + concurrent /events SSE
// ---------------------------------------------------------------------------

export type GeneratePhase = 'idle' | 'spec' | 'generating' | 'success' | 'error';

export interface GenerateParams {
  kit_id: string;
  brand_color_hex: string;
  locale: WizardLocale;
  spec: SpecOutPayload;
  style_prompt: string;
}

export interface GenerateResult {
  db_kit_id: number;
  png_paths: string[];
  needs_review: boolean;
  abort_reason: string | null;
}

interface KitSseEvent {
  image_id?: string;
  status?: string;
  progress?: number;
  brand_color_locked?: boolean;
  [key: string]: unknown;
}

async function readKitEvents(
  kitId: string,
  signal: AbortSignal,
  onEvent: (e: KitSseEvent) => void
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let sseRes: Response | null = null;
  while (Date.now() < deadline) {
    if (signal.aborted) return;
    const res = await fetch(`${baseUrl}/api/kits/${encodeURIComponent(kitId)}/events`, { signal });
    if (res.ok) {
      sseRes = res;
      break;
    }
    if (res.status !== 404) {
      throw new Error(`/api/kits/${kitId}/events failed: ${res.status}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!sseRes || !sseRes.body) return;
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep = buf.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      sep = buf.indexOf('\n\n');
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        try {
          onEvent(JSON.parse(payload) as KitSseEvent);
        } catch {
          // skip malformed frame
        }
      }
    }
  }
}

export interface UseGenerateKitResult {
  phase: GeneratePhase;
  errorMessage: string | null;
  result: GenerateResult | null;
  events: ProgressEvent[];
  start: (params: GenerateParams) => Promise<GenerateResult | null>;
  reset: () => void;
}

function mapKitEventToProgress(e: KitSseEvent): ProgressEvent | null {
  const slot = typeof e.image_id === 'string' ? e.image_id : null;
  if (!slot) return null;
  const raw = typeof e.status === 'string' ? e.status : '';
  let status: ProgressEvent['status'] = 'running';
  if (raw === 'queued' || raw === 'pending') status = 'pending';
  else if (raw === 'failed' || raw === 'error') status = 'failed';
  else if (raw === 'success' || raw === 'ready' || raw === 'done') status = 'success';
  return { slot, status, message: raw };
}

export function useGenerateKit(): UseGenerateKitResult {
  const [phase, setPhase] = useState<GeneratePhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      ctrlRef.current?.abort();
    },
    []
  );

  const reset = useCallback(() => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setPhase('idle');
    setErrorMessage(null);
    setResult(null);
    setEvents([]);
  }, []);

  const start = useCallback(async (params: GenerateParams): Promise<GenerateResult | null> => {
    if (ctrlRef.current) return null;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setPhase('generating');
    setErrorMessage(null);
    setResult(null);
    setEvents([]);

    const generatePromise = fetch(
      `${baseUrl}/api/kits/${encodeURIComponent(params.kit_id)}/generate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brand_color_hex: params.brand_color_hex,
          locale: params.locale,
          spec: params.spec,
          style_prompt: params.style_prompt,
        }),
        signal: ctrl.signal,
      }
    );

    const eventsPromise = readKitEvents(params.kit_id, ctrl.signal, (e) => {
      const mapped = mapKitEventToProgress(e);
      if (mapped) setEvents((prev) => [...prev, mapped]);
    }).catch(() => {
      // SSE errors don't fail the whole flow — generate is the source of truth.
    });

    try {
      const res = await generatePromise;
      if (!res.ok) {
        let detail = `${res.status}`;
        try {
          const body = (await res.json()) as { detail?: string };
          if (body.detail) detail = body.detail;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }
      const body = (await res.json()) as GenerateResult & { kit_id: string };
      ctrl.abort();
      await eventsPromise;
      setResult(body);
      setPhase('success');
      return body;
    } catch (err) {
      ctrl.abort();
      if ((err as { name?: string }).name === 'AbortError') {
        setPhase('idle');
        return null;
      }
      setErrorMessage((err as Error).message);
      setPhase('error');
      return null;
    } finally {
      if (ctrlRef.current === ctrl) {
        ctrlRef.current = null;
      }
    }
  }, []);

  return { phase, errorMessage, result, events, start, reset };
}

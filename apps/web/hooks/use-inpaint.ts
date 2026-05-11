'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type InpaintStatus = 'idle' | 'streaming' | 'success' | 'error' | 'aborted';

export type InpaintEventName = 'progress' | 'success' | 'error' | 'aborted';

export interface InpaintEvent {
  event: InpaintEventName;
  data: Record<string, unknown>;
}

export interface InpaintRequest {
  mask_box: { x: number; y: number; w: number; h: number };
  new_text: string;
  kit_id?: string;
}

export interface UseInpaintResult {
  status: InpaintStatus;
  lastEvent: InpaintEvent | null;
  jobId: string | null;
  start: (imageId: string, request: InpaintRequest) => Promise<void>;
  abort: () => void;
  reset: () => void;
}

const TERMINAL_EVENTS: Record<InpaintEventName, InpaintStatus | undefined> = {
  progress: undefined,
  success: 'success',
  error: 'error',
  aborted: 'aborted',
};

function parseSseFrame(frame: string): InpaintEvent | null {
  let event: string | null = null;
  let data: string | null = null;
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data = line.slice(5).trim();
  }
  if (!event || data === null) return null;
  if (event === '_close') return null;
  if (event !== 'progress' && event !== 'success' && event !== 'error' && event !== 'aborted') {
    return null;
  }
  try {
    return { event, data: JSON.parse(data) as Record<string, unknown> };
  } catch {
    return { event, data: {} };
  }
}

export function useInpaint(): UseInpaintResult {
  const [status, setStatus] = useState<InpaintStatus>('idle');
  const [lastEvent, setLastEvent] = useState<InpaintEvent | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

  useEffect(
    () => () => {
      ctrlRef.current?.abort();
    },
    []
  );

  const abort = useCallback(() => {
    ctrlRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setStatus('idle');
    setLastEvent(null);
    setJobId(null);
  }, []);

  const start = useCallback(
    async (imageId: string, request: InpaintRequest): Promise<void> => {
      if (ctrlRef.current) return;
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setStatus('streaming');
      setLastEvent(null);
      setJobId(null);
      try {
        const startRes = await fetch(`${baseUrl}/api/images/${encodeURIComponent(imageId)}/edit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
          signal: ctrl.signal,
        });
        if (!startRes.ok) {
          setStatus('error');
          return;
        }
        const { job_id } = (await startRes.json()) as { job_id: string };
        setJobId(job_id);
        const sseRes = await fetch(
          `${baseUrl}/api/images/${encodeURIComponent(imageId)}/edit/events?job_id=${encodeURIComponent(job_id)}`,
          { signal: ctrl.signal }
        );
        if (!sseRes.ok || !sseRes.body) {
          setStatus('error');
          return;
        }
        const reader = sseRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let terminal: InpaintStatus | undefined;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep = buf.indexOf('\n\n');
          while (sep !== -1) {
            const frame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            sep = buf.indexOf('\n\n');
            const parsed = parseSseFrame(frame);
            if (!parsed) continue;
            setLastEvent(parsed);
            terminal = TERMINAL_EVENTS[parsed.event];
            if (terminal) {
              setStatus(terminal);
            }
          }
        }
        if (!terminal) {
          // Stream ended cleanly without an explicit terminal frame.
          setStatus('success');
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          setStatus('aborted');
        } else {
          setStatus('error');
        }
      } finally {
        if (ctrlRef.current === ctrl) {
          ctrlRef.current = null;
        }
      }
    },
    [baseUrl]
  );

  return { status, lastEvent, jobId, start, abort, reset };
}

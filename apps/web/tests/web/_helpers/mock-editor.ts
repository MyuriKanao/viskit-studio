import type { Page, Route } from '@playwright/test';

/**
 * Stubs the EPIC-5 editor backend routes so Playwright specs can drive
 * `/[locale]/editor/[image_id]` without a live FastAPI server. SSE event
 * names mirror `apps/api/routes/images.py`.
 */

export interface MockOcrBox {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  confidence: number;
}

export interface MockEditorOptions {
  ocrBoxes?: MockOcrBox[];
  /**
   * SSE script for `/api/images/.../edit/events`. Each entry is emitted as a
   * single `event: <event>\ndata: <json>\n\n` chunk in order. The default
   * script terminates with a `success` event. Set to `'hang'` to stream
   * `progress` once and never emit a terminator (for cancel tests).
   */
  sseScript?:
    | Array<{ event: 'progress' | 'success' | 'error' | 'aborted'; data: Record<string, unknown> }>
    | 'hang';
  /** Initial job_id returned by POST /edit. */
  jobId?: string;
}

const DEFAULT_OCR_BOXES: MockOcrBox[] = [
  { x: 120, y: 80, w: 240, h: 48, text: '高质量手工', confidence: 0.97 },
  { x: 120, y: 160, w: 320, h: 56, text: '限时特惠', confidence: 0.94 },
  { x: 120, y: 240, w: 200, h: 40, text: '正品保障', confidence: 0.91 },
];

const DEFAULT_SSE_SCRIPT = [
  { event: 'progress', data: { stage: 'started' } },
  { event: 'progress', data: { stage: 'composing' } },
  { event: 'success', data: { bytes_len: 4096 } },
] as const;

function ssePayload(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function mockEditorBackend(
  page: Page,
  options: MockEditorOptions = {}
): Promise<void> {
  const ocrBoxes = options.ocrBoxes ?? DEFAULT_OCR_BOXES;
  const sseScript = options.sseScript ?? DEFAULT_SSE_SCRIPT;
  const jobId = options.jobId ?? 'job-mock-000001';

  await page.route('**/api/images/*/ocr', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ boxes: ocrBoxes, engine: 'paddleocr', version: '2.x' }),
    });
  });

  await page.route('**/api/images/*/edit', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ job_id: jobId }),
    });
  });

  await page.route('**/api/images/*/edit/events*', async (route: Route) => {
    if (sseScript === 'hang') {
      // Never fulfill — emulates a hung SSE stream. The browser fetch on the
      // hook side stays pending until the test aborts via AbortController.
      // `route.fulfill` would CLOSE the response which the inpaint hook then
      // treats as a clean stream-end → status flips to 'success' (see
      // apps/web/hooks/use-inpaint.ts:132) — defeating the cancel test.
      await new Promise<void>(() => {});
      return;
    }
    const body = sseScript
      .map((entry) => ssePayload(entry.event, { ...entry.data, job_id: jobId }))
      .join('');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body,
    });
  });
}

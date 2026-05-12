import type { Page, Route } from '@playwright/test';

/**
 * Stubs the 5 wizard endpoints so Playwright specs can drive
 * `/[locale]/new-kit` Step 1 → 4 → /kits/{db_kit_id} without a live FastAPI
 * server.
 *
 *   POST /api/retrieval/search        — returns `hits` (fixture-driven)
 *   POST /api/retrieval/style-prompt  — returns a canned style_prompt
 *   POST /api/kits/*\/spec            — returns spec_markdown + SpecOut + compliance
 *   POST /api/kits/*\/generate        — returns db_kit_id (+ png_paths)
 *   GET  /api/kits/*\/events          — streams a few `data:` SSE frames
 *
 * The kit-events route mimics the production wire format used by
 * `apps/api/routes/kits.py:get_kit_events` — `data: <json>\n\n` only, no
 * `event:` lines.
 */

export interface MockWizardHit {
  image_url: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface MockWizardOptions {
  hits?: MockWizardHit[];
  /** Optional override; defaults to a placeholder zh prompt. */
  stylePrompt?: string;
  /** db_kit_id returned by /generate; tests assert post-success navigation. */
  dbKitId?: number;
  /** Locale of the SpecOut payload returned by /spec. */
  specLocale?: 'zh' | 'en';
  /** SSE event stream emitted by /events. Each frame is one `data:` line. */
  sseEvents?: Array<Record<string, unknown>>;
}

export const DEFAULT_HITS: MockWizardHit[] = [
  {
    image_url: 'https://example.test/img/a.png',
    score: 0.92,
    metadata: { from_fallback: false },
  },
  {
    image_url: 'https://example.test/img/b.png',
    score: 0.81,
    metadata: { from_fallback: false },
  },
  {
    image_url: 'https://example.test/img/c.png',
    score: 0.74,
    metadata: { from_fallback: false },
  },
];

export const FALLBACK_HITS: MockWizardHit[] = [
  {
    image_url: 'https://example.test/img/a-fb.png',
    score: 0.7,
    metadata: { from_fallback: true },
  },
  {
    image_url: 'https://example.test/img/b.png',
    score: 0.65,
    metadata: { from_fallback: false },
  },
];

const DEFAULT_SSE_EVENTS: Array<Record<string, unknown>> = [
  { image_id: 'H1', status: 'success', progress: 7, brand_color_locked: true },
  { image_id: 'H2', status: 'success', progress: 14, brand_color_locked: true },
  { image_id: 'M1', status: 'success', progress: 36, brand_color_locked: true },
];

function buildSpecOut(locale: 'zh' | 'en'): unknown {
  // Minimal valid SpecOut: 5 hero + 9 detail + sku_meta + selling_points.
  const threePiece = { copy: 'mock copy', design_note: 'mock note', visual: 'mock visual' };
  return {
    locale,
    sku_meta: {
      sku: 'KIT-MOCK',
      name: 'Mock Kit',
      brand: 'MockBrand',
      category: 'mock',
      product_type: 'other',
      price: 9.9,
    },
    selling_points: [{ title: 'mock sp', evidence: 'mock', priority: 'high' }],
    hero_sections: (['H1', 'H2', 'H3', 'H4', 'H5'] as const).map((id) => ({
      id,
      three_piece: threePiece,
    })),
    detail_sections: (['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'] as const).map(
      (id) => ({ id, three_piece: threePiece })
    ),
  };
}

export async function mockWizardBackend(
  page: Page,
  options: MockWizardOptions = {}
): Promise<void> {
  const hits = options.hits ?? DEFAULT_HITS;
  const stylePrompt = options.stylePrompt ?? 'mock style prompt';
  const dbKitId = options.dbKitId ?? 123;
  const specLocale = options.specLocale ?? 'zh';
  const sseEvents = options.sseEvents ?? DEFAULT_SSE_EVENTS;

  await page.route('**/api/retrieval/search', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hits }),
    });
  });

  await page.route('**/api/retrieval/style-prompt', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ style_prompt: stylePrompt }),
    });
  });

  await page.route('**/api/kits/*/spec', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const compliance = { score: 95, violations: [] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        spec_markdown: '# Mock Spec\n\nmock',
        compliance,
        spec: buildSpecOut(specLocale),
      }),
    });
  });

  await page.route('**/api/kits/*/generate', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    // Extract kit_id from URL path: /api/kits/<id>/generate
    const m = /\/api\/kits\/([^/]+)\/generate/.exec(route.request().url());
    const kitId = m ? decodeURIComponent(m[1]) : 'unknown';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kit_id: kitId,
        db_kit_id: dbKitId,
        png_paths: ['mock/h1.png'],
        compliance_path: 'mock/compliance.json',
        cost_path: 'mock/cost.json',
        color_lock_summary: { H1: 1 },
        needs_review: false,
        abort_reason: null,
      }),
    });
  });

  await page.route('**/api/kits/*/events*', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const body = sseEvents.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body,
    });
  });
}

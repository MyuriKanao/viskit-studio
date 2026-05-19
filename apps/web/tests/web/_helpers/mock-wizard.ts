import type { Page, Route } from '@playwright/test';

/**
 * Stubs the chat creation pipeline so Playwright specs can drive
 * `/[locale]/new-kit` → extract → spec → generate → /kits/{db_kit_id}
 * without a live FastAPI server.
 */

export interface MockKitPipelineHit {
  image_url: string;
  score: number;
  metadata: Record<string, unknown>;
  /**
   * EPIC-13 — optional in mocks; the wire body shim defaults to `false` when
   * fixtures omit it, so existing helpers (DEFAULT_HITS, FALLBACK_HITS) keep
   * compiling while new specs can opt-in by setting `inspired: true`.
   */
  inspired?: boolean;
}

export interface MockKitPipelineOptions {
  hits?: MockKitPipelineHit[];
  /** Optional override; defaults to a placeholder zh prompt. */
  stylePrompt?: string;
  /** db_kit_id returned by /generate; tests assert post-success navigation. */
  dbKitId?: number;
  /** Locale of the SpecOut payload returned by /spec. */
  specLocale?: 'zh' | 'en';
  /** SSE event stream emitted by /events. Each frame is one `data:` line. */
  sseEvents?: Array<Record<string, unknown>>;
  extract?: Record<string, unknown>;
  specMarkdown?: string;
}

export const DEFAULT_HITS: MockKitPipelineHit[] = [
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

export const FALLBACK_HITS: MockKitPipelineHit[] = [
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
  {
    image_id: 'H1',
    status: 'success',
    png_path: '/mock/h1.png',
    progress: 7,
    brand_color_locked: true,
  },
  {
    image_id: 'H2',
    status: 'success',
    png_path: '/mock/h2.png',
    progress: 14,
    brand_color_locked: true,
  },
  {
    image_id: 'M1',
    status: 'success',
    png_path: '/mock/m1.png',
    progress: 36,
    brand_color_locked: true,
  },
];

const DEFAULT_EXTRACT = {
  name: { value: 'Mock Kit', confidence: 0.9, reasoning: 'mock product name' },
  brand: { value: 'MockBrand', confidence: 0.9, reasoning: 'mock logo' },
  category: { value: '零食', confidence: 0.9, reasoning: 'mock category' },
  product_type: { value: 'general_food', confidence: 0.9, reasoning: 'mock type' },
  price: { value: 29.9, confidence: 0.7, reasoning: 'mock price' },
  brand_color_hex: { value: '#C4513A', confidence: 0.9, reasoning: 'mock color' },
  selling_points: [
    {
      value: { title: '天然配料', evidence: 'mock evidence', priority: 'high' },
      confidence: 0.8,
      reasoning: 'mock selling point',
    },
  ],
};

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

export async function mockKitPipeline(
  page: Page,
  options: MockKitPipelineOptions = {}
): Promise<void> {
  const hits = options.hits ?? DEFAULT_HITS;
  const stylePrompt = options.stylePrompt ?? 'mock style prompt';
  const dbKitId = options.dbKitId ?? 123;
  const specLocale = options.specLocale ?? 'zh';
  const sseEvents = options.sseEvents ?? DEFAULT_SSE_EVENTS;
  const extract = options.extract ?? DEFAULT_EXTRACT;
  const specMarkdown = options.specMarkdown ?? '# Mock Spec\n\n真实文案：天然配料卖点';

  await page.route('**/api/kits/_warmup/extract', async (route: Route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  await page.route('**/api/kits/*/extract', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(extract),
    });
  });

  await page.route('**/api/retrieval/search', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    // EPIC-13 — mirror the backend default so the wire body always carries
    // `inspired`. Specs that need the ribbon can override per-hit via the
    // `hits` option.
    const wireHits = hits.map((h) => ({ ...h, inspired: h.inspired ?? false }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hits: wireHits }),
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
        spec_markdown: specMarkdown,
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

  await page.route(`**/api/kits/${dbKitId}/meta`, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        db_kit_id: dbKitId,
        kit_id: 'mock-kit-client-id',
        retrieved_bestseller_ids: [],
        spec_markdown: specMarkdown,
        spec: buildSpecOut(specLocale),
        compliance: { score: 95, violations: [] },
        cost: { total: 0.12, byRole: [{ role: 'image_generation', usd: 0.12 }] },
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

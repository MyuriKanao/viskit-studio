import type { Page } from '@playwright/test';

export type ProviderHealthRow = {
  endpoint_id: string;
  role: string;
  base_url: string | null;
  status: 'ok' | 'warn' | 'error' | null;
  latency_ms: number | null;
  last_check: string | null;
  unbound: string[] | null;
};

export const HEALTH_FIXTURE: ProviderHealthRow[] = [
  {
    endpoint_id: 'vision-default-a',
    role: 'vision',
    base_url: 'https://vision.example.com/v1',
    status: 'ok',
    latency_ms: 220,
    last_check: '2026-05-11T00:00:00Z',
    unbound: null,
  },
  {
    endpoint_id: 'llm-default-a',
    role: 'llm',
    base_url: 'https://llm.example.com/v1',
    status: 'ok',
    latency_ms: 190,
    last_check: '2026-05-11T00:00:00Z',
    unbound: null,
  },
  {
    endpoint_id: 'image-default-a',
    role: 'image',
    base_url: 'https://image.example.com/v1',
    status: 'ok',
    latency_ms: 410,
    last_check: '2026-05-11T00:00:00Z',
    unbound: null,
  },
  {
    endpoint_id: 'embedding-default-a',
    role: 'embedding',
    base_url: 'https://embedding.example.com/v1',
    status: 'ok',
    latency_ms: 110,
    last_check: '2026-05-11T00:00:00Z',
    unbound: null,
  },
];

export const SUMMARY_FIXTURE = {
  endpoints_count: 4,
  monthly_cap_usd: 120,
  brand_color: '#7A5AF8',
  default_locale: 'zh-CN',
  export_preset: 'taobao-standard',
};

export type ProviderProbeRow = {
  role: string;
  ok: boolean;
  latency_ms: number;
  models: string[];
  error: string | null;
};

export async function mockProvidersHealth(
  page: Page,
  payload: ProviderHealthRow[] = HEALTH_FIXTURE
): Promise<void> {
  const body = JSON.stringify(payload);
  await page.route('**/api/providers/health', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

export async function mockProvidersSummary(
  page: Page,
  payload: typeof SUMMARY_FIXTURE = SUMMARY_FIXTURE
): Promise<void> {
  const body = JSON.stringify(payload);
  await page.route('**/api/providers/summary', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

export async function mockProviderModels(
  page: Page,
  row: ProviderProbeRow = {
    role: 'llm',
    ok: true,
    latency_ms: 88,
    models: ['llm-default-a'],
    error: null,
  }
): Promise<void> {
  await page.route('**/api/providers/models**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [row] }),
    });
  });
}

/**
 * Force POST /api/providers/endpoints to behave as ADR-010 v2 409 checksum
 * mismatch — payload mirrors apps/api/routes/providers.py error envelope.
 */
export async function mockEndpointsConflict(
  page: Page,
  opts: { currentYaml?: string; currentSha?: string } = {}
): Promise<void> {
  const currentYaml =
    opts.currentYaml ?? 'providers:\n  llm:\n    base_url: https://disk.example.com/v1\n';
  const currentSha = opts.currentSha ?? 'sha256-on-disk-version';
  await page.route('**/api/providers/endpoints', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: {
          code: 'CHECKSUM_MISMATCH',
          current_yaml: currentYaml,
          current_sha256: currentSha,
        },
      }),
    });
  });
}

/**
 * Force POST /api/providers/endpoints to behave as ADR-010 v2 503 lock
 * timeout (ERR-CFG-001).
 */
export async function mockEndpointsLockTimeout(page: Page, retryAfterS = 2): Promise<void> {
  await page.route('**/api/providers/endpoints', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'Retry-After': String(retryAfterS) },
      body: JSON.stringify({
        detail: { code: 'CONFIG_LOCKED', retry_after_s: retryAfterS },
      }),
    });
  });
}

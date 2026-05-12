import type { Page, Route } from '@playwright/test';

/**
 * Mock POST /api/settings to echo the request body merged onto the prior
 * summary. Returns the recorded request payloads so tests can assert what
 * the page actually sent.
 */
export async function mockSettingsSaveOk(
  page: Page,
  initial: {
    brand_color: string;
    default_locale: string;
    monthly_cap_usd: number;
    export_preset: string;
  }
): Promise<{ payloads: Record<string, unknown>[] }> {
  const payloads: Record<string, unknown>[] = [];
  await page.route('**/api/settings', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    payloads.push(body);
    const merged = { ...initial, ...body };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(merged),
    });
  });
  return { payloads };
}

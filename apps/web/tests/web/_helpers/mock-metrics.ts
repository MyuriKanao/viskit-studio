import type { Page } from '@playwright/test';

/**
 * Deterministic JSON fixture for /api/metrics/weekly so the dashboard renders
 * stable KPI numbers + sparklines under e2e/visual.
 *
 * Shape mirrors WeeklyMetricsResponse (apps/web/hooks/use-weekly-metrics.ts).
 */
export const WEEKLY_METRICS_FIXTURE = {
  kits_this_week: 6,
  avg_compliance: 92.5,
  avg_manual_edit_min: 3.4,
  api_spend_usd_mtd: 12.34,
  sparks: {
    kits: [1, 2, 1, 3, 2, 4, 2],
    compliance: [88, 90, 91, 92, 93, 92, 94],
    cost: [1.1, 1.4, 1.6, 2.0, 1.8, 2.1, 2.3],
  },
};

export async function mockWeeklyMetrics(
  page: Page,
  override?: Partial<typeof WEEKLY_METRICS_FIXTURE>
): Promise<void> {
  const body = JSON.stringify({ ...WEEKLY_METRICS_FIXTURE, ...override });
  await page.route('**/api/metrics/weekly', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

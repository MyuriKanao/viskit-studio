import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import {
  SUMMARY_FIXTURE,
  mockProvidersHealth,
  mockProvidersSummary,
} from './_helpers/mock-providers';

/**
 * EPIC-7 AC #7 — Onboarding WorkspaceReadyCard.
 *
 * Mocks /api/providers/summary with deterministic JSON, then verifies the
 * card surfaces the values literally (count, monthly cap, brand color hex,
 * locale, export preset).
 */
test.describe('onboarding workspace-ready card', () => {
  test('renders summary values verbatim', async ({ page }) => {
    await mockHealthOk(page);
    await mockProvidersHealth(page);
    await mockProvidersSummary(page);

    await page.goto('/zh/onboarding');

    const card = page.getByRole('region', { name: /工作空间.*就绪|Workspace ready/ });
    await expect(card).toBeVisible();

    // Endpoints count: "{n} / {n}" string.
    await expect(
      card.getByText(`${SUMMARY_FIXTURE.endpoints_count} / ${SUMMARY_FIXTURE.endpoints_count}`)
    ).toBeVisible();

    // Monthly cap: "$120".
    await expect(card.getByText(`$${SUMMARY_FIXTURE.monthly_cap_usd.toFixed(0)}`)).toBeVisible();

    // Brand color hex literal.
    await expect(card.getByText(SUMMARY_FIXTURE.brand_color)).toBeVisible();
    // Default locale literal.
    if (SUMMARY_FIXTURE.default_locale) {
      await expect(card.getByText(SUMMARY_FIXTURE.default_locale)).toBeVisible();
    }
    // Export preset literal.
    if (SUMMARY_FIXTURE.export_preset) {
      await expect(card.getByText(SUMMARY_FIXTURE.export_preset)).toBeVisible();
    }
  });
});

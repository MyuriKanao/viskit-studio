import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import {
  TEMPLATES_FIXTURE,
  mockTemplatesError,
  mockTemplatesList,
} from './_helpers/mock-templates';
import { clickSidebarLink } from './_helpers/sidebar';

/**
 * EPIC-8 Templates page happy paths.
 *
 * Pure mocked path: /api/templates is intercepted with deterministic
 * fixtures. No backend required. No pagination — v1 is a single-screen grid.
 */
test.describe('templates page', () => {
  test('renders the list state with cards and summary count', async ({ page }) => {
    await mockHealthOk(page);
    await mockTemplatesList(page, TEMPLATES_FIXTURE);

    await page.goto('/zh/templates');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const list = page.locator('[data-testid="templates-list"]');
    await expect(list).toBeVisible();

    // 3 cards — one per fixture entry
    await expect(page.locator('[data-testid="template-card-tpl-hero-001"]')).toBeVisible();
    await expect(page.locator('[data-testid="template-card-tpl-lifestyle-002"]')).toBeVisible();
    await expect(page.locator('[data-testid="template-card-tpl-short-video-003"]')).toBeVisible();

    const summary = page.locator('[data-testid="templates-summary"]');
    await expect(summary).toContainText('3');
  });

  test('renders the empty state when no templates are seeded', async ({ page }) => {
    await mockHealthOk(page);
    await mockTemplatesList(page, []);

    await page.goto('/zh/templates');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const empty = page.locator('[data-testid="templates-empty"]');
    await expect(empty).toBeVisible();

    const summary = page.locator('[data-testid="templates-summary"]');
    await expect(summary).toContainText('0');
  });

  test('renders the error state when fetch fails', async ({ page }) => {
    await mockHealthOk(page);
    await mockTemplatesError(page, 500);

    await page.goto('/zh/templates');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    const error = page.locator('[data-testid="templates-error"]');
    await expect(error).toBeVisible();
  });

  test('sidebar Templates link navigates from dashboard to /templates', async ({ page }) => {
    await mockHealthOk(page);
    await mockTemplatesList(page, []);

    await page.goto('/zh/dashboard');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // localePrefix='as-needed' strips the `/zh` prefix for the default
    // locale, so the URL after navigation is `/templates` (not `/zh/templates`).
    await clickSidebarLink(page, '模板');
    await expect(page).toHaveURL(/\/templates$/);
  });
});

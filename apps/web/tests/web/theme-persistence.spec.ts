import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';

test.describe('theme persistence', () => {
  test('toggling theme updates data-theme + persists across reload via localStorage', async ({
    page,
  }) => {
    await mockHealthOk(page);
    await page.goto('/dashboard');
    // Initial: dark
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // Toggle
    await page.getByRole('button', { name: /切换主题|Switch theme/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Reload — localStorage carries the choice
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

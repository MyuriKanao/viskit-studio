import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';

test.describe('locale persistence', () => {
  test('toggling locale updates URL + persists across reload via cookie', async ({ page }) => {
    await mockHealthOk(page);
    await page.goto('/dashboard');
    // Open locale dropdown via Topbar trigger (LocaleFlag inside icon button)
    await page.getByRole('button', { name: /切换语言|Switch locale/ }).click();
    await page.getByRole('menuitem', { name: /English/ }).click();
    await expect(page).toHaveURL(/\/en\/dashboard/);
    // Reload — URL should stick
    await page.reload();
    await expect(page).toHaveURL(/\/en\/dashboard/);
    // Cookie should carry NEXT_LOCALE=en
    const cookies = await page.context().cookies();
    const localeCookie = cookies.find((c) => c.name === 'NEXT_LOCALE');
    expect(localeCookie?.value).toBe('en');
  });
});

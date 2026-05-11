import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';

test.describe('command palette', () => {
  test('Cmd+K opens dialog with 3 commands; Esc closes', async ({ page }) => {
    await mockHealthOk(page);
    await page.goto('/dashboard');
    // Open via keyboard
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // 3 commands visible
    await expect(page.getByText(/前往总览|Go to Dashboard/)).toBeVisible();
    await expect(page.getByText(/切换语言|Toggle locale/)).toBeVisible();
    await expect(page.getByText(/切换主题|Toggle theme/)).toBeVisible();
    // Esc closes
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('Topbar palette button opens the dialog', async ({ page }) => {
    await mockHealthOk(page);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /命令面板|Command palette/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});

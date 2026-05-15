import { expect, test } from '@playwright/test';

import { mockHealthOk } from './_helpers/mock-health';
import {
  VAULT_FIXTURE_RESPONSE,
  VAULT_TAGS_APPLY_FIXTURE,
  VAULT_TAGS_FIXTURE,
  mockVaultAssets,
  mockVaultNeighbors,
  mockVaultTagsApply,
  mockVaultTags,
} from './_helpers/mock-vault';

/**
 * EPIC-10 Batch Tag — Playwright e2e ACs.
 *
 * All network calls are intercepted at the Playwright route layer.
 * No real backend required.
 *
 * Flow coverage:
 *  AC#1 — Add flow: select 3 assets → tag → Add → toast → filter view
 *  AC#2 — Remove flow: select all in filtered view → Remove → empty state
 *  AC#3 — Autocomplete: type in combobox → suggestions list + a11y roles
 *  AC#4 — Concurrent URL state: ?tag= and ?asset= coexist independently
 *  AC#5 — Toolbar mount/unmount regression
 */

/** Selects n vault cards via their checkboxes (force:true for narrow viewports). */
async function selectCards(page: import('@playwright/test').Page, ...ids: number[]) {
  for (const id of ids) {
    const checkbox = page.locator(`[data-testid="vault-card-${id}"] input[type="checkbox"]`);
    await checkbox.check({ force: true });
  }
}

test.describe('vault bulk-tag — AC#1 add flow', () => {
  test('select 3 cards → enter tag → Add → toast shows count → filter view shows cards', async ({
    page,
  }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultTags(page, VAULT_TAGS_FIXTURE);
    await mockVaultTagsApply(page, VAULT_TAGS_APPLY_FIXTURE);

    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Select all 3 fixture cards
    await selectCards(page, 1, 2, 3);

    // Toolbar should now be visible (selection.size > 0)
    const toolbar = page.locator('[role="toolbar"]');
    await expect(toolbar).toBeVisible();

    // Type "test-y2k" into the combobox input (role="searchbox")
    const comboInput = toolbar.locator('[role="searchbox"]');
    await comboInput.fill('test-y2k');

    // Click the "Add" button (first action button in toolbar after combobox)
    // The button text in English locale is the bulk.action_add translation key.
    // We locate by its disabled-state class toggle on other buttons and type=button.
    // Pragmatically: first enabled non-clear action button inside toolbar.
    const addBtn = toolbar.getByRole('button', { name: /^Add tag$|^添加标签$/ });
    await addBtn.click({ force: true });

    // Wait for toast to appear — data-testid="vault-ingest-toast" is reused for bulk toast
    const toast = page.locator('[data-testid="vault-ingest-toast"]');
    await expect(toast).toBeVisible();
    // Pure-insert message: "Applied 'test-y2k' to 3 assets"
    await expect(toast).toContainText('test-y2k');
    await expect(toast).toContainText('3');

    // Navigate to /vault?tag=test-y2k — mock returns the same 3 assets (they carry the tag)
    // The route mock for assets already responds to any ?tag= query.
    await page.goto('/en/vault?tag=test-y2k');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // The 3 fixture cards should still be visible (mock returns all 3)
    await expect(page.locator('[data-testid="vault-card-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="vault-card-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="vault-card-3"]')).toBeVisible();
  });
});

test.describe('vault bulk-tag — AC#2 remove flow', () => {
  test('from filtered view, select all → Remove → reload filtered URL → empty state', async ({
    page,
  }) => {
    await mockHealthOk(page);
    // Start from filtered view with 3 cards
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultTags(page, VAULT_TAGS_FIXTURE);
    await mockVaultTagsApply(page, {
      applied_count: 3,
      inserted_count: 0,
      noop_count: 0,
      affected_assets: [1, 2, 3],
    });

    await page.goto('/en/vault?tag=test-y2k');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Select all 3 visible cards
    await selectCards(page, 1, 2, 3);

    const toolbar = page.locator('[role="toolbar"]');
    await expect(toolbar).toBeVisible();

    // Type the tag to remove
    const comboInput = toolbar.locator('[role="searchbox"]');
    await comboInput.fill('test-y2k');

    // Click Remove
    const removeBtn = toolbar.getByRole('button', { name: /^Remove tag$|^移除标签$/ });
    await removeBtn.click({ force: true });

    // Toast confirms removal
    const toast = page.locator('[data-testid="vault-ingest-toast"]');
    await expect(toast).toBeVisible();

    // Now mock the filtered endpoint to return empty (tag removed from all)
    await page.route('**/api/vault/assets**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, limit: 30, offset: 0 }),
      });
    });

    await page.goto('/en/vault?tag=test-y2k');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Empty state visible — all cards gone after remove + reload
    const emptyState = page.locator('[data-testid="vault-empty"]');
    await expect(emptyState).toBeVisible();
  });
});

test.describe('vault bulk-tag — AC#3 autocomplete a11y', () => {
  test('type "test" in combobox → suggestions appear; combobox root and list have correct roles', async ({
    page,
  }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultTags(page, VAULT_TAGS_FIXTURE);

    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Trigger toolbar by selecting a card
    await selectCards(page, 1);

    const toolbar = page.locator('[role="toolbar"]');
    await expect(toolbar).toBeVisible();

    // Combobox root must have role="combobox" (per ADR-EPIC10-002)
    const comboboxRoot = toolbar.locator('[role="combobox"]');
    await expect(comboboxRoot).toBeVisible();

    // Type to open suggestions
    const comboInput = toolbar.locator('[role="searchbox"]');
    await comboInput.fill('test');

    // Listbox should appear (PopoverContent mounts when open=true)
    const listbox = page.locator('[role="listbox"]').first();
    await expect(listbox).toBeVisible();

    // At least one suggestion matching "test" should appear
    // VAULT_TAGS_FIXTURE has "test-y2k" and "test-classic"
    await expect(page.getByText('test-y2k')).toBeVisible();
    await expect(page.getByText('test-classic')).toBeVisible();
  });
});

test.describe('vault bulk-tag — AC#4 concurrent URL state', () => {
  test('?tag= and ?asset= coexist — opening drawer adds ?asset=; closing removes only ?asset=', async ({
    page,
  }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);
    await mockVaultNeighbors(page);

    await page.goto('/en/vault?tag=test-y2k');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Click vault-card-1 to open the drawer
    await page.locator('[data-testid="vault-card-1"]').click({ force: true });

    // Drawer opens — URL must contain BOTH ?tag=test-y2k AND ?asset=1
    await page.locator('[data-testid="vault-drawer"]').waitFor();
    expect(page.url()).toMatch(/[?&]tag=test-y2k/);
    expect(page.url()).toMatch(/[?&]asset=1\b/);

    // Close the drawer via the Radix sheet/drawer close button (role="button", name close)
    // VaultDrawer uses Radix Sheet; close button carries aria-label from SheetClose.
    const closeBtn = page.locator('[data-testid="vault-drawer"]').getByRole('button', {
      name: /close/i,
    });
    await closeBtn.click({ force: true });

    // After close: only ?tag= remains; ?asset= is gone
    await page.waitForURL(/[?&]tag=test-y2k/);
    expect(page.url()).not.toMatch(/[?&]asset=/);
    expect(page.url()).toMatch(/[?&]tag=test-y2k/);
  });
});

test.describe('vault bulk-tag — AC#5 toolbar mount/unmount', () => {
  test('toolbar appears on select, disappears on clear selection', async ({ page }) => {
    await mockHealthOk(page);
    await mockVaultAssets(page, VAULT_FIXTURE_RESPONSE);

    await page.goto('/en/vault');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();

    // Initially no toolbar
    await expect(page.locator('[role="toolbar"]')).not.toBeAttached();

    // Select a card — toolbar mounts
    await selectCards(page, 1);
    await expect(page.locator('[role="toolbar"]')).toBeVisible();

    // Clear selection via the "Clear" button in toolbar
    const clearBtn = page.locator('[role="toolbar"]').getByRole('button', {
      name: /clear|取消|清除/i,
    });
    await clearBtn.click({ force: true });

    // Toolbar should be removed from DOM (selection.size = 0 → unmount)
    await expect(page.locator('[role="toolbar"]')).not.toBeAttached();
  });
});

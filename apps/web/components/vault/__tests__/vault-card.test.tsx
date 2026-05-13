import * as React from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { VaultCard } from '@/components/vault/vault-card';
import type { VaultAsset } from '@/hooks/use-vault-assets';

afterEach(() => {
  cleanup();
});

const MESSAGES = {
  vault: {
    page_title: 'Vault',
    summary_pattern: '{total} assets · showing {count}',
    loading: 'Loading…',
    load_error: 'Failed to load vault',
    empty_title: 'Vault is empty',
    empty_hint: 'Use "+ Ingest CSV" to import.',
    filter_category: 'Category',
    filter_season: 'Season',
    filter_locale: 'Locale',
    filter_min_sales: 'Min sales',
    filter_all: 'All',
    filter_clear: 'Clear filters',
    ingest_cta: '+ Ingest CSV',
    ingest_modal_title: 'Ingest CSV corpus',
    ingest_file_label: 'Choose CSV file',
    ingest_mode_label: 'Write mode',
    ingest_mode_upsert: 'Upsert (recommended)',
    ingest_mode_append: 'Append',
    ingest_mode_replace: 'Replace all',
    ingest_submit: 'Start ingest',
    ingest_cancel: 'Cancel',
    ingest_pending: 'Importing…',
    ingest_success_pattern: 'Done: {inserted} new, {upserted} updated, {deduplicated} deduplicated',
    ingest_error_generic: 'Ingest failed',
    ingest_error_invalid: 'CSV invalid: {message}',
    ingest_error_too_large: 'File exceeds 10MB',
    ingest_error_unsupported_media: 'Only CSV is supported',
    ingest_error_registry: 'Provider registry not booted',
    ingest_error_milvus: 'Milvus unavailable',
    sales_pattern: '{count} sold',
    pagination_prev: 'Previous',
    pagination_next: 'Next',
    page_label: 'Page {page} of {total_pages}',
  },
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {ui}
    </NextIntlClientProvider>
  );
}

const BASE_ITEM: VaultAsset = {
  id: 1,
  image_path: 'images/dress001.jpg',
  image_url: 'https://example.com/images/dress001.jpg',
  category: 'dress',
  color: 'red',
  style: 'casual',
  season: 'spring',
  sales_count: 500,
  description: 'A vibrant red casual dress for spring.',
  price: 99.9,
  locale: 'zh',
};

describe('VaultCard', () => {
  it('renders image with src=image_url, correct alt, category and sales pattern', () => {
    renderWithIntl(<VaultCard item={BASE_ITEM} />);

    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://example.com/images/dress001.jpg');
    expect(img.getAttribute('alt')).toBe('A vibrant red casual dress for spring.');

    // category · season label visible
    expect(screen.getByText('dress · spring')).toBeDefined();

    // sales pattern: "500 sold"
    expect(screen.getByText('500 sold')).toBeDefined();
  });

  it('uses category as img alt when description is empty', () => {
    const item: VaultAsset = { ...BASE_ITEM, description: '' };
    renderWithIntl(<VaultCard item={item} />);

    const img = screen.getByRole('img');
    expect(img.getAttribute('alt')).toBe('dress');
  });

  it('renders price with two decimal places', () => {
    const item: VaultAsset = { ...BASE_ITEM, price: 29.5 };
    renderWithIntl(<VaultCard item={item} />);

    expect(screen.getByText('¥29.50')).toBeDefined();
  });
});

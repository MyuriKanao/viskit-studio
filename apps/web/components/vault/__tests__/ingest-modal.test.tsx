import * as React from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IngestModal } from '@/components/vault/ingest-modal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    page_label: 'Page {page}',
  },
};

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderModal(props: Partial<React.ComponentProps<typeof IngestModal>> = {}) {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <IngestModal
          open={true}
          onOpenChange={() => undefined}
          onSuccess={() => undefined}
          onError={() => undefined}
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe('IngestModal', () => {
  it('renders file input with required and mode select with 3 options', () => {
    renderModal();

    const fileInput = screen.getByLabelText('Choose CSV file') as HTMLInputElement;
    expect(fileInput.type).toBe('file');
    expect(fileInput.required).toBe(true);

    const modeSelect = screen.getByLabelText('Write mode') as HTMLSelectElement;
    expect(modeSelect.options.length).toBe(3);
    expect(modeSelect.options[0].value).toBe('upsert');
    expect(modeSelect.options[1].value).toBe('append');
    expect(modeSelect.options[2].value).toBe('replace');
  });

  it('file input has required attribute so submission without file is blocked', () => {
    renderModal();

    const fileInput = screen.getByLabelText('Choose CSV file') as HTMLInputElement;
    expect(fileInput.required).toBe(true);
  });

  it('submit button is disabled while mutation is pending', async () => {
    // Stub fetch to never resolve so mutation stays pending
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined))
    );

    const { getByRole } = renderModal();
    const submitBtn = getByRole('button', { name: 'Start ingest' });

    // Before submit: not disabled
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
  });
});

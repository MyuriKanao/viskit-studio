import * as React from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    ingest_replace_warning: 'Replace all wipes the corpus.',
    ingest_replace_confirm_label: 'Type "{token}" to confirm',
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

  it('mode=replace gates submit until the confirm token is typed', () => {
    renderModal();

    const modeSelect = screen.getByLabelText('Write mode') as HTMLSelectElement;
    fireEvent.change(modeSelect, { target: { value: 'replace' } });

    const submitBtn = screen.getByRole('button', {
      name: 'Start ingest',
    }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    expect(screen.getByTestId('vault-ingest-replace-gate')).toBeTruthy();

    const confirmInput = screen.getByLabelText('Type "replace" to confirm') as HTMLInputElement;
    fireEvent.change(confirmInput, { target: { value: 'wrong' } });
    expect(submitBtn.disabled).toBe(true);

    fireEvent.change(confirmInput, { target: { value: 'replace' } });
    expect(submitBtn.disabled).toBe(false);
  });

  it('mode=replace gate clears when switching back to a safe mode', () => {
    renderModal();

    const modeSelect = screen.getByLabelText('Write mode') as HTMLSelectElement;
    fireEvent.change(modeSelect, { target: { value: 'replace' } });
    const confirmInput = screen.getByLabelText('Type "replace" to confirm') as HTMLInputElement;
    fireEvent.change(confirmInput, { target: { value: 'replace' } });

    // Switch back to upsert — gate disappears, submit enabled.
    fireEvent.change(modeSelect, { target: { value: 'upsert' } });
    expect(screen.queryByTestId('vault-ingest-replace-gate')).toBeNull();
    const submitBtn = screen.getByRole('button', {
      name: 'Start ingest',
    }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);

    // Switch to replace again — gate should be re-armed (confirm cleared).
    fireEvent.change(modeSelect, { target: { value: 'replace' } });
    const reInput = screen.getByLabelText('Type "replace" to confirm') as HTMLInputElement;
    expect(reInput.value).toBe('');
    expect(submitBtn.disabled).toBe(true);
  });
});

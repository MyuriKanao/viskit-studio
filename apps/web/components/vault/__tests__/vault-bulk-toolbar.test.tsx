import * as React from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VaultBulkToolbar } from '@/components/vault/vault-bulk-toolbar';

// Stub fetch: GET /tags → [], POST /tags/apply → TagApplyResponse
const APPLY_RESPONSE = {
  applied_count: 3,
  inserted_count: 3,
  noop_count: 0,
  affected_assets: [1, 2, 3],
};
vi.stubGlobal(
  'fetch',
  vi.fn((url: string) => {
    if (String(url).includes('/tags/apply')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(APPLY_RESPONSE) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  })
);

// Stub ResizeObserver — cmdk uses it internally, jsdom doesn't implement it
vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MESSAGES = {
  vault: {
    bulk: {
      selection_count: '{count} selected',
      action_add: 'Add tag',
      action_remove: 'Remove tag',
      clear_selection: 'Clear selection',
      combobox_placeholder: 'Type a lowercase tag…',
      combobox_create_pattern: "+ Create ''{input}''",
      apply_success_with_noop:
        "Applied '{tag}' to {total} assets ({inserted} new, {noop} already had it)",
      apply_success_pure_insert: "Applied '{tag}' to {total} assets",
      apply_error_generic: 'Failed to apply tag',
    },
  },
};

function renderWithIntl(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe('VaultBulkToolbar', () => {
  it('renders with role="toolbar" and shows selection count', () => {
    renderWithIntl(
      <VaultBulkToolbar selection={new Set([1, 2, 3])} onClear={vi.fn()} onApply={vi.fn()} />
    );

    const toolbar = screen.getByRole('toolbar');
    expect(toolbar).toBeDefined();
    expect(screen.getByText('3 selected')).toBeDefined();
  });

  it('renders combobox with role="combobox"', () => {
    renderWithIntl(
      <VaultBulkToolbar selection={new Set([1, 2, 3])} onClear={vi.fn()} onApply={vi.fn()} />
    );

    const combobox = screen.getByRole('combobox');
    expect(combobox).toBeDefined();
  });

  it('calls onClear when Clear selection is clicked', () => {
    const onClear = vi.fn();
    renderWithIntl(
      <VaultBulkToolbar selection={new Set([1, 2, 3])} onClear={onClear} onApply={vi.fn()} />
    );

    fireEvent.click(screen.getByText('Clear selection'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('calls onApply("add", ["y2k"]) after typing a tag and clicking Add tag', async () => {
    const onApply = vi.fn();
    renderWithIntl(
      <VaultBulkToolbar selection={new Set([1, 2, 3])} onClear={vi.fn()} onApply={onApply} />
    );

    // Focus then type into the combobox input to open popover
    const input = screen.getByRole('searchbox');
    act(() => {
      fireEvent.focus(input);
    });
    act(() => {
      fireEvent.change(input, { target: { value: 'y2k' } });
    });

    // The create item should appear in the portal
    await waitFor(() => {
      expect(screen.getByText("+ Create 'y2k'")).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText("+ Create 'y2k'"));
    });

    // Now click Add tag
    act(() => {
      fireEvent.click(screen.getByText('Add tag'));
    });

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith('add', ['y2k'], APPLY_RESPONSE);
    });
  });
});

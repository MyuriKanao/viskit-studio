import * as React from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsSave } from '../../hooks/use-settings';

/**
 * EPIC-8 Settings — useSettingsSave mutation contract.
 *
 * Mocks `fetch` rather than spinning up a server. Asserts that the request
 * payload matches the Partial<Settings> shape and that non-2xx responses
 * surface as thrown Error objects.
 */

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSettingsSave', () => {
  it('POSTs partial settings and returns parsed JSON on success', async () => {
    const echo = {
      brand_color: '#112233',
      default_locale: 'en',
      monthly_cap_usd: 250,
      export_preset: 'tmall',
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(echo), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSettingsSave(), { wrapper: makeWrapper() });
    const out = await result.current.mutateAsync({ brand_color: '#112233' });

    expect(out).toEqual(echo);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = callArgs[0];
    const init = callArgs[1];
    expect(url).toMatch(/\/api\/settings$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ brand_color: '#112233' });
  });

  it('throws Error when the backend returns 422', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: 'bad' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSettingsSave(), { wrapper: makeWrapper() });
    await expect(result.current.mutateAsync({ brand_color: 'red' })).rejects.toThrow(/422/);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

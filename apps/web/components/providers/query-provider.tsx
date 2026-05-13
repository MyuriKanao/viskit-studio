'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import * as React from 'react';

function makeClient(): QueryClient {
  // Architect-recommended split: queries do not retry by default so that
  // fetch errors surface to the UI on the first attempt (the previous
  // global `retry: 1` was masking real 5xx signals — useTemplates and
  // useVaultAssets each had to opt out locally). Mutations still retry
  // once because they're typically user-triggered and one extra attempt
  // smooths over transient network blips without distorting semantics.
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: false,
      },
      mutations: {
        retry: 1,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState lazy initializer keeps one client per React tree mount (and
  // survives Strict Mode's double-mount). One client per mount is what
  // TanStack recommends for Next.js App Router.
  const [client] = React.useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV !== 'production' ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}

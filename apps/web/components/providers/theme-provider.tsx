'use client';

import * as React from 'react';

import { applyTheme, readStoredTheme } from '@/components/shell/theme-toggle-helpers';

/**
 * On first client mount, hydrate <html data-theme="..."> from localStorage.
 * No SSR theme reading because the persistence is client-only (cookie-free
 * by design for v1; revisit with FOUC mitigation in EPIC-10).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    applyTheme(readStoredTheme());
  }, []);
  return <>{children}</>;
}

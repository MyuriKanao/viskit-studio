'use client';

import * as React from 'react';

import { useProvidersSummary } from '@/hooks/use-providers-summary';
import { applyBrandAccent } from '@/lib/brand-theme';

export function WorkspaceThemeProvider({ children }: { children: React.ReactNode }) {
  const summary = useProvidersSummary();

  React.useEffect(() => {
    applyBrandAccent(summary.data?.brand_color ?? null);
  }, [summary.data?.brand_color]);

  return <>{children}</>;
}

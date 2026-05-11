'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { StatusChip } from '@/components/atoms/status-chip';
import { useProvidersHealth } from '@/hooks/use-providers-health';
import { useProvidersSummary } from '@/hooks/use-providers-summary';
import { cn } from '@/lib/utils';

export interface WorkspaceReadyCardProps {
  className?: string;
}

export function WorkspaceReadyCard({ className }: WorkspaceReadyCardProps) {
  const t = useTranslations('onboarding');
  const summary = useProvidersSummary();
  const health = useProvidersHealth();

  const allOk = React.useMemo(() => {
    if (!health.data || health.data.length === 0) return false;
    return health.data.every((r) => r.unbound === null || r.unbound.length === 0);
  }, [health.data]);

  const swatch =
    summary.data?.brand_color && /^#[0-9a-fA-F]{6}$/.test(summary.data.brand_color)
      ? summary.data.brand_color
      : null;

  const rows: { key: string; value: React.ReactNode }[] = [
    {
      key: t('endpoints_count_label'),
      value: summary.data
        ? `${summary.data.endpoints_count} / ${summary.data.endpoints_count}`
        : '—',
    },
    {
      key: t('monthly_cap_label'),
      value:
        summary.data?.monthly_cap_usd != null ? `$${summary.data.monthly_cap_usd.toFixed(0)}` : '—',
    },
    {
      key: t('brand_color_label'),
      value: (
        <span className="inline-flex items-center gap-s-2">
          {swatch ? (
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-input border border-border-subtle"
              // Dynamic config-sourced color — surfaced via CSS custom property
              // so the value comes from runtime data, not a hex literal in JSX.
              style={
                {
                  ['--swatch' as string]: swatch,
                  backgroundColor: 'var(--swatch)',
                } as React.CSSProperties
              }
            />
          ) : null}
          <span className="font-mono text-xs text-ink-primary">{swatch ?? '—'}</span>
        </span>
      ),
    },
    {
      key: t('default_locale_label'),
      value: summary.data?.default_locale ?? '—',
    },
    {
      key: t('export_preset_label'),
      value: summary.data?.export_preset ?? '—',
    },
  ];

  return (
    <section
      aria-label={t('workspace_ready_title')}
      className={cn(
        'flex flex-col gap-s-4 rounded-card border border-border-subtle bg-surface-01 p-s-5',
        className
      )}
    >
      <div className="flex items-center justify-between gap-s-2">
        <span className="font-display text-lg text-ink-primary">{t('workspace_ready_title')}</span>
        <StatusChip
          status={allOk ? 'ok' : summary.isLoading || health.isLoading ? 'pending' : 'warn'}
          label={allOk ? 'ready' : summary.isLoading ? '…' : 'check'}
        />
      </div>
      <ul className="grid grid-cols-1 gap-s-2 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-baseline gap-s-2">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
              {r.key}
            </span>
            <span className="text-sm text-ink-secondary">{r.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

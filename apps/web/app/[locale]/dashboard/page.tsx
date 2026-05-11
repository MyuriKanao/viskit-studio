'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { KitCard } from '@/components/dashboard/kit-card';
import { KPICard } from '@/components/dashboard/kpi-card';
import { QueueRow } from '@/components/dashboard/queue-row';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { useQueueActive } from '@/hooks/use-queue-active';
import { useRecentKits } from '@/hooks/use-recent-kits';
import { useWeeklyMetrics } from '@/hooks/use-weekly-metrics';

function formatDelta(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}`;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const locale = useLocale() as 'zh' | 'en';
  const router = useRouter();
  const metrics = useWeeklyMetrics();
  const kits = useRecentKits({ limit: 6 });
  const queue = useQueueActive();

  const onKitClick = React.useCallback(
    (id: number) => {
      const prefix = locale === 'zh' ? '' : `/${locale}`;
      router.push(`${prefix}/kits/${id}`);
    },
    [locale, router]
  );

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[64px_1fr] bg-ink-base">
      <div className="row-span-2">
        <Sidebar />
      </div>
      <div className="col-start-2">
        <Topbar />
      </div>
      <main className="col-start-2 row-start-2 flex flex-col gap-s-6 overflow-auto p-s-6">
        {/* KPI strip */}
        <section aria-label={t('kpis_title')} className="flex flex-col gap-s-3">
          <h2 className="font-display text-xl text-ink-primary">{t('kpis_title')}</h2>
          <div className="grid grid-cols-1 gap-s-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard
              label={t('kpi_kits_label')}
              value={metrics.data?.kits_this_week ?? '—'}
              unit="kits"
              sparkData={metrics.data?.sparks.kits ?? []}
              color="var(--accent-soft)"
            />
            <KPICard
              label={t('kpi_compliance_label')}
              value={metrics.data?.avg_compliance?.toFixed(1) ?? '—'}
              unit="/100"
              delta={formatDelta(metrics.data?.avg_compliance ?? null)}
              sparkData={metrics.data?.sparks.compliance ?? []}
              color="var(--success)"
            />
            <KPICard
              label={t('kpi_manual_edit_label')}
              value={metrics.data?.avg_manual_edit_min?.toFixed(1) ?? '—'}
              unit="min"
              sparkData={[]}
              color="var(--warning)"
              downward
            />
            <KPICard
              label={t('kpi_api_spend_label')}
              value={metrics.data?.api_spend_usd_mtd.toFixed(2) ?? '—'}
              unit="USD"
              sparkData={metrics.data?.sparks.cost ?? []}
              color="var(--accent)"
            />
          </div>
        </section>

        {/* Recent Kits */}
        <section aria-label={t('recent_kits_title')} className="flex flex-col gap-s-3">
          <h2 className="font-display text-xl text-ink-primary">{t('recent_kits_title')}</h2>
          <div className="grid grid-cols-1 gap-s-4 md:grid-cols-2 lg:grid-cols-3">
            {kits.data?.items.map((kit) => (
              <KitCard key={kit.id} kit={kit} locale={locale} onClick={() => onKitClick(kit.id)} />
            ))}
            {kits.isLoading
              ? [0, 1, 2].map((i) => (
                  <div
                    key={`kit-skeleton-${i}`}
                    aria-hidden="true"
                    className="h-72 animate-pulse rounded-card border border-border-subtle bg-surface-02"
                  />
                ))
              : null}
          </div>
        </section>

        {/* Queue strip */}
        <section aria-label={t('queue_title')} className="flex flex-col gap-s-3">
          <h2 className="font-display text-xl text-ink-primary">{t('queue_title')}</h2>
          <div className="flex flex-col gap-s-2">
            {queue.data && queue.data.jobs.length > 0 ? (
              queue.data.jobs.map((job) => <QueueRow key={job.kit_id} row={job} />)
            ) : (
              <p className="rounded-card border border-dashed border-border-subtle bg-surface-01 p-s-4 text-sm text-ink-muted">
                {queue.isLoading ? '…' : '0 jobs in progress'}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

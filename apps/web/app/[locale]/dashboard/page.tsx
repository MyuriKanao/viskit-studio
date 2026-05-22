'use client';

import { Plus, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { KitCard } from '@/components/dashboard/kit-card';
import { KPICard } from '@/components/dashboard/kpi-card';
import {
  GenerationTaskRecordCard,
  isGenerationJobActive,
} from '@/components/generation/GenerationTaskRecordCard';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGenerationJobRecords } from '@/hooks/use-generation-job';
import { useRecentKits } from '@/hooks/use-recent-kits';
import { useWeeklyMetrics } from '@/hooks/use-weekly-metrics';

function formatDelta(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}`;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tAll = useTranslations();
  const locale = useLocale() as 'zh' | 'en';
  const router = useRouter();
  const metrics = useWeeklyMetrics();
  const kits = useRecentKits({ limit: 6 });
  const queue = useGenerationJobRecords({ limit: 6 });
  const queueJobs = queue.data?.jobs ?? [];
  const queueCount = queueJobs.length;
  const activeQueueCount = queueJobs.filter((job) => isGenerationJobActive(job.status)).length;
  const kitCount = kits.data?.items.length ?? 0;
  const isRefreshing = metrics.isFetching || kits.isFetching || queue.isFetching;

  const localePrefix = locale === 'zh' ? '' : `/${locale}`;

  const onKitClick = React.useCallback(
    (id: number) => {
      router.push(`${localePrefix}/kits/${id}`);
    },
    [localePrefix, router]
  );

  const onRefresh = React.useCallback(() => {
    void metrics.refetch();
    void kits.refetch();
    void queue.refetch();
  }, [kits, metrics, queue]);

  const onCreateKit = React.useCallback(
    () => router.push(`${localePrefix}/new-kit`),
    [localePrefix, router]
  );

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[64px_1fr] overflow-hidden bg-ink-base">
      <div className="row-span-2">
        <Sidebar />
      </div>
      <div className="col-start-2">
        <Topbar />
      </div>
      <main className="col-start-2 row-start-2 flex flex-col gap-s-6 overflow-auto bg-ink-base p-s-6">
        <section className="flex flex-col gap-s-4 border-b border-border-subtle pb-s-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-3xl flex-col gap-s-3">
            <Badge variant="secondary" className="w-fit">
              Viskit Studio
            </Badge>
            <div className="flex flex-col gap-s-2">
              <h1 className="font-display text-4xl leading-tight text-ink-primary">
                {t('kpis_title')}
              </h1>
              <p className="text-sm leading-6 text-ink-muted">
                {t('queue_subtitle_pattern', { count: activeQueueCount })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-s-2">
            <Button
              type="button"
              variant="outline"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="min-w-28"
            >
              <RefreshCw
                aria-hidden="true"
                className={isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
              />
              <span>{t('refresh_button')}</span>
            </Button>
            <Button type="button" onClick={onCreateKit}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              <span>{t('new_kit_button')}</span>
            </Button>
          </div>
        </section>

        <section aria-label={t('kpis_title')} className="flex flex-col gap-s-3">
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

        <Tabs defaultValue="kits" className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-s-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="w-fit">
              <TabsTrigger value="kits" className="gap-s-2">
                <span>{t('recent_kits_title')}</span>
                <Badge variant="secondary" className="font-mono">
                  {kitCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="queue" className="gap-s-2">
                <span>{t('queue_title')}</span>
                <Badge
                  variant={activeQueueCount > 0 ? 'default' : 'secondary'}
                  className="font-mono"
                >
                  {queueCount}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="kits" className="min-h-0">
            <section aria-label={t('recent_kits_title')} className="flex flex-col gap-s-4">
              <div className="grid grid-cols-1 gap-s-4 md:grid-cols-2 xl:grid-cols-3">
                {kits.data?.items.map((kit) => (
                  <KitCard
                    key={kit.id}
                    kit={kit}
                    locale={locale}
                    onClick={() => onKitClick(kit.id)}
                  />
                ))}
                {kits.isLoading
                  ? [0, 1, 2].map((i) => (
                      <Skeleton
                        key={`kit-skeleton-${i}`}
                        aria-hidden="true"
                        className="h-72 border border-border-subtle"
                      />
                    ))
                  : null}
              </div>
              {!kits.isLoading && kitCount === 0 ? (
                <p className="rounded-card border border-dashed border-border-subtle bg-surface-01 p-s-5 text-sm text-ink-muted">
                  {tAll('catalog.grid_empty')}
                </p>
              ) : null}
            </section>
          </TabsContent>

          <TabsContent value="queue" className="min-h-0">
            <section aria-label={t('queue_title')} className="flex flex-col gap-s-3">
              <div className="rounded-card border border-border-subtle bg-surface-01 p-s-3">
                {queueJobs.length > 0 ? (
                  <div className="grid gap-s-3 xl:grid-cols-2">
                    {queueJobs.map((job) => (
                      <GenerationTaskRecordCard
                        key={job.job_id}
                        job={job}
                        locale={locale}
                        compact
                      />
                    ))}
                  </div>
                ) : (
                  <p className="p-s-4 text-sm text-ink-muted">
                    {queue.isLoading ? '…' : tAll('queue.empty_hint')}
                  </p>
                )}
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

'use client';

import { RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';

import {
  GenerationTaskRecordCard,
  isGenerationJobActive,
  isGenerationJobComplete,
  isGenerationJobFailed,
} from '@/components/generation/GenerationTaskRecordCard';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { useGenerationJobRecordPages } from '@/hooks/use-generation-job';
import type { GenerationJobSnapshot } from '@/lib/generation/types';

/**
 * Durable task-record queue.
 *
 * The visible queue now follows `/api/generation/jobs`, not the legacy
 * in-memory kit event bus, so completed/failed tasks and generated outputs
 * remain available after the generation flow finishes.
 */
export default function QueuePage() {
  const t = useTranslations('queue');
  const locale = useLocale() as 'zh' | 'en';
  const query = useGenerationJobRecordPages({ limit: 50 });
  const pages = query.data?.pages ?? [];
  const jobs = React.useMemo(() => pages.flatMap((page) => page.jobs), [pages]);
  const total = pages[0]?.total ?? jobs.length;
  const stats = React.useMemo(() => buildQueueStats(jobs, total), [jobs, total]);

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[64px_1fr] bg-ink-base">
      <div className="row-span-2">
        <Sidebar />
      </div>
      <div className="col-start-2">
        <Topbar />
      </div>
      <main className="col-start-2 row-start-2 overflow-auto p-s-6">
        <div className="flex flex-col gap-s-5">
          <header className="flex flex-col gap-s-4 border-b border-border-subtle pb-s-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="font-display text-3xl text-ink-primary">{t('page_title')}</h1>
              <p className="mt-s-2 text-sm leading-6 text-ink-muted">{t('page_subtitle')}</p>
              <span
                data-testid="queue-summary"
                className="mt-s-3 inline-block font-mono text-xs uppercase tracking-wider text-ink-faint"
              >
                {t('summary_pattern', {
                  total: stats.total,
                  loaded: jobs.length,
                  active: stats.active,
                })}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className="w-fit"
            >
              <RefreshCw
                aria-hidden="true"
                className={query.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
              />
              <span>{query.isFetching ? t('refreshing') : t('refresh_button')}</span>
            </Button>
          </header>

          <section className="grid grid-cols-1 gap-s-3 sm:grid-cols-2 xl:grid-cols-4">
            <QueueStat label={t('stat_total')} value={stats.total} />
            <QueueStat label={t('stat_active')} value={stats.active} tone="accent" />
            <QueueStat label={t('stat_done')} value={stats.done} tone="success" />
            <QueueStat label={t('stat_failed')} value={stats.failed} tone="danger" />
          </section>

          <section
            aria-label={t('page_title')}
            className="rounded-card border border-border-subtle bg-surface-02 p-s-4"
          >
            {query.isError ? (
              <p data-testid="queue-error" className="text-sm text-danger">
                {t('load_error')}
              </p>
            ) : query.isLoading && !query.data ? (
              <p data-testid="queue-loading" className="text-sm text-ink-muted">
                {t('loading')}
              </p>
            ) : jobs.length === 0 ? (
              <div
                data-testid="queue-empty"
                className="flex flex-col items-center gap-s-2 py-s-6 text-center"
              >
                <span className="font-display text-lg text-ink-primary">{t('empty_title')}</span>
                <span className="text-sm text-ink-muted">{t('empty_hint')}</span>
              </div>
            ) : (
              <div data-testid="queue-list" className="flex flex-col gap-s-4">
                {jobs.map((job) => (
                  <GenerationTaskRecordCard key={job.job_id} job={job} locale={locale} />
                ))}
                {query.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void query.fetchNextPage()}
                    disabled={query.isFetchingNextPage}
                    className="mx-auto mt-s-2 w-fit"
                  >
                    {query.isFetchingNextPage ? t('loading_more') : t('load_more')}
                  </Button>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function buildQueueStats(jobs: GenerationJobSnapshot[], total: number) {
  const stats = jobs.reduce(
    (acc, job) => {
      if (isGenerationJobActive(job.status)) acc.active += 1;
      if (isGenerationJobComplete(job.status)) acc.done += 1;
      if (isGenerationJobFailed(job.status)) acc.failed += 1;
      return acc;
    },
    { total, active: 0, done: 0, failed: 0 }
  );
  return stats;
}

function QueueStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'accent' | 'success' | 'danger';
}) {
  const toneClass = {
    neutral: 'text-ink-primary',
    accent: 'text-accent',
    success: 'text-success',
    danger: 'text-danger',
  }[tone];

  return (
    <div className="rounded-card border border-border-subtle bg-surface-01 p-s-4">
      <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`mt-s-2 font-display text-3xl ${toneClass}`}>{value}</p>
    </div>
  );
}

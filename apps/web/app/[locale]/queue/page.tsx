'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { QueueRow } from '@/components/dashboard/queue-row';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { useQueueActive } from '@/hooks/use-queue-active';

/**
 * EPIC-8 Phase 4 — dedicated read-only Queue page.
 *
 * Composes the shared /api/queue/active hook + dashboard's QueueRow to
 * surface every in-flight job in one place. Polling cadence (4s) lives
 * inside `useQueueActive`; no manual refresh affordance per spec.
 *
 * Pause/resume is INTENTIONALLY out of scope. The orchestrator runs
 * jobs in-process via `KitEventBus` (see services/imagegen) rather than
 * the arq dependency declared in `pyproject.toml`, and adding pause
 * controls would require re-architecting around a Redis-backed worker
 * pool. Acceptable for a single-tenant self-hosted tool; revisit only
 * if a real multi-operator workflow emerges.
 */
export default function QueuePage() {
  const t = useTranslations('queue');
  const query = useQueueActive();
  const jobs = query.data?.jobs ?? [];
  const count = jobs.length;

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
          <header className="flex items-baseline justify-between gap-s-3">
            <h1 className="font-display text-2xl text-ink-primary">{t('page_title')}</h1>
            <span
              data-testid="queue-summary"
              className="font-mono text-xs uppercase tracking-wider text-ink-faint"
            >
              {t('summary_pattern', { count })}
            </span>
          </header>

          <section
            aria-label={t('page_title')}
            className="rounded-card border border-border-subtle bg-surface-01 p-s-4"
          >
            {query.isError ? (
              <p data-testid="queue-error" className="text-sm text-danger">
                {t('load_error')}
              </p>
            ) : query.isLoading && !query.data ? (
              <p data-testid="queue-loading" className="text-sm text-ink-muted">
                {t('loading')}
              </p>
            ) : count === 0 ? (
              <div
                data-testid="queue-empty"
                className="flex flex-col items-center gap-s-2 py-s-6 text-center"
              >
                <span className="font-display text-lg text-ink-primary">{t('empty_title')}</span>
                <span className="text-sm text-ink-muted">{t('empty_hint')}</span>
              </div>
            ) : (
              <div data-testid="queue-list" className="flex flex-col gap-s-2">
                {jobs.map((job) => (
                  <div key={job.kit_id} data-testid={`queue-row-${job.kit_id}`}>
                    <QueueRow row={job} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

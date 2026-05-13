'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { IngestModal } from '@/components/vault/ingest-modal';
import { VaultFiltersBar } from '@/components/vault/vault-filters';
import { VaultGrid } from '@/components/vault/vault-grid';
import { type VaultFilters, useVaultAssets } from '@/hooks/use-vault-assets';
import type { VaultIngestResponse } from '@/hooks/use-vault-ingest';

const PAGE_SIZE = 30;

/**
 * EPIC-8 Vault — browsable bestseller corpus + ingest CTA.
 *
 * Mirrors queue/templates shell layout 1:1: Sidebar + Topbar grid,
 * 4-state branching (error / loading / empty / list).
 */
export default function VaultPage() {
  const t = useTranslations('vault');
  const [filters, setFilters] = React.useState<VaultFilters>({});
  const [offset, setOffset] = React.useState(0);
  const [ingestOpen, setIngestOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{ kind: 'success' | 'error'; message: string } | null>(
    null
  );

  const query = useVaultAssets({ limit: PAGE_SIZE, offset, ...filters });
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const count = items.length;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleIngestSuccess(report: VaultIngestResponse) {
    setToast({
      kind: 'success',
      message: t('ingest_success_pattern', {
        inserted: report.inserted,
        upserted: report.upserted,
        deduplicated: report.deduplicated,
      }),
    });
  }

  function handleIngestError(_err: Error) {
    setToast({ kind: 'error', message: t('ingest_error_generic') });
  }

  function handleFiltersChange(next: VaultFilters) {
    setFilters(next);
    setOffset(0);
  }

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
              data-testid="vault-summary"
              className="font-mono text-xs uppercase tracking-wider text-ink-faint"
            >
              {t('summary_pattern', { total, count })}
            </span>
          </header>

          <div className="flex items-center justify-between gap-s-3 flex-wrap">
            <VaultFiltersBar value={filters} onChange={handleFiltersChange} />
            <button
              type="button"
              data-testid="vault-ingest-cta"
              aria-label={t('ingest_cta')}
              onClick={() => setIngestOpen(true)}
              className="rounded-input bg-accent px-s-3 py-s-1 text-sm text-ink-on-accent"
            >
              {t('ingest_cta')}
            </button>
          </div>

          {toast !== null ? (
            <output data-testid="vault-ingest-toast">{toast.message}</output>
          ) : null}

          <section
            aria-label={t('page_title')}
            className="rounded-card border border-border-subtle bg-surface-01 p-s-4"
          >
            {query.isError ? (
              <p data-testid="vault-error" className="text-sm text-danger">
                {t('load_error')}
              </p>
            ) : query.isLoading && !query.data ? (
              <p data-testid="vault-loading" className="text-sm text-ink-muted">
                {t('loading')}
              </p>
            ) : count === 0 ? (
              <div
                data-testid="vault-empty"
                className="flex flex-col items-center gap-s-2 py-s-6 text-center"
              >
                <span className="font-display text-lg text-ink-primary">{t('empty_title')}</span>
                <span className="text-sm text-ink-muted">{t('empty_hint')}</span>
              </div>
            ) : (
              <VaultGrid items={items} />
            )}
          </section>

          {count > 0 ? (
            <div className="flex items-center justify-between gap-s-3">
              <button
                type="button"
                aria-label={t('pagination_prev')}
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-1 text-sm text-ink-muted disabled:opacity-40"
              >
                {t('pagination_prev')}
              </button>
              <span className="font-mono text-xs text-ink-faint">
                {t('page_label', { page, total_pages: totalPages })}
              </span>
              <button
                type="button"
                aria-label={t('pagination_next')}
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-1 text-sm text-ink-muted disabled:opacity-40"
              >
                {t('pagination_next')}
              </button>
            </div>
          ) : null}
        </div>
      </main>

      <IngestModal
        open={ingestOpen}
        onOpenChange={setIngestOpen}
        onSuccess={handleIngestSuccess}
        onError={handleIngestError}
      />
    </div>
  );
}

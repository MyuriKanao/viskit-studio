'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
// NOTE: useVaultTagsApply is intentionally NOT imported here. It lives in the
// lazy vault-bulk-toolbar chunk so it doesn't inflate /vault First Load JS.
// The TagApplyResponse type flows back via the toolbar's onApply callback.
import type { TagApplyResponse } from '@/components/vault/vault-bulk-toolbar';
import { VaultFiltersBar } from '@/components/vault/vault-filters';
import { VaultGrid } from '@/components/vault/vault-grid';
import { type VaultAsset, type VaultFilters, useVaultAssets } from '@/hooks/use-vault-assets';
import type { VaultIngestResponse } from '@/hooks/use-vault-ingest';

// EPIC-9 bundle budget: First Load JS ≤ 170 kB for /vault. Drawer + Ingest
// modal are click-only — both go behind next/dynamic so they don't ship on
// initial paint. Mirrors TD-6 pattern.
const VaultDrawer = dynamic(
  () => import('@/components/drawers/VaultDrawer').then((m) => m.VaultDrawer),
  { ssr: false }
);
const IngestModal = dynamic(
  () => import('@/components/vault/ingest-modal').then((m) => m.IngestModal),
  { ssr: false }
);
// EPIC-10 bundle budget: toolbar + combobox are selection-gated — lazy so
// they don't inflate First Load JS when no selection is active.
const VaultBulkToolbar = dynamic(
  () => import('@/components/vault/vault-bulk-toolbar').then((m) => m.VaultBulkToolbar),
  { ssr: false }
);

const PAGE_SIZE = 30;

/**
 * EPIC-8 Vault — browsable bestseller corpus + ingest CTA.
 *
 * Mirrors queue/templates shell layout 1:1: Sidebar + Topbar grid,
 * 4-state branching (error / loading / empty / list).
 */
export default function VaultPage() {
  const t = useTranslations('vault');
  const tBulk = useTranslations('vault.bulk');
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?tag= is URL-driven: initialize from searchParams so the filter chip
  // is pre-filled on deep-link / refresh. ?asset= is independent (drawer).
  const urlTag = searchParams.get('tag') ?? undefined;
  const [filters, setFilters] = React.useState<VaultFilters>(() => ({
    tag: urlTag,
  }));
  const [offset, setOffset] = React.useState(0);
  const [ingestOpen, setIngestOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{ kind: 'success' | 'error'; message: string } | null>(
    null
  );

  const query = useVaultAssets({ limit: PAGE_SIZE, offset, ...filters });
  const items = query.data?.items ?? [];
  const [selection, setSelection] = React.useState<Set<number>>(new Set());

  const toggleSelect = React.useCallback((id: number, next: boolean) => {
    setSelection((prev) => {
      const s = new Set(prev);
      if (next) {
        s.add(id);
      } else {
        s.delete(id);
      }
      return s;
    });
  }, []);

  // handleBulkApply receives the resolved TagApplyResponse from VaultBulkToolbar
  // (toolbar owns useVaultTagsApply in its lazy chunk to stay within budget).
  const handleBulkApply = React.useCallback(
    (_action: 'add' | 'remove', tags: string[], resp: TagApplyResponse) => {
      const tag = tags.join(', ');
      const total = resp.affected_assets.length;
      const message =
        resp.noop_count > 0
          ? tBulk('apply_success_with_noop', {
              tag,
              total,
              inserted: resp.inserted_count,
              noop: resp.noop_count,
            })
          : tBulk('apply_success_pure_insert', { tag, total });
      setToast({ kind: 'success', message });
    },
    [tBulk]
  );

  // URL-driven drawer state: ?asset=<id> survives refresh + sharing.
  const selectedAssetId = React.useMemo(() => {
    const raw = searchParams.get('asset');
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);
  const selectedAsset = React.useMemo<VaultAsset | null>(
    () => items.find((i) => i.id === selectedAssetId) ?? null,
    [items, selectedAssetId]
  );

  // Generic multi-key URL mutator — replaces one or more params atomically.
  // Pass null to delete a key; any other value sets it.
  const updateSearchParams = React.useCallback(
    (deltas: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(deltas)) {
        if (v === null) params.delete(k);
        else params.set(k, v);
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  // Thin shim — all existing call-sites keep working unchanged.
  const updateAssetParam = React.useCallback(
    (assetId: number | null) => {
      updateSearchParams({ asset: assetId === null ? null : String(assetId) });
    },
    [updateSearchParams]
  );

  const handleSelect = React.useCallback(
    (item: VaultAsset) => updateAssetParam(item.id),
    [updateAssetParam]
  );

  const handleDrawerOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) updateAssetParam(null);
    },
    [updateAssetParam]
  );
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
    // Keep ?tag= in sync with the filter chip so the URL is deep-linkable.
    // Array tags join as comma-separated for single-param serialization;
    // the hook sends them as repeating params to the backend.
    const nextTag = Array.isArray(next.tag) ? next.tag.join(',') || null : (next.tag ?? null);
    updateSearchParams({ tag: nextTag });
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
              <VaultGrid
                items={items}
                onSelect={handleSelect}
                selection={selection}
                onToggleSelect={toggleSelect}
              />
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

      <VaultDrawer
        asset={selectedAsset}
        open={selectedAssetId !== null && selectedAsset !== null}
        onOpenChange={handleDrawerOpenChange}
      />

      {selection.size > 0 && (
        <VaultBulkToolbar
          selection={selection}
          onClear={() => setSelection(new Set())}
          onApply={handleBulkApply}
        />
      )}
    </div>
  );
}

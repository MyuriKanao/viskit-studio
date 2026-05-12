'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { CatalogFilters } from '@/components/catalog/CatalogFilters';
import type { FilterOption } from '@/components/catalog/CatalogFilters';
import { CatalogGrid } from '@/components/catalog/CatalogGrid';
import { CatalogTable } from '@/components/catalog/CatalogTable';
import type { CatalogTableLabels } from '@/components/catalog/CatalogTable';
import { SortMenu } from '@/components/catalog/SortMenu';
import type { SortMenuLabels } from '@/components/catalog/SortMenu';
import { ViewToggle } from '@/components/catalog/ViewToggle';
import type { CatalogView } from '@/components/catalog/ViewToggle';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { Button, buttonVariants } from '@/components/ui/button';
import { useKitsCatalog } from '@/hooks/use-kits-catalog';
import type {
  CatalogFilters as CatalogFilterState,
  CatalogSortKey,
  CatalogSortOrder,
} from '@/hooks/use-kits-catalog';
import type { KitListItem } from '@/hooks/use-recent-kits';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const PAGE_SIZE = 24;

export default function CatalogPage() {
  const t = useTranslations('catalog');
  const locale = useLocale() as 'zh' | 'en';
  const router = useRouter();

  // View mode
  const [view, setView] = React.useState<CatalogView>('grid');

  // Filters
  const [status, setStatus] = React.useState<string | null>(null);
  const [localeFilter, setLocaleFilter] = React.useState<string | null>(null);
  const [minScore, setMinScore] = React.useState<number | null>(null);

  // Sort
  const [sort, setSort] = React.useState<CatalogSortKey>('created_at');
  const [order, setOrder] = React.useState<CatalogSortOrder>('desc');

  // Pagination
  const [page, setPage] = React.useState(0);
  const offset = page * PAGE_SIZE;

  const query: CatalogFilterState & {
    limit: number;
    offset: number;
    sort: CatalogSortKey;
    order: CatalogSortOrder;
  } = {
    status,
    locale: localeFilter,
    minScore,
    category: null,
    limit: PAGE_SIZE,
    offset,
    sort,
    order,
  };

  // Reset page when filters change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate filter-change trigger; setPage is stable
  React.useEffect(() => {
    setPage(0);
  }, [status, localeFilter, minScore, sort, order]);

  const { data, isLoading, isError } = useKitsCatalog(query);
  const kits = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const onRowClick = React.useCallback(
    (kit: KitListItem) => {
      const prefix = locale === 'zh' ? '' : `/${locale}`;
      router.push(`${prefix}/kits/${kit.id}`);
    },
    [locale, router]
  );

  const onKitClick = onRowClick;

  const clearFilters = React.useCallback(() => {
    setStatus(null);
    setLocaleFilter(null);
    setMinScore(null);
  }, []);

  const hasActiveFilters = status !== null || localeFilter !== null || minScore !== null;

  const statusOptions: FilterOption[] = [
    { value: 'ready', label: t('filter_ready') },
    { value: 'generating', label: t('filter_generating') },
    { value: 'needs_review', label: t('filter_needs_review') },
    { value: 'failed', label: t('filter_failed') },
  ];

  const localeOptions: FilterOption[] = [
    { value: 'zh', label: 'zh' },
    { value: 'en', label: 'en' },
  ];

  const tableLabels: CatalogTableLabels = {
    thumb: t('table_thumb'),
    sku: t('table_sku'),
    name: t('table_name'),
    category: t('table_category'),
    status: t('table_status'),
    compliance: t('table_compliance'),
    updated: t('table_updated'),
    empty: t('grid_empty'),
    advisory: t('advisory_badge'),
  };

  const sortLabels: SortMenuLabels = {
    triggerAria: t('sort_trigger_aria'),
    groupKey: t('sort_group_key'),
    groupOrder: t('sort_group_order'),
    optionCreated: t('sort_option_created'),
    optionUpdated: t('sort_option_updated'),
    optionScore: t('sort_option_score'),
    optionAsc: t('sort_option_asc'),
    optionDesc: t('sort_option_desc'),
  };

  const pageStart = offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[64px_1fr] bg-ink-base">
      <div className="row-span-2">
        <Sidebar />
      </div>
      <div className="col-start-2">
        <Topbar />
      </div>
      <main className="col-start-2 row-start-2 flex flex-col gap-s-6 overflow-auto p-s-6">
        {/* Title + CTA */}
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl text-ink-primary">{t('page_title')}</h1>
          <Link
            href="/new-kit"
            aria-label={t('new_kit_cta')}
            data-testid="catalog-new-kit-cta"
            className={buttonVariants({ variant: 'default', size: 'sm' })}
          >
            {t('new_kit_cta')}
          </Link>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-s-3">
          <CatalogFilters
            status={status}
            statusOptions={statusOptions}
            onStatusChange={setStatus}
            locale={localeFilter}
            localeOptions={localeOptions}
            onLocaleChange={setLocaleFilter}
            minScore={minScore}
            onMinScoreChange={setMinScore}
            hasActiveFilters={hasActiveFilters}
            onClear={clearFilters}
            labels={{
              statusLabel: t('filter_status'),
              localeLabel: t('filter_locale'),
              minScoreLabel: t('filter_min_score'),
              allLabel: t('filter_all'),
              clearLabel: t('clear_filters'),
            }}
          />
          <div className="flex items-center gap-s-2">
            <SortMenu
              sort={sort}
              order={order}
              onChange={({ sort: s, order: o }) => {
                setSort(s);
                setOrder(o);
              }}
              labels={sortLabels}
            />
            <ViewToggle
              value={view}
              onChange={setView}
              gridLabel={t('view_grid')}
              tableLabel={t('view_table')}
            />
          </div>
        </div>

        {/* Count + range */}
        {!isLoading && !isError && total > 0 ? (
          <p className="text-xs text-ink-faint" data-testid="catalog-count">
            {t('count_pattern', { start: pageStart, end: pageEnd, total })}
          </p>
        ) : null}

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-s-12" data-testid="catalog-loading">
            <div
              aria-label="Loading"
              className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
          </div>
        ) : isError ? (
          <p className="py-s-12 text-center text-sm text-danger" data-testid="catalog-error">
            {t('load_error')}
          </p>
        ) : view === 'grid' ? (
          <CatalogGrid
            kits={kits}
            locale={locale}
            labels={{ empty: t('grid_empty') }}
            onKitClick={onKitClick}
          />
        ) : (
          <CatalogTable kits={kits} labels={tableLabels} onRowClick={onRowClick} />
        )}

        {/* Pagination */}
        {!isLoading && totalPages > 1 ? (
          <nav
            aria-label={t('pagination_aria')}
            className="flex items-center justify-center gap-s-3"
            data-testid="catalog-pagination"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 0}
              onClick={() => setPage((p) => p - 1)}
            >
              {t('pagination_prev')}
            </Button>
            <span className="text-xs text-ink-muted">
              {t('pagination_page', { page: page + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('pagination_next')}
            </Button>
          </nav>
        ) : null}
      </main>
    </div>
  );
}

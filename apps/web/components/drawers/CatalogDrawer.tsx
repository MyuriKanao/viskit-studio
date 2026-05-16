'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { SharedDrawerShell } from '@/components/drawers/SharedDrawerShell';
import { Button } from '@/components/ui/button';
import { useKitMeta } from '@/hooks/use-kit-meta';
import type { KitListItem } from '@/hooks/use-recent-kits';
import { useSkuKits } from '@/hooks/use-sku-kits';

export interface CatalogDrawerSku {
  sku: string;
  name: string;
  category: string | null;
}

export interface CatalogDrawerProps {
  sku: CatalogDrawerSku | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function KitBestsellerSubsection({ kit }: { kit: KitListItem }) {
  const t = useTranslations('catalog');
  const [expanded, setExpanded] = React.useState(false);
  const meta = useKitMeta(kit.id, expanded);

  const ids = meta.data?.retrieved_bestseller_ids ?? [];
  // Gate on isFetched (not !isLoading) so the empty-state copy doesn't flash
  // before the first fetch completes — `meta.isLoading` is also false while
  // the query is disabled (collapsed details), which would otherwise render
  // empty-state inside an un-mounted-content branch and on the brief frame
  // between expand and fetch-start.
  const isEmpty = meta.isFetched && (meta.data === null || ids.length === 0);

  return (
    <details
      data-testid={`catalog-drawer-kit-bestsellers-${kit.id}`}
      onToggle={(e) => setExpanded((e.currentTarget as HTMLDetailsElement).open)}
      className="mt-s-2 border-t border-border-subtle/40 pt-s-2"
    >
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-ink-faint">
        {t('drawer_bestsellers_title')}
      </summary>
      {meta.isLoading ? (
        <p className="mt-s-1 text-xs text-ink-muted">…</p>
      ) : isEmpty ? (
        <p
          data-testid={`catalog-drawer-kit-bestsellers-empty-${kit.id}`}
          className="mt-s-1 text-xs text-ink-faint"
        >
          {t('drawer_bestsellers_empty')}
        </p>
      ) : (
        <ul
          data-testid={`catalog-drawer-kit-bestsellers-list-${kit.id}`}
          className="mt-s-1 flex flex-wrap gap-s-1"
        >
          {ids.map((id) => (
            <li
              key={`${kit.id}-${id}`}
              className="rounded-input border border-border-subtle bg-surface-02 px-s-2 py-s-1 font-mono text-[10px] text-ink-secondary"
            >
              #{id}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function KitHistoryRow({
  kit,
  onOpen,
}: {
  kit: KitListItem;
  onOpen: (kit: KitListItem) => void;
}) {
  const t = useTranslations('catalog');
  const firstThumb = kit.thumbs.find((p) => p !== null) ?? null;
  return (
    <li
      data-testid={`catalog-drawer-kit-${kit.id}`}
      className="flex flex-col gap-s-2 rounded-card border border-border-subtle bg-surface-02 p-s-3"
    >
      <div className="flex items-start gap-s-3">
        {firstThumb !== null ? (
          <img
            src={firstThumb}
            alt={kit.name}
            loading="lazy"
            className="h-16 w-16 flex-shrink-0 rounded-input bg-surface-01 object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="h-16 w-16 flex-shrink-0 rounded-input border border-dashed border-border-subtle bg-surface-01"
          />
        )}
        <div className="flex flex-1 flex-col gap-s-1">
          <div className="flex items-center gap-s-2">
            <span className="rounded-input border border-border-subtle px-s-2 py-[1px] font-mono text-[10px] uppercase tracking-wider text-ink-secondary">
              {kit.status}
            </span>
            {kit.locale ? (
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                {kit.locale}
              </span>
            ) : null}
            <span
              data-testid={`catalog-drawer-kit-score-${kit.id}`}
              className="ml-auto rounded-input bg-surface-01 px-s-2 py-[1px] font-mono text-[10px] text-ink-secondary"
            >
              {t('drawer_kit_score')}: {kit.score ?? '—'}
            </span>
          </div>
          <span className="font-display text-sm text-ink-primary line-clamp-2">{kit.name}</span>
          {kit.updated_at ? (
            <span className="font-mono text-[10px] text-ink-faint">{kit.updated_at}</span>
          ) : null}
          <div className="mt-s-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpen(kit)}
              data-testid={`catalog-drawer-kit-open-${kit.id}`}
            >
              {t('drawer_open_kit_cta')}
            </Button>
          </div>
        </div>
      </div>
      <KitBestsellerSubsection kit={kit} />
    </li>
  );
}

export function CatalogDrawer({ sku, open, onOpenChange }: CatalogDrawerProps) {
  const t = useTranslations('catalog');
  const locale = useLocale() as 'zh' | 'en';
  const router = useRouter();

  const query = useSkuKits(sku?.sku ?? null);

  const handleOpenKit = React.useCallback(
    (kit: KitListItem) => {
      const prefix = locale === 'zh' ? '' : `/${locale}`;
      router.push(`${prefix}/kits/${kit.id}`);
    },
    [locale, router]
  );

  return (
    <SharedDrawerShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('drawer_title')}
      testId="catalog-drawer"
      ariaLabel={t('drawer_title')}
    >
      {sku === null ? null : (
        <div className="flex flex-col gap-s-4">
          <section
            data-testid="catalog-drawer-meta"
            className="flex flex-col gap-s-1 rounded-card border border-border-subtle bg-surface-02 p-s-3"
          >
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              {sku.sku}
            </span>
            <span className="font-display text-base text-ink-primary">{sku.name}</span>
            {sku.category ? <span className="text-xs text-ink-muted">{sku.category}</span> : null}
          </section>

          <section
            aria-label={t('drawer_kits_title')}
            data-testid="catalog-drawer-kits"
            className="flex flex-col gap-s-2"
          >
            <h3 className="font-display text-sm text-ink-primary">{t('drawer_kits_title')}</h3>
            {query.isLoading ? (
              <output className="text-xs text-ink-muted">…</output>
            ) : query.isError ? (
              <p role="alert" className="text-xs text-danger">
                {t('load_error')}
              </p>
            ) : (query.data?.items.length ?? 0) === 0 ? (
              <p data-testid="catalog-drawer-no-kits" className="text-xs text-ink-faint">
                {t('drawer_no_kits')}
              </p>
            ) : (
              <ul className="flex flex-col gap-s-2">
                {(query.data?.items ?? []).map((kit) => (
                  <KitHistoryRow key={kit.id} kit={kit} onOpen={handleOpenKit} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </SharedDrawerShell>
  );
}

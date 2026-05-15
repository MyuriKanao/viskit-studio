'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { SharedDrawerShell } from '@/components/drawers/SharedDrawerShell';
import { SimilarityHistogram } from '@/components/drawers/SimilarityHistogram';
import { TopNNeighbors } from '@/components/drawers/TopNNeighbors';
import { Button } from '@/components/ui/button';
import { useVaultAssetNeighbors } from '@/hooks/use-vault-asset-neighbors';
import type { VaultAsset } from '@/hooks/use-vault-assets';

export interface VaultDrawerProps {
  asset: VaultAsset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-s-3 border-b border-border-subtle/40 py-s-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</span>
      <span className="text-sm text-ink-primary">{value}</span>
    </div>
  );
}

export function VaultDrawer({ asset, open, onOpenChange }: VaultDrawerProps) {
  const t = useTranslations('vault');
  const locale = useLocale() as 'zh' | 'en';
  const router = useRouter();

  const query = useVaultAssetNeighbors(asset?.id ?? null, 9);

  const handleUseAsReference = React.useCallback(() => {
    if (asset === null) return;
    const prefix = locale === 'zh' ? '' : `/${locale}`;
    router.push(`${prefix}/new-kit?ref=${asset.id}`);
  }, [asset, locale, router]);

  return (
    <SharedDrawerShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('drawer_title')}
      testId="vault-drawer"
      ariaLabel={t('drawer_title')}
    >
      {asset === null ? null : (
        <div className="flex flex-col gap-s-4">
          <img
            src={asset.image_url}
            alt={asset.description}
            className="w-full rounded-card border border-border-subtle bg-surface-02 object-cover"
            data-testid="vault-drawer-hero"
          />

          <section
            aria-label={`${t('drawer_title')} · ${asset.id}`}
            className="flex flex-col"
            data-testid="vault-drawer-meta"
          >
            <MetaRow label={t('drawer_meta_id')} value={asset.id} />
            <MetaRow label={t('drawer_meta_category')} value={asset.category} />
            <MetaRow label={t('drawer_meta_season')} value={asset.season} />
            <MetaRow label={t('drawer_meta_locale')} value={asset.locale} />
            <MetaRow label={t('drawer_meta_color')} value={asset.color} />
            <MetaRow label={t('drawer_meta_style')} value={asset.style} />
            <MetaRow
              label={t('drawer_meta_sales')}
              value={t('sales_pattern', { count: asset.sales_count })}
            />
            <MetaRow label={t('drawer_meta_price')} value={`¥${asset.price.toFixed(2)}`} />
            <MetaRow
              label={t('drawer_meta_description')}
              value={<span className="text-right">{asset.description}</span>}
            />
          </section>

          {query.isLoading ? (
            <output data-testid="vault-drawer-loading" className="text-xs text-ink-muted">
              {t('drawer_loading')}
            </output>
          ) : query.isError ? (
            <p data-testid="vault-drawer-error" role="alert" className="text-xs text-danger">
              {t('drawer_error')}
            </p>
          ) : query.data ? (
            <>
              <SimilarityHistogram
                bins={query.data.histogram.bins}
                edges={query.data.histogram.edges}
                sampled={query.data.sampled}
                sampleSize={query.data.sample_size}
                totalCorpus={query.data.total_corpus}
              />
              <TopNNeighbors neighbors={query.data.neighbors} />
            </>
          ) : null}

          <footer className="mt-auto sticky bottom-0 border-t border-border-subtle bg-surface-01 pt-s-3">
            <Button
              type="button"
              variant="default"
              size="sm"
              className="w-full"
              onClick={handleUseAsReference}
              data-testid="vault-drawer-use-as-reference"
            >
              {t('drawer_use_as_ref_cta')}
            </Button>
          </footer>
        </div>
      )}
    </SharedDrawerShell>
  );
}

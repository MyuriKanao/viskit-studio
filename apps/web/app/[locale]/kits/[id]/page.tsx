'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import * as React from 'react';

import { CompliancePanel } from '@/components/kit-detail/compliance-panel';
import { CostDock } from '@/components/kit-detail/cost-dock';
import { ImageGrid, type ImageMeta } from '@/components/kit-detail/image-grid';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { useRecentKits } from '@/hooks/use-recent-kits';

// `SpecMarkdown` pulls in react-markdown + remark-gfm (~40 kB gz). Split it
// out so the kit-detail route's First Load JS stays under the catalog /
// new-kit baseline; the spec column renders progressively after the image
// grid, so the deferred load is invisible to the operator.
const SpecMarkdown = dynamic(
  () => import('@/components/kit-detail/spec-markdown').then((m) => m.SpecMarkdown),
  {
    ssr: false,
    loading: () => (
      <div aria-hidden="true" className="h-32 animate-pulse rounded-card bg-surface-02" />
    ),
  }
);

type Params = { id: string };

/**
 * Kit Detail page — 14-image collage + spec column + compliance + cost dock.
 *
 * Pulls kit metadata from `useRecentKits` (the recent-kits endpoint is the
 * only kit-list surface available pre-EPIC-8).  Falls back to placeholder
 * spec markdown until `GET /api/kits/{id}` lands.
 */
export default function KitDetailPage({ params }: { params: Params }) {
  const t = useTranslations('kitDetail');
  const kits = useRecentKits({ limit: 50 });
  const kitIdNumeric = Number(params.id);
  const kit = kits.data?.items.find((k) => k.id === kitIdNumeric);
  const kitId = String(params.id);

  const images: ImageMeta[] = React.useMemo(() => {
    const thumbs = kit?.thumbs ?? [];
    return [
      ...['H1', 'H2', 'H3', 'H4', 'H5'].map((id, i) => ({
        image_id: id,
        png_path: thumbs[i] ?? null,
      })),
      ...['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'].map((id, i) => ({
        image_id: id,
        png_path: thumbs[5 + i] ?? null,
      })),
    ];
  }, [kit]);

  const fallbackSpec = `# ${kit?.name ?? t('title')}\n\n${kit ? `**SKU**: \`${kit.sku}\`` : ''}\n\n${t('spec_column_title')} — pending backend wiring.`;

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[64px_1fr] bg-ink-base">
      <div className="row-span-2">
        <Sidebar />
      </div>
      <div className="col-start-2">
        <Topbar />
      </div>
      <main className="col-start-2 row-start-2 overflow-auto p-s-6">
        <div className="flex flex-col gap-s-4">
          <header className="flex items-baseline justify-between gap-s-3">
            <h1 className="font-display text-2xl text-ink-primary">{kit?.name ?? t('title')}</h1>
            {kit ? <span className="font-mono text-sm text-ink-faint">{kit.sku}</span> : null}
          </header>
          <div className="grid grid-cols-1 gap-s-4 lg:grid-cols-[1fr_360px]">
            {/* Image grid column */}
            <ImageGrid images={images} kitId={kitId} />
            {/* Spec column */}
            <aside aria-label={t('spec_column_title')} className="flex flex-col gap-s-4">
              <section className="rounded-card border border-border-subtle bg-surface-01 p-s-4">
                <SpecMarkdown src={fallbackSpec} />
              </section>
              <CompliancePanel score={kit?.score ?? null} />
              <CostDock kitId={kitId} total={null} byRole={null} />
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

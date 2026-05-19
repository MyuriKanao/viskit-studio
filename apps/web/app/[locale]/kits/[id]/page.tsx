'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import * as React from 'react';

import { CompliancePanel } from '@/components/kit-detail/compliance-panel';
import { CostDock } from '@/components/kit-detail/cost-dock';
import { ImageGrid, type ImageMeta } from '@/components/kit-detail/image-grid';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { useKitMeta } from '@/hooks/use-kit-meta';
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

type CostSummary = {
  total: number | null;
  byRole: Array<{ role: string; usd: number }> | null;
};

function readScore(compliance: Record<string, unknown> | null | undefined): number | null {
  const score = compliance?.score;
  return typeof score === 'number' ? score : null;
}

function readCost(cost: Record<string, unknown> | null | undefined): CostSummary {
  if (!cost) return { total: null, byRole: null };
  const total = typeof cost.total === 'number' ? cost.total : null;
  const rawRows = Array.isArray(cost.byRole)
    ? cost.byRole
    : Array.isArray(cost.by_role)
      ? cost.by_role
      : null;
  const byRoleFromRows =
    rawRows
      ?.map((row) => {
        if (!row || typeof row !== 'object') return null;
        const item = row as Record<string, unknown>;
        const role = typeof item.role === 'string' ? item.role : null;
        const usd = typeof item.usd === 'number' ? item.usd : null;
        return role && usd !== null ? { role, usd } : null;
      })
      .filter((row): row is { role: string; usd: number } => row !== null) ?? null;
  if (byRoleFromRows) return { total, byRole: byRoleFromRows };

  const events = Array.isArray(cost.events) ? cost.events : null;
  if (!events) return { total, byRole: null };
  const byRoleMap = new Map<string, number>();
  let eventTotal = 0;
  for (const row of events) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const role = typeof item.role === 'string' ? item.role : null;
    const usd = typeof item.cost_usd === 'number' ? item.cost_usd : null;
    if (!role || usd === null) continue;
    eventTotal += usd;
    byRoleMap.set(role, (byRoleMap.get(role) ?? 0) + usd);
  }
  const byRole = Array.from(byRoleMap, ([role, usd]) => ({ role, usd }));
  return { total: total ?? eventTotal, byRole };
}

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
  const kitMeta = useKitMeta(Number.isFinite(kitIdNumeric) ? kitIdNumeric : null);
  const kit = kits.data?.items.find((k) => k.id === kitIdNumeric);
  const kitId = String(params.id);
  const publicKitId = kitMeta.data?.kit_id ?? undefined;

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
  const specMarkdown = kitMeta.data?.spec_markdown ?? fallbackSpec;
  const complianceScore = readScore(kitMeta.data?.compliance) ?? kit?.score ?? null;
  const cost = readCost(kitMeta.data?.cost);

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
            <ImageGrid images={images} kitId={publicKitId} />
            {/* Spec column */}
            <aside aria-label={t('spec_column_title')} className="flex flex-col gap-s-4">
              <section className="rounded-card border border-border-subtle bg-surface-01 p-s-4">
                <SpecMarkdown src={specMarkdown} />
              </section>
              <CompliancePanel score={complianceScore} />
              <CostDock kitId={kitId} total={cost.total} byRole={cost.byRole} />
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

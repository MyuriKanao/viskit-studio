'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

/**
 * EPIC-9 SimilarityHistogram — pure-SVG distance distribution.
 *
 * No chart-lib dependency (per ADR-EPIC9-001 + bundle budget). ~20 bins is
 * the typical input from the backend; the component does not bucket itself.
 * Caption is honest: when ``sampled`` is true, it shows "based on N of M".
 */
export interface SimilarityHistogramProps {
  bins: number[];
  edges: number[];
  sampled: boolean;
  sampleSize: number | null;
  totalCorpus: number;
}

const VIEWBOX_WIDTH = 400;
const VIEWBOX_HEIGHT = 120;
const PADDING_X = 4;
const PADDING_Y = 8;

export function SimilarityHistogram({
  bins,
  edges,
  sampled,
  sampleSize,
  totalCorpus,
}: SimilarityHistogramProps) {
  const t = useTranslations('vault');

  if (bins.length === 0) {
    return (
      <div
        data-testid="vault-drawer-histogram-empty"
        className="rounded-card border border-border-subtle bg-surface-02 p-s-3 text-xs text-ink-faint"
      >
        {t('drawer_histogram_empty')}
      </div>
    );
  }

  const maxCount = Math.max(...bins);
  const barWidth = (VIEWBOX_WIDTH - 2 * PADDING_X) / bins.length;
  const usableHeight = VIEWBOX_HEIGHT - 2 * PADDING_Y;

  const caption = sampled
    ? t('drawer_histogram_sampled', {
        sample: sampleSize ?? 0,
        total: totalCorpus,
      })
    : t('drawer_histogram_full', { total: totalCorpus });

  const lowEdge = edges[0]?.toFixed(2) ?? '';
  const highEdge = edges[edges.length - 1]?.toFixed(2) ?? '';

  return (
    <section
      aria-label={t('drawer_histogram_title')}
      data-testid="vault-drawer-histogram"
      data-sampled={sampled ? 'true' : 'false'}
      className="flex flex-col gap-s-2"
    >
      <header className="flex items-baseline justify-between">
        <h3 className="font-display text-sm text-ink-primary">{t('drawer_histogram_title')}</h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
          {caption}
        </span>
      </header>
      <svg
        role="img"
        aria-hidden="true"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="w-full text-accent"
        preserveAspectRatio="none"
      >
        {bins.map((count, idx) => {
          const ratio = maxCount === 0 ? 0 : count / maxCount;
          const barH = ratio * usableHeight;
          const x = PADDING_X + idx * barWidth;
          const y = VIEWBOX_HEIGHT - PADDING_Y - barH;
          return (
            <rect
              key={`bin-${idx.toString()}`}
              x={x + 0.5}
              y={y}
              width={Math.max(barWidth - 1, 1)}
              height={barH}
              fill="currentColor"
              opacity={0.85}
            />
          );
        })}
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-ink-faint">
        <span>{lowEdge}</span>
        <span>{highEdge}</span>
      </div>
    </section>
  );
}

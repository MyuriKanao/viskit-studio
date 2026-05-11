'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ComplianceRing } from '@/components/atoms/compliance-ring';
import { cn } from '@/lib/utils';

export interface CompliancePanelProps {
  score: number | null;
  className?: string;
}

export function CompliancePanel({ score, className }: CompliancePanelProps) {
  const t = useTranslations('kitDetail');
  return (
    <section
      aria-label={t('compliance_label')}
      className={cn(
        'flex items-center gap-s-3 rounded-card border border-border-subtle bg-surface-01 p-s-4',
        className
      )}
    >
      {score === null ? (
        <>
          <span
            aria-label={t('pending_state')}
            className="h-12 w-12 animate-pulse rounded-pill bg-surface-03"
          />
          <div className="flex flex-col gap-s-1">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
              {t('compliance_label')}
            </span>
            <span className="text-sm text-ink-muted">{t('pending_state')}</span>
          </div>
        </>
      ) : (
        <>
          <ComplianceRing score={score} size={48} />
          <div className="flex flex-col gap-s-1">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
              {t('compliance_label')}
            </span>
            <span className="font-display text-2xl text-ink-primary">{score}</span>
          </div>
        </>
      )}
    </section>
  );
}

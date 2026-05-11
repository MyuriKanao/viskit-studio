'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import * as React from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type OnboardingCTAId = 'new-kit' | 'sample-kit' | 'providers';

export interface OnboardingCTAProps {
  id: OnboardingCTAId;
  icon: React.ReactNode;
  labelKey: string;
  href: string;
  disabled?: boolean;
  disabledHint?: string;
  className?: string;
}

const ID_LABEL: Record<OnboardingCTAId, string> = {
  'new-kit': 'A',
  'sample-kit': 'B',
  providers: 'C',
};

/**
 * Onboarding CTA card.  When `disabled`, renders as an `aria-disabled`
 * span-button with a tooltip hint (used for sample-kit fixture missing).
 */
export function OnboardingCTA({
  id,
  icon,
  labelKey,
  href,
  disabled,
  disabledHint,
  className,
}: OnboardingCTAProps) {
  const t = useTranslations('onboarding');
  const label = t(labelKey);
  const baseCls =
    'group flex w-full items-center gap-s-4 rounded-card border border-border-subtle bg-surface-01 p-s-4 text-left transition-all duration-fast';
  const numCls = 'font-display text-3xl text-accent-soft w-8 text-center shrink-0';
  const arrow = (
    <span
      aria-hidden="true"
      className="ml-auto font-mono text-ink-faint group-hover:text-accent-soft"
    >
      →
    </span>
  );
  if (disabled) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-label={`${label} — ${disabledHint ?? 'Unavailable'}`}
              className={cn(baseCls, 'cursor-not-allowed opacity-50', className)}
            >
              <span className={numCls}>{ID_LABEL[id]}</span>
              <span aria-hidden="true" className="text-ink-muted">
                {icon}
              </span>
              <span className="text-sm text-ink-secondary">{label}</span>
              {arrow}
            </button>
          </TooltipTrigger>
          {disabledHint ? <TooltipContent side="top">{disabledHint}</TooltipContent> : null}
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(baseCls, 'hover:border-border-strong hover:bg-surface-02', className)}
    >
      <span className={numCls}>{ID_LABEL[id]}</span>
      <span aria-hidden="true" className="text-accent-soft">
        {icon}
      </span>
      <span className="text-sm text-ink-primary">{label}</span>
      {arrow}
    </Link>
  );
}

'use client';

import { ChartLine, Eye, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';

import { OnboardingCTA } from '@/components/onboarding/onboarding-cta';
import { WorkspaceReadyCard } from '@/components/onboarding/workspace-ready-card';

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const locale = useLocale() as 'zh' | 'en';
  const prefix = locale === 'zh' ? '' : `/${locale}`;
  return (
    <main className="grid min-h-screen grid-cols-1 bg-ink-base lg:grid-cols-[1fr_480px]">
      {/* Left — hero copy + CTAs */}
      <section aria-label={t('page_title')} className="flex flex-col gap-s-6 p-s-7">
        <header className="flex flex-col gap-s-3">
          <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
            {t('page_title')}
          </span>
          <h1 className="font-display text-4xl leading-tight text-ink-primary">
            {t('welcome_copy')}
          </h1>
        </header>
        <WorkspaceReadyCard />
        <ul className="flex flex-col gap-s-3">
          <li>
            <OnboardingCTA
              id="new-kit"
              icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
              labelKey="cta_new_kit_label"
              href={`${prefix}/new-kit`}
            />
          </li>
          <li>
            <OnboardingCTA
              id="sample-kit"
              icon={<Eye className="h-5 w-5" aria-hidden="true" />}
              labelKey="cta_sample_kit_label"
              href={`${prefix}/dashboard`}
            />
          </li>
          <li>
            <OnboardingCTA
              id="providers"
              icon={<ChartLine className="h-5 w-5" aria-hidden="true" />}
              labelKey="cta_providers_label"
              href={`${prefix}/providers`}
            />
          </li>
        </ul>
      </section>
      {/* Right — workspace preview placeholder */}
      <aside
        aria-label="Sample preview"
        className="hidden flex-col gap-s-4 border-l border-border-subtle bg-surface-01 p-s-7 lg:flex"
      >
        <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
          SAMPLE WORKSPACE
        </span>
        <p className="text-sm text-ink-muted">Configure once, generate kits in minutes.</p>
      </aside>
    </main>
  );
}

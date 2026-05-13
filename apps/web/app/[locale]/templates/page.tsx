'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { TemplateCard } from '@/components/templates/template-card';
import { useTemplates } from '@/hooks/use-templates';

/**
 * EPIC-8 Templates — read-only curated template grid.
 *
 * Mirrors queue/page.tsx shell layout exactly: Sidebar + Topbar grid,
 * 4-state branching (error / loading / empty / list). No pagination,
 * no filtering, no CTA (EPIC-10 will wire prefill). Grid is 2-cols on
 * mobile, 4-cols on md+.
 */
export default function TemplatesPage() {
  const t = useTranslations('templates');
  const query = useTemplates();
  const templates = query.data?.templates ?? [];
  const count = templates.length;

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
              data-testid="templates-summary"
              className="font-mono text-xs uppercase tracking-wider text-ink-faint"
            >
              {t('summary_pattern', { count })}
            </span>
          </header>

          <section
            aria-label={t('page_title')}
            className="rounded-card border border-border-subtle bg-surface-01 p-s-4"
          >
            {query.isError ? (
              <p data-testid="templates-error" className="text-sm text-danger">
                {t('load_error')}
              </p>
            ) : query.isLoading && !query.data ? (
              <p data-testid="templates-loading" className="text-sm text-ink-muted">
                {t('loading')}
              </p>
            ) : count === 0 ? (
              <div
                data-testid="templates-empty"
                className="flex flex-col items-center gap-s-2 py-s-6 text-center"
              >
                <span className="font-display text-lg text-ink-primary">{t('empty_title')}</span>
                <span className="text-sm text-ink-muted">{t('empty_hint')}</span>
              </div>
            ) : (
              <div data-testid="templates-list" className="grid grid-cols-2 md:grid-cols-4 gap-s-4">
                {templates.map((template) => (
                  <TemplateCard key={template.id} template={template} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

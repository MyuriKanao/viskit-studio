'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';

/**
 * Bare `/[locale]/editor` lands here when the sidebar nav is clicked without
 * a specific image_id. The real editor lives at `/[locale]/editor/[image_id]`;
 * this page is a placeholder telling the operator to pick an image from a kit.
 */
export default function EditorIndexPage() {
  const t = useTranslations('editor');
  const locale = useLocale() as 'zh' | 'en';
  const dashboardHref = locale === 'zh' ? '/dashboard' : `/${locale}/dashboard`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-01 p-s-7 text-ink-primary">
      <div className="max-w-md space-y-s-4 text-center">
        <h1 className="font-display text-3xl text-ink-primary">{t('title')}</h1>
        <p className="text-sm text-ink-muted">
          {locale === 'en'
            ? 'Open the editor by selecting an image from a kit on the Dashboard.'
            : '请从仪表盘的套包中选择一张图片以打开编辑器。'}
        </p>
        <Link
          href={dashboardHref}
          className="inline-flex items-center rounded-pill border border-border-subtle bg-surface-02 px-s-4 py-s-2 text-sm text-ink-secondary transition-colors hover:bg-surface-03 hover:text-ink-primary"
        >
          {locale === 'en' ? 'Back to Dashboard' : '返回仪表盘'}
        </Link>
      </div>
    </main>
  );
}

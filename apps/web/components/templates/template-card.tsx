'use client';

import { useTranslations } from 'next-intl';

import type { Template } from '@/hooks/use-templates';

const MAX_VISIBLE_TAGS = 4;

interface TemplateCardProps {
  template: Template;
}

const CATEGORY_KEY_MAP = {
  hero: 'category_hero',
  detail_m3: 'category_detail_m3',
  lifestyle: 'category_lifestyle',
  short_video: 'category_short_video',
  amazon_hero: 'category_amazon_hero',
} as const;

const LOCALE_KEY_MAP = {
  zh: 'locale_zh',
  en: 'locale_en',
} as const;

export function TemplateCard({ template }: TemplateCardProps) {
  const t = useTranslations('templates');

  const visibleTags = template.tags.slice(0, MAX_VISIBLE_TAGS);
  const overflowCount = template.tags.length - MAX_VISIBLE_TAGS;

  return (
    <article
      data-testid={`template-card-${template.id}`}
      aria-label={template.name}
      className="flex flex-col gap-s-2 rounded-card border border-border-subtle bg-surface-01 overflow-hidden"
    >
      {/* Thumbnail block */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-t-card bg-surface-02">
        {template.thumbnail_url ? (
          <img
            src={template.thumbnail_url}
            alt={template.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            role="img"
            aria-label={t('thumbnail_placeholder')}
            className="flex h-full w-full items-center justify-center bg-surface-02 text-ink-faint text-xs"
          >
            {t('thumbnail_placeholder')}
          </div>
        )}
        {/* Locale badge — top-right corner */}
        <span
          aria-label={t(LOCALE_KEY_MAP[template.locale])}
          className="absolute right-s-2 top-s-2 rounded-full bg-surface-01 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-muted border border-border-subtle"
        >
          {template.locale === 'zh' ? 'ZH' : 'EN'}
        </span>
      </div>

      {/* Card body */}
      <div className="flex flex-col gap-s-1 p-s-3">
        {/* Name */}
        <span className="font-display text-base text-ink-primary">{template.name}</span>

        {/* Category label */}
        <span className="text-xs uppercase tracking-wider text-ink-faint">
          {t(CATEGORY_KEY_MAP[template.category])}
        </span>

        {/* Description */}
        {template.description ? (
          <p className="text-sm text-ink-muted line-clamp-2">{template.description}</p>
        ) : null}

        {/* Tag chips */}
        {template.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-s-1">
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border-subtle bg-surface-02 px-2 py-0.5 text-[10px] uppercase text-ink-muted"
              >
                {tag}
              </span>
            ))}
            {overflowCount > 0 ? (
              <span className="rounded-full border border-border-subtle bg-surface-02 px-2 py-0.5 text-[10px] uppercase text-ink-muted">
                {t('tags_more_pattern', { count: overflowCount })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

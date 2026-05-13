import * as React from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { TemplateCard } from '@/components/templates/template-card';
import type { Template } from '@/hooks/use-templates';

afterEach(() => {
  cleanup();
});

const MESSAGES = {
  templates: {
    page_title: 'Templates',
    summary_pattern: '{count} templates',
    loading: 'Loading…',
    load_error: 'Failed to load templates',
    empty_title: 'No templates yet',
    empty_hint: 'Templates will appear here in a future release.',
    category_hero: 'Hero',
    category_detail_m3: 'Detail M3',
    category_lifestyle: 'Lifestyle',
    category_short_video: 'Short video',
    category_amazon_hero: 'Amazon hero',
    locale_zh: 'ZH',
    locale_en: 'EN',
    thumbnail_placeholder: 'No preview',
    tags_more_pattern: '+{count} more',
  },
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {ui}
    </NextIntlClientProvider>
  );
}

const BASE_TEMPLATE: Template = {
  id: 'tpl-hero-001',
  name: 'Summer Hero',
  name_en: 'Summer Hero',
  category: 'hero',
  tags: ['taobao', 'summer'],
  locale: 'zh',
  description: 'A vibrant hero image for summer campaigns.',
  thumbnail_url: 'https://example.com/thumb.jpg',
};

describe('TemplateCard', () => {
  it('renders name, category label, and locale badge', () => {
    renderWithIntl(<TemplateCard template={BASE_TEMPLATE} />);

    expect(screen.getByText('Summer Hero')).toBeDefined();
    expect(screen.getByText('Hero')).toBeDefined();
    // locale badge text
    expect(screen.getByText('ZH')).toBeDefined();
  });

  it('renders placeholder role=img with translated alt when thumbnail_url is null', () => {
    const template: Template = { ...BASE_TEMPLATE, thumbnail_url: null };
    renderWithIntl(<TemplateCard template={template} />);

    const placeholder = screen.getByRole('img', { name: 'No preview' });
    expect(placeholder).toBeDefined();
  });

  it('renders 4 visible tag chips and a "+2 more" pill when tags.length > 4', () => {
    const template: Template = {
      ...BASE_TEMPLATE,
      tags: ['taobao', 'tmall', 'amazon', 'douyin', 'short-video', 'lifestyle'],
    };
    renderWithIntl(<TemplateCard template={template} />);

    // First 4 tags visible
    expect(screen.getByText('taobao')).toBeDefined();
    expect(screen.getByText('tmall')).toBeDefined();
    expect(screen.getByText('amazon')).toBeDefined();
    expect(screen.getByText('douyin')).toBeDefined();
    // 5th and 6th should not appear directly
    // overflow pill: 6 - 4 = 2 → "+2 more"
    expect(screen.getByText('+2 more')).toBeDefined();
  });

  it('applies line-clamp-2 class to description paragraph', () => {
    renderWithIntl(<TemplateCard template={BASE_TEMPLATE} />);

    const desc = screen.getByText('A vibrant hero image for summer campaigns.');
    expect(desc.className).toContain('line-clamp-2');
  });

  it('omits the description <p> entirely when description is null', () => {
    const template: Template = { ...BASE_TEMPLATE, description: null };
    const { container } = renderWithIntl(<TemplateCard template={template} />);

    // Card body has no <p> at all when description is null — line-clamp-2 is
    // applied to the description paragraph; its absence is the assertion.
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(0);
    // Sanity: name and category still render.
    expect(screen.getByText('Summer Hero')).toBeDefined();
    expect(screen.getByText('Hero')).toBeDefined();
  });
});

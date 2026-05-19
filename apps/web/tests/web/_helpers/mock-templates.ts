import type { Page } from '@playwright/test';

/**
 * Deterministic /api/templates fixture — backend returns the bare list
 * (response_model=list[TemplateSummary]), per apps/api/routes/templates.py.
 *
 * Mix of categories and locales; at least one entry has >4 tags to exercise
 * the overflow pill path in <TemplateCard />.
 */
export const TEMPLATES_FIXTURE = [
  {
    id: 'tpl-hero-001',
    name: '夏季防晒主图',
    name_en: 'Summer SPF Hero',
    category: 'hero',
    tags: ['taobao', 'tmall', 'summer', 'spf', 'beauty', 'skincare'],
    locale: 'zh',
    description: '适用于淘宝/天猫夏季防晒品类的标准主图模板。',
    thumbnail_url: null,
  },
  {
    id: 'tpl-lifestyle-002',
    name: '生活场景图',
    name_en: 'Lifestyle Scene',
    category: 'lifestyle',
    tags: ['lifestyle', 'amazon'],
    locale: 'en',
    description: 'Warm-toned lifestyle background for Amazon listings.',
    thumbnail_url: null,
  },
  {
    id: 'tpl-short-video-003',
    name: '短视频封面',
    name_en: null,
    category: 'short_video',
    tags: ['douyin', 'short-video', 'tmall'],
    locale: 'zh',
    description: null,
    thumbnail_url: null,
  },
];

export async function mockTemplatesList(
  page: Page,
  payload: unknown = TEMPLATES_FIXTURE
): Promise<void> {
  const body = JSON.stringify(payload);
  await page.route('**/api/templates', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

export async function mockTemplatesError(page: Page, status = 500): Promise<void> {
  await page.route('**/api/templates', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'TEMPLATES_LOAD_INVALID' }),
    });
  });
}

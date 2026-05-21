'use client';

import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';

import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { type Template, useTemplates } from '@/hooks/use-templates';

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

const primaryButtonClass =
  'inline-flex min-h-9 items-center justify-center rounded-input bg-accent px-s-3 py-s-2 font-medium text-ink-base-l text-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
  'inline-flex min-h-9 items-center justify-center rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-2 font-medium text-ink-primary text-sm transition hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50';
const dangerButtonClass =
  'inline-flex min-h-9 items-center justify-center rounded-input border border-danger/40 bg-danger/5 px-s-3 py-s-2 font-medium text-danger text-sm transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50';
const inputClass =
  'rounded-input border border-border-subtle bg-surface-02 px-s-2 py-s-2 text-sm text-ink-primary outline-none transition placeholder:text-ink-faint focus:border-accent/60';
const previewPanelClass =
  'overflow-hidden rounded-card border border-border-subtle bg-ink-base/70 p-s-3';
const previewScrollClass =
  'overflow-auto pr-s-2 [scrollbar-color:var(--border-subtle)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-subtle [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5';

const fieldLabels: Record<string, string> = {
  composition: '画面结构',
  lighting: '光线',
  background: '背景',
  camera: '镜头',
  style: '风格',
  constraints: '约束',
};

const fieldKeysByLabel = Object.fromEntries(
  Object.entries(fieldLabels).map(([key, label]) => [label, key])
);

function sourceLabel(template: Template) {
  return template.source === 'custom' ? '自定义' : '内置只读';
}

function sourceChipClass(template: Template) {
  return template.source === 'custom'
    ? 'border-accent/40 bg-accent/10 text-accent'
    : 'border-border-subtle bg-surface-01 text-ink-muted';
}

function categoryLabel(category: Template['category']) {
  const labels: Record<Template['category'], string> = {
    hero: '主图',
    detail_m3: '详情 M3',
    lifestyle: '场景图',
    short_video: '短视频',
    amazon_hero: 'AMAZON 主图',
  };
  return labels[category] ?? category;
}

function templatePromptText(template: Template | null) {
  if (!template?.prompt_template) {
    return '';
  }
  return Object.entries(template.prompt_template)
    .map(([key, value]) => `${fieldLabels[key] ?? key}\n${value}`)
    .join('\n\n');
}

function parsePromptText(text: string) {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const fields: Record<string, string> = {};

  for (const block of blocks) {
    const [rawHeader, ...body] = block.split('\n');
    const header = rawHeader.trim();
    const key = fieldKeysByLabel[header] ?? header;
    const value = body.join('\n').trim();
    if (value) {
      fields[key] = value;
    }
  }

  return Object.keys(fields).length > 0 ? fields : { composition: text.trim() };
}

export default function TemplatesPage() {
  const t = useTranslations('templates');
  const locale = useLocale() as 'zh' | 'en';
  const query = useTemplates();
  const templates = query.data?.templates ?? [];
  const count = templates.length;
  const [name, setName] = React.useState('');
  const [promptText, setPromptText] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');
  const [editPrompt, setEditPrompt] = React.useState('');

  const activeTemplate =
    templates.find((template) => template.id === activeId) ?? templates[0] ?? null;

  React.useEffect(() => {
    if (templates.length > 0 && !templates.some((template) => template.id === activeId)) {
      setActiveId(templates[0].id);
    }
  }, [activeId, templates]);

  React.useEffect(() => {
    setEditName(activeTemplate?.name ?? '');
    setEditPrompt(templatePromptText(activeTemplate));
  }, [activeTemplate]);

  async function mutate(url: string, init: RequestInit) {
    setError(null);
    const response = await fetch(url, init);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `${response.status}`);
    }
    await query.refetch();
  }

  async function createCustomTemplate() {
    const trimmedName = name.trim();
    const trimmedPrompt = promptText.trim();
    if (!trimmedName || !trimmedPrompt) {
      setError('请填写模板名称和画面结构');
      return;
    }
    setBusy('create');
    try {
      await mutate(`${baseUrl}/api/templates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locale,
          name: trimmedName,
          description: '用户自定义模板',
          category: 'lifestyle',
          tags: ['custom'],
          prompt_template: {
            composition: trimmedPrompt,
          },
          defaults: {},
          examples: [],
          enabled: true,
        }),
      });
      setName('');
      setPromptText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function copyTemplate(sourceRef: string) {
    setBusy(sourceRef);
    try {
      await mutate(`${baseUrl}/api/templates/copy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source_ref: sourceRef }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveTemplate(template: Template) {
    const trimmedName = editName.trim();
    const trimmedPrompt = editPrompt.trim();
    if (!trimmedName || !trimmedPrompt) {
      setError('请填写模板名称和模板内容');
      return;
    }
    setBusy(template.id);
    try {
      await mutate(`${baseUrl}/api/templates/${encodeURIComponent(template.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          prompt_template: parsePromptText(trimmedPrompt),
        }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteTemplate(templateRef: string) {
    setBusy(templateRef);
    try {
      await mutate(`${baseUrl}/api/templates/${encodeURIComponent(templateRef)}`, {
        method: 'DELETE',
      });
      if (activeId === templateRef) {
        setActiveId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

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

          <section className="rounded-card border border-border-subtle bg-surface-01 p-s-4">
            <div className="grid gap-s-3 md:grid-cols-[240px_1fr]">
              <label className="flex flex-col gap-s-1 text-xs">
                <span className="font-mono uppercase tracking-wider text-ink-faint">模板名称</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  placeholder="自定义模板"
                />
              </label>
              <label className="flex flex-col gap-s-1 text-xs">
                <span className="font-mono uppercase tracking-wider text-ink-faint">模板内容</span>
                <input
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  className={inputClass}
                  placeholder="例如：产品居中，大面积留白，柔和自然光"
                />
              </label>
            </div>
            <div className="mt-s-3 flex items-center gap-s-3">
              <button
                type="button"
                disabled={busy === 'create'}
                onClick={createCustomTemplate}
                className={primaryButtonClass}
              >
                {busy === 'create' ? '创建中…' : '创建自定义模板'}
              </button>
              <span className="text-xs text-ink-muted">内置模板只读，可复制后编辑。</span>
              {error ? <span className="text-xs text-danger">{error}</span> : null}
            </div>
          </section>

          <section
            aria-label={t('page_title')}
            className="grid gap-s-4 rounded-card border border-border-subtle bg-surface-01 p-s-4 xl:grid-cols-[minmax(420px,0.9fr)_minmax(420px,1.1fr)]"
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
                className="flex flex-col items-center gap-s-2 py-s-6 text-center xl:col-span-2"
              >
                <span className="font-display text-lg text-ink-primary">{t('empty_title')}</span>
                <span className="text-sm text-ink-muted">{t('empty_hint')}</span>
              </div>
            ) : (
              <>
                <div className="overflow-hidden rounded-card border border-border-subtle bg-surface-01">
                  <div className="grid grid-cols-[minmax(0,1fr)_104px_72px] gap-s-3 border-border-subtle border-b bg-surface-02 px-s-3 py-s-2 font-mono text-[11px] text-ink-faint uppercase tracking-wider">
                    <span>模板</span>
                    <span>类型</span>
                    <span>语言</span>
                  </div>
                  <div
                    data-testid="templates-list"
                    className="max-h-[62vh] overflow-auto [scrollbar-color:var(--border-subtle)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-subtle [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5"
                  >
                    {templates.map((template) => {
                      const active = activeTemplate?.id === template.id;
                      return (
                        <button
                          key={template.id}
                          type="button"
                          data-testid={`template-row-${template.id}`}
                          onClick={() => setActiveId(template.id)}
                          className={`grid w-full grid-cols-[minmax(0,1fr)_104px_72px] items-center gap-s-3 border-border-subtle border-b px-s-3 py-s-3 text-left transition last:border-b-0 hover:bg-surface-02 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${
                            active ? 'bg-surface-02 shadow-[inset_3px_0_0_var(--accent)]' : ''
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-s-2">
                              <span className="truncate font-medium text-sm text-ink-primary">
                                {template.name}
                              </span>
                              <span
                                className={`shrink-0 rounded-full border px-s-2 py-0.5 text-[11px] ${sourceChipClass(
                                  template
                                )}`}
                              >
                                {sourceLabel(template)}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-ink-muted">
                              {template.description || '点击查看模板内容'}
                            </span>
                          </span>
                          <span className="text-xs text-ink-muted">
                            {categoryLabel(template.category)}
                          </span>
                          <span className="font-mono text-xs text-ink-faint uppercase">
                            {template.locale}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <aside className="rounded-card border border-border-subtle bg-surface-02 p-s-4">
                  {activeTemplate ? (
                    <div className="flex h-full min-h-[360px] flex-col gap-s-4">
                      <div className="flex items-start justify-between gap-s-4 border-border-subtle border-b pb-s-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-s-2">
                            <span
                              className={`rounded-full border px-s-2 py-0.5 text-[11px] ${sourceChipClass(
                                activeTemplate
                              )}`}
                            >
                              {sourceLabel(activeTemplate)}
                            </span>
                            <span className="rounded-full border border-border-subtle px-s-2 py-0.5 text-[11px] text-ink-muted">
                              {categoryLabel(activeTemplate.category)}
                            </span>
                          </div>
                          <h2 className="mt-s-2 truncate font-display text-xl text-ink-primary">
                            {activeTemplate.name}
                          </h2>
                          {activeTemplate.description ? (
                            <p className="mt-s-1 text-sm text-ink-muted">
                              {activeTemplate.description}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {activeTemplate.source === 'custom' ? (
                        <div className="flex flex-1 flex-col gap-s-3">
                          <label className="flex flex-col gap-s-1 text-xs">
                            <span className="font-mono uppercase tracking-wider text-ink-faint">
                              模板名称
                            </span>
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className={inputClass}
                            />
                          </label>
                          <label className="flex flex-1 flex-col gap-s-1 text-xs">
                            <span className="font-mono uppercase tracking-wider text-ink-faint">
                              模板内容预览 / 编辑
                            </span>
                            <textarea
                              value={editPrompt}
                              onChange={(e) => setEditPrompt(e.target.value)}
                              className="min-h-[260px] flex-1 resize-y rounded-input border border-border-subtle bg-ink-base/70 px-s-3 py-s-2 font-mono text-ink-primary text-xs leading-6 outline-none transition focus:border-accent/60"
                            />
                          </label>
                          <div className="flex items-center justify-between border-border-subtle border-t pt-s-3">
                            <span className="text-ink-muted text-xs">
                              自定义模板会影响后续生成，历史套包不变。
                            </span>
                            <div className="flex items-center gap-s-2">
                              <button
                                type="button"
                                disabled={busy === activeTemplate.id}
                                onClick={() => deleteTemplate(activeTemplate.id)}
                                className={dangerButtonClass}
                              >
                                删除
                              </button>
                              <button
                                type="button"
                                disabled={busy === activeTemplate.id}
                                onClick={() => saveTemplate(activeTemplate)}
                                className={primaryButtonClass}
                              >
                                {busy === activeTemplate.id ? '保存中…' : '保存模板'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-1 flex-col gap-s-3">
                          <div className={previewPanelClass}>
                            <p className="mb-s-2 font-mono text-[11px] text-ink-faint uppercase tracking-wider">
                              模板内容预览
                            </p>
                            <pre
                              className={`max-h-[360px] whitespace-pre-wrap break-words font-mono text-ink-primary text-xs leading-6 ${previewScrollClass}`}
                            >
                              {templatePromptText(activeTemplate) || '暂无模板内容'}
                            </pre>
                          </div>
                          {activeTemplate.examples?.length ? (
                            <div className={previewPanelClass}>
                              <p className="mb-s-2 font-mono text-[11px] text-ink-faint uppercase tracking-wider">
                                示例
                              </p>
                              <ul
                                className={`max-h-[160px] list-disc space-y-s-1 pl-s-4 text-ink-muted text-xs ${previewScrollClass}`}
                              >
                                {activeTemplate.examples.map((example) => (
                                  <li key={example}>{example}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          <div className="mt-auto flex items-center justify-between border-border-subtle border-t pt-s-3">
                            <span className="text-ink-muted text-xs">
                              内置模板不可直接修改，复制后可完整编辑。
                            </span>
                            <button
                              type="button"
                              disabled={busy === activeTemplate.id}
                              onClick={() => copyTemplate(activeTemplate.id)}
                              className={secondaryButtonClass}
                            >
                              {busy === activeTemplate.id ? '复制中…' : '复制为自定义'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </aside>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

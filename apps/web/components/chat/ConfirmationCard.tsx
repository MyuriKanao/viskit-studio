'use client';

import { useLocale } from 'next-intl';
import * as React from 'react';

import type { SpecResponse } from '@/hooks/use-kit-pipeline';
import { useTemplateSchemes } from '@/hooks/use-templates';
import { LOW_CONF_THRESHOLD } from '@/lib/chat/constants';
import {
  applyGenerationBriefDraft,
  buildGenerationBriefDraft,
  generationBriefCacheKey,
} from '@/lib/chat/generation-brief';
import type { GenerationBriefDraft, GenerationBriefOutputDraft } from '@/lib/chat/generation-brief';
import { useChatStore } from '@/lib/chat/store';
import {
  type ConfirmationMode,
  type FieldInference,
  type InferredSpec,
  normalizeInferredSpec,
} from '@/lib/chat/types';
import type {
  GenerationPlan,
  GenerationPlanItem,
  OutputDestinationType,
} from '@/lib/generation/types';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface ConfirmationCardProps {
  inferred: InferredSpec;
  outputPlan: GenerationPlan;
  onStart: (spec: InferredSpec, plan: GenerationPlan, rewrittenSpec?: SpecResponse) => void;
  onRewriteBrief?: (spec: InferredSpec, plan: GenerationPlan) => Promise<SpecResponse>;
  onModeChange: (mode: ConfirmationMode) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FIELD_INPUT_CLS =
  'rounded-input border border-border-subtle bg-surface-02 px-s-2 py-s-1 text-sm text-ink-primary w-full focus:outline-none focus:ring-1 focus:ring-accent';
const TEXTAREA_INPUT_CLS =
  'min-h-20 rounded-input border border-border-subtle bg-surface-02 px-s-2 py-s-1 text-sm text-ink-primary w-full focus:outline-none focus:ring-1 focus:ring-accent';

const PRODUCT_TYPE_OPTIONS = [
  { value: 'blue_hat', label: '蓝帽/保健' },
  { value: 'sports', label: '运动' },
  { value: 'general_food', label: '普通食品' },
  { value: 'other', label: '其他' },
] as const;

const FULL_KIT_SLOTS = [
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'M1',
  'M2',
  'M3',
  'M4',
  'M5',
  'M6',
  'M7',
  'M8',
  'M9',
] as const;

type ManualPlanKind = 'white_bg' | 'model_showcase' | 'ugc_style' | 'banner';

function manualPlanId(kind: ManualPlanKind): string {
  return `manual-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const WORKFLOW_STEPS = [
  {
    id: 'input',
    title: '输入 / 提取',
    desc: '源图与需求已转成商品字段',
  },
  {
    id: 'brief',
    title: 'LLM Brief',
    desc: '编辑结构化生成文本',
  },
  {
    id: 'rewrite',
    title: '二次改写',
    desc: '查看 LLM 输出规格',
  },
  {
    id: 'generate',
    title: '进入生图流',
    desc: '确认后创建生成任务',
  },
] as const;

function normalizeProductType(value: string): string {
  if (PRODUCT_TYPE_OPTIONS.some((option) => option.value === value)) return value;
  if (/(蓝帽|保健|health|supplement)/i.test(value)) return 'blue_hat';
  if (/(运动|健身|sports?|fitness)/i.test(value)) return 'sports';
  if (/(食品|零食|饮品|茶|咖啡|food|snack|drink|beverage)/i.test(value)) {
    return 'general_food';
  }
  return 'other';
}

function ConfidenceBadge({ field }: { field: FieldInference<unknown> }) {
  if (field.confidence >= LOW_CONF_THRESHOLD) return null;
  return (
    <span
      title={field.reasoning}
      className="ml-s-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-black cursor-help"
    >
      ?
    </span>
  );
}

function makeFullKitPlanItem(slotId: string): GenerationPlanItem {
  const isHero = slotId.startsWith('H');
  return {
    id: `full-kit-${slotId}`,
    output_kind: isHero ? 'hero' : 'detail',
    title: `${slotId} · ${isHero ? '主图' : '详情图'}`,
    reason: '完整 14 图兼容模式',
    template_ref: null,
    template_name: null,
    aspect_ratio: isHero ? '1:1' : '3:4',
    destination_type: 'kit_slot',
    slot_id: slotId,
    enabled: true,
  };
}

function makeManualPlanItem(kind: ManualPlanKind, locale: 'zh' | 'en'): GenerationPlanItem {
  const presets: Record<
    ManualPlanKind,
    Pick<
      GenerationPlanItem,
      'output_kind' | 'title' | 'template_ref' | 'template_name' | 'aspect_ratio'
    >
  > = {
    white_bg: {
      output_kind: 'white_bg',
      title: '白底产品主图',
      template_ref: `builtin:${locale}:hero-image`,
      template_name: '白底/纯色底产品主图',
      aspect_ratio: '1:1',
    },
    model_showcase: {
      output_kind: 'custom',
      title: '模特展示图',
      template_ref: `builtin:${locale}:model-showcase`,
      template_name: '模特展示图',
      aspect_ratio: '4:5',
    },
    ugc_style: {
      output_kind: 'custom',
      title: '试穿 / 买家秀',
      template_ref: `builtin:${locale}:ugc-style`,
      template_name: 'UGC风格/买家秀',
      aspect_ratio: '4:5',
    },
    banner: {
      output_kind: 'banner',
      title: '促销海报 / Banner',
      template_ref: `builtin:${locale}:poster-banner`,
      template_name: '促销海报 / Banner',
      aspect_ratio: '16:9',
    },
  };
  const preset = presets[kind];
  return {
    id: manualPlanId(kind),
    ...preset,
    reason: '用户手动添加',
    destination_type: 'asset',
    slot_id: null,
    enabled: true,
  };
}

function sourceLabel(source: GenerationPlan['plan_source']): string {
  if (source === 'explicit') return '用户指定';
  if (source === 'fallback') return '默认计划';
  if (source === 'manual') return '手动编辑';
  return '智能推荐';
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function colorValue(value: unknown): string {
  const text = textValue(value).trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : '#1D9AB2';
}

// ---------------------------------------------------------------------------
// Per-field editable cell
// ---------------------------------------------------------------------------
interface EditableCellProps {
  label: string;
  field: FieldInference<string>;
  fieldName: string;
  onChange: (val: string) => void;
  isColor?: boolean;
  isProductType?: boolean;
}

function EditableCell({
  label,
  field,
  fieldName,
  onChange,
  isColor,
  isProductType,
}: EditableCellProps) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: editable cell keeps control nested across input/select/color variants.
    <label data-testid={`field-${fieldName}`} className="flex flex-col gap-s-1 text-xs">
      <span className="flex items-center font-mono uppercase tracking-wider text-ink-faint">
        {label}
        <ConfidenceBadge field={field} />
      </span>
      {isColor ? (
        <span className="flex items-center gap-s-2">
          <input
            type="color"
            value={colorValue(field.value)}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded-input border border-border-subtle bg-surface-02 p-s-1"
          />
          <span className="font-mono text-sm text-ink-secondary">{textValue(field.value)}</span>
        </span>
      ) : isProductType ? (
        <select
          value={normalizeProductType(textValue(field.value))}
          onChange={(e) => onChange(e.target.value)}
          className={FIELD_INPUT_CLS}
        >
          {PRODUCT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={textValue(field.value)}
          onChange={(e) => onChange(e.target.value)}
          className={FIELD_INPUT_CLS}
        />
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Color swatch (read-only, minimal mode)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ConfirmationCard({
  inferred,
  outputPlan,
  onStart,
  onRewriteBrief,
  onModeChange,
}: ConfirmationCardProps) {
  const locale = useLocale() as 'zh' | 'en';
  const confirmation_mode = useChatStore((s) => s.confirmation_mode);
  const setConfirmationMode = useChatStore((s) => s.setConfirmationMode);
  const setOutputPlan = useChatStore((s) => s.setOutputPlan);
  const activeJobId = useChatStore((s) => s.active_job_id);

  // Local editable copy of spec fields
  const [spec, setSpec] = React.useState<InferredSpec>(() => normalizeInferredSpec(inferred));
  const [plan, setPlan] = React.useState<GenerationPlan>(() => outputPlan);
  const [guardNote, setGuardNote] = React.useState<string | null>(null);
  const schemesQuery = useTemplateSchemes(locale);
  const schemes = schemesQuery.data ?? [];
  const [selectedSchemeRef, setSelectedSchemeRef] = React.useState<string>('builtin:default');
  const [rewriteStatus, setRewriteStatus] = React.useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [rewriteSpecResponse, setRewriteSpecResponse] = React.useState<SpecResponse | null>(null);
  const [rewriteCacheKey, setRewriteCacheKey] = React.useState<string | null>(null);
  const [rewriteError, setRewriteError] = React.useState<string | null>(null);
  const [sellingPointKeys, setSellingPointKeys] = React.useState<string[]>(() =>
    (inferred.selling_points ?? []).map(
      (_, index) => `selling-point-${Date.now().toString(36)}-${index}`
    )
  );

  // Determine effective mode — default to minimal when store is null
  const mode: ConfirmationMode = confirmation_mode ?? 'minimal';

  React.useEffect(() => {
    setPlan(outputPlan);
  }, [outputPlan]);

  React.useEffect(() => {
    const nextSpec = normalizeInferredSpec(inferred);
    setSpec(nextSpec);
    setSellingPointKeys(
      nextSpec.selling_points.map((_, index) => `selling-point-${Date.now().toString(36)}-${index}`)
    );
  }, [inferred]);

  const briefDraft = React.useMemo(() => buildGenerationBriefDraft(spec, plan), [plan, spec]);
  const briefCacheKey = React.useMemo(() => generationBriefCacheKey(briefDraft), [briefDraft]);
  const rewriteIsStale = Boolean(rewriteSpecResponse && rewriteCacheKey !== briefCacheKey);
  const sellingPointRows = React.useMemo(
    () =>
      briefDraft.selling_points.map((point, index) => ({
        key: sellingPointKeys[index] ?? `selling-point-current-${index}`,
        point,
      })),
    [briefDraft.selling_points, sellingPointKeys]
  );

  function handleSetMode(m: ConfirmationMode) {
    setConfirmationMode(m);
    onModeChange(m);
  }

  function updateField(key: keyof InferredSpec, value: string) {
    setGuardNote(null);
    setSpec((prev) => {
      const current = prev[key];
      if (current === null || Array.isArray(current)) return prev;
      return {
        ...prev,
        [key]: { ...(current as FieldInference<unknown>), value, confidence: 1 },
      };
    });
  }

  function commitPlan(nextPlan: GenerationPlan) {
    setGuardNote(null);
    setPlan(nextPlan);
    setOutputPlan(nextPlan);
  }

  function updatePlanItem(
    id: string,
    patch: Partial<
      Pick<
        GenerationPlanItem,
        | 'enabled'
        | 'title'
        | 'template_ref'
        | 'destination_type'
        | 'slot_id'
        | 'output_kind'
        | 'aspect_ratio'
        | 'template_name'
        | 'reason'
      >
    >
  ) {
    commitPlan({
      ...plan,
      plan_source: plan.plan_source === 'recommended' ? 'manual' : plan.plan_source,
      items: plan.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }

  function removePlanItem(id: string) {
    commitPlan({
      ...plan,
      plan_source: 'manual',
      items: plan.items.filter((item) => item.id !== id),
    });
  }

  function addPlanItem(kind: ManualPlanKind) {
    commitPlan({
      ...plan,
      plan_source: 'manual',
      items: [...plan.items, makeManualPlanItem(kind, locale)],
    });
  }

  function addFullKitPlan() {
    const existingIds = new Set(plan.items.map((item) => item.id));
    const fullKitItems = FULL_KIT_SLOTS.map((slot) => makeFullKitPlanItem(slot)).filter(
      (item) => !existingIds.has(item.id)
    );
    commitPlan({
      ...plan,
      plan_source: 'manual',
      items: [...plan.items, ...fullKitItems],
    });
  }

  function commitBriefDraft(nextDraft: GenerationBriefDraft) {
    setGuardNote(null);
    const applied = applyGenerationBriefDraft(nextDraft, spec, plan);
    setSpec(applied.spec);
    commitPlan(applied.plan);
  }

  function updateBriefProduct<Field extends keyof GenerationBriefDraft['product']>(
    field: Field,
    rawValue: string
  ) {
    const value =
      field === 'price'
        ? Number.parseFloat(rawValue) || 0
        : field === 'product_type'
          ? (rawValue as GenerationBriefDraft['product']['product_type'])
          : rawValue;
    commitBriefDraft({
      ...briefDraft,
      product: {
        ...briefDraft.product,
        [field]: value,
      },
    });
  }

  function updateBriefSellingPoint(index: number, value: string) {
    commitBriefDraft({
      ...briefDraft,
      selling_points: briefDraft.selling_points.map((point, pointIndex) =>
        pointIndex === index ? value : point
      ),
    });
  }

  function addBriefSellingPoint() {
    setSellingPointKeys((prev) => [
      ...prev,
      `selling-point-${Date.now().toString(36)}-${prev.length}`,
    ]);
    commitBriefDraft({
      ...briefDraft,
      selling_points: [...briefDraft.selling_points, '新的卖点'],
    });
  }

  function removeBriefSellingPoint(index: number) {
    setSellingPointKeys((prev) => prev.filter((_, pointIndex) => pointIndex !== index));
    commitBriefDraft({
      ...briefDraft,
      selling_points: briefDraft.selling_points.filter((_, pointIndex) => pointIndex !== index),
    });
  }

  function updateBriefOutput(id: string, patch: Partial<GenerationBriefOutputDraft>) {
    commitBriefDraft({
      ...briefDraft,
      outputs: briefDraft.outputs.map((output) =>
        output.id === id ? { ...output, ...patch } : output
      ),
    });
  }

  async function handleRewriteBrief() {
    if (!onRewriteBrief) {
      setGuardNote('当前环境未接入 LLM 改写接口，可直接确认进入生图流。');
      return;
    }
    setRewriteStatus('loading');
    setRewriteError(null);
    try {
      const response = await onRewriteBrief(spec, plan);
      setRewriteSpecResponse(response);
      setRewriteCacheKey(briefCacheKey);
      setRewriteStatus('success');
    } catch (err) {
      setRewriteStatus('error');
      setRewriteError(err instanceof Error ? err.message : String(err));
    }
  }

  // Polish Queue #1 — onStart guard
  function handleStart() {
    const selectedItems = plan.items.filter((item) => item.enabled);
    if (selectedItems.length === 0) {
      setGuardNote('请至少保留一个输出项');
      return;
    }
    onStart(
      {
        ...spec,
        template_scheme_ref: selectedSchemeRef || 'builtin:default',
        template_slot_overrides: spec.template_slot_overrides ?? {},
      },
      {
        ...plan,
        items: selectedItems,
        requires_confirmation: true,
      },
      rewriteSpecResponse && !rewriteIsStale ? rewriteSpecResponse : undefined
    );
  }

  const selectedPlanCount = plan.items.filter((item) => item.enabled).length;
  const planBlocked = selectedPlanCount === 0;
  const isJobActive = Boolean(activeJobId);
  const workflowCurrentStep = isJobActive
    ? 'generate'
    : rewriteSpecResponse && !rewriteIsStale
      ? 'rewrite'
      : 'brief';
  const rewriteCanFeedGeneration = Boolean(rewriteSpecResponse && !rewriteIsStale);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      data-testid="confirmation-card"
      data-testid-mode={`card-mode-${mode}`}
      className="rounded-xl border border-border-subtle bg-surface-01 p-s-4 flex flex-col gap-s-4"
    >
      {/* Hidden testid element for mode */}
      <span data-testid={`card-mode-${mode}`} className="sr-only" />

      <div
        data-testid="workflow-visualization"
        className="rounded-input border border-border-subtle bg-surface-02 p-s-3"
      >
        <div className="mb-s-3 flex items-center justify-between gap-s-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">工作流导向</p>
            <h2 className="mt-1 text-base font-semibold text-ink-primary">
              从结构化 brief 到生图任务
            </h2>
          </div>
          <span className="rounded-full border border-accent/40 px-s-2 py-s-1 text-xs text-accent">
            已选 {selectedPlanCount} 个输出
          </span>
        </div>
        <ol className="m-0 grid list-none gap-s-2 p-0 sm:grid-cols-4" aria-label="套包生成工作流">
          {WORKFLOW_STEPS.map((step, index) => {
            const isCurrent = step.id === workflowCurrentStep;
            const isCompleted =
              step.id === 'input' ||
              (step.id === 'brief' && Boolean(rewriteSpecResponse || isJobActive)) ||
              (step.id === 'rewrite' && rewriteCanFeedGeneration) ||
              (step.id === 'generate' && isJobActive);
            return (
              <li
                key={step.id}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'rounded-input border p-s-2 transition-colors',
                  isCurrent
                    ? 'border-accent bg-accent/10 text-ink-primary'
                    : isCompleted
                      ? 'border-border-subtle bg-surface-01 text-ink-secondary'
                      : 'border-border-subtle bg-surface-01 text-ink-faint'
                )}
              >
                <div className="flex items-center gap-s-2">
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                      isCurrent || isCompleted
                        ? 'border-accent text-accent'
                        : 'border-border-subtle text-ink-faint'
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium">{step.title}</span>
                </div>
                <p className="mt-s-1 text-xs leading-relaxed text-ink-muted">{step.desc}</p>
              </li>
            );
          })}
        </ol>
      </div>

      <div
        data-testid="generation-brief-editor"
        className="rounded-input border border-border-subtle bg-surface-02 p-s-3 text-xs"
      >
        <div className="mb-s-3 flex flex-wrap items-start justify-between gap-s-2">
          <div>
            <h3 className="font-mono uppercase tracking-wider text-ink-faint">
              Combined LLM Brief
            </h3>
            <p className="mt-1 text-ink-muted">
              这里是 LLM 改写和后续生图共用的结构化文本；编辑后会同步商品字段与输出计划。
            </p>
          </div>
          <button
            data-testid="generation-brief-rewrite"
            type="button"
            onClick={() => void handleRewriteBrief()}
            disabled={rewriteStatus === 'loading' || isJobActive}
            className={cn(
              'rounded-input border border-accent px-s-3 py-s-1 text-accent transition-colors hover:bg-accent hover:text-ink-base-l',
              'disabled:pointer-events-none disabled:opacity-50'
            )}
          >
            {rewriteStatus === 'loading' ? 'LLM 改写中…' : 'LLM 改写 brief'}
          </button>
        </div>

        <div className="grid gap-s-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-s-2">
            <div className="grid gap-s-2 sm:grid-cols-2">
              <label className="flex flex-col gap-s-1">
                <span className="font-mono uppercase tracking-wider text-ink-faint">产品名</span>
                <input
                  type="text"
                  value={briefDraft.product.name}
                  onChange={(e) => updateBriefProduct('name', e.target.value)}
                  className={FIELD_INPUT_CLS}
                />
              </label>
              <label className="flex flex-col gap-s-1">
                <span className="font-mono uppercase tracking-wider text-ink-faint">品牌</span>
                <input
                  type="text"
                  value={briefDraft.product.brand}
                  onChange={(e) => updateBriefProduct('brand', e.target.value)}
                  className={FIELD_INPUT_CLS}
                />
              </label>
              <label className="flex flex-col gap-s-1">
                <span className="font-mono uppercase tracking-wider text-ink-faint">品类</span>
                <input
                  type="text"
                  value={briefDraft.product.category}
                  onChange={(e) => updateBriefProduct('category', e.target.value)}
                  className={FIELD_INPUT_CLS}
                />
              </label>
              <label className="flex flex-col gap-s-1">
                <span className="font-mono uppercase tracking-wider text-ink-faint">商品类型</span>
                <select
                  value={briefDraft.product.product_type}
                  onChange={(e) => updateBriefProduct('product_type', e.target.value)}
                  className={FIELD_INPUT_CLS}
                >
                  {PRODUCT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-s-1">
                <span className="font-mono uppercase tracking-wider text-ink-faint">品牌色</span>
                <span className="flex items-center gap-s-2">
                  <input
                    type="color"
                    value={briefDraft.product.brand_color_hex}
                    onChange={(e) => updateBriefProduct('brand_color_hex', e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded-input border border-border-subtle bg-surface-01 p-s-1"
                  />
                  <input
                    type="text"
                    value={briefDraft.product.brand_color_hex}
                    onChange={(e) => updateBriefProduct('brand_color_hex', e.target.value)}
                    className={FIELD_INPUT_CLS}
                  />
                </span>
              </label>
              <label className="flex flex-col gap-s-1">
                <span className="font-mono uppercase tracking-wider text-ink-faint">价格</span>
                <input
                  type="number"
                  value={briefDraft.product.price}
                  onChange={(e) => updateBriefProduct('price', e.target.value)}
                  className={FIELD_INPUT_CLS}
                />
              </label>
            </div>

            <div className="rounded-input border border-border-subtle bg-surface-01 p-s-2">
              <div className="mb-s-2 flex items-center justify-between gap-s-2">
                <span className="font-mono uppercase tracking-wider text-ink-faint">卖点</span>
                <button
                  type="button"
                  onClick={addBriefSellingPoint}
                  className="text-accent underline-offset-4 hover:underline"
                >
                  添加卖点
                </button>
              </div>
              <div className="flex flex-col gap-s-2">
                {briefDraft.selling_points.length === 0 ? (
                  <p className="text-ink-muted">暂无卖点；可添加后交给 LLM 改写。</p>
                ) : (
                  sellingPointRows.map(({ key, point }, index) => (
                    <div key={key} className="flex items-start gap-s-2">
                      <textarea
                        value={point}
                        onChange={(e) => updateBriefSellingPoint(index, e.target.value)}
                        className={TEXTAREA_INPUT_CLS}
                        aria-label={`卖点 ${index + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeBriefSellingPoint(index)}
                        className="pt-s-1 text-ink-faint hover:text-danger"
                        aria-label={`移除卖点 ${index + 1}`}
                      >
                        移除
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-input border border-border-subtle bg-surface-01 p-s-2">
            <div className="mb-s-2 flex items-center justify-between gap-s-2">
              <span className="font-mono uppercase tracking-wider text-ink-faint">输出 brief</span>
              <span className="text-ink-muted">{briefDraft.outputs.length} 项</span>
            </div>
            <div className="max-h-[360px] space-y-s-2 overflow-auto pr-s-1">
              {briefDraft.outputs.length === 0 ? (
                <p className="text-ink-muted">暂无输出项；可在下方输出计划添加。</p>
              ) : (
                briefDraft.outputs.map((output, index) => (
                  <div
                    key={output.id}
                    className={cn(
                      'rounded-input border border-border-subtle bg-surface-02 p-s-2',
                      output.enabled ? 'opacity-100' : 'opacity-55'
                    )}
                  >
                    <label className="mb-s-2 flex items-start gap-s-2">
                      <input
                        type="checkbox"
                        checked={output.enabled}
                        onChange={(e) =>
                          updateBriefOutput(output.id, { enabled: e.target.checked })
                        }
                        className="mt-1"
                      />
                      <span className="min-w-0 text-sm font-medium text-ink-primary">
                        {index + 1}. {output.title || '未命名输出'}
                      </span>
                    </label>
                    <div className="grid gap-s-2">
                      <input
                        type="text"
                        value={output.title}
                        onChange={(e) => updateBriefOutput(output.id, { title: e.target.value })}
                        className={FIELD_INPUT_CLS}
                        aria-label={`输出 ${index + 1} 标题`}
                      />
                      <textarea
                        value={output.reason}
                        onChange={(e) => updateBriefOutput(output.id, { reason: e.target.value })}
                        className={TEXTAREA_INPUT_CLS}
                        aria-label={`输出 ${index + 1} 生成意图`}
                        placeholder="写清这个输出的画面目标、文案方向或模板理由"
                      />
                      <div className="grid gap-s-2 sm:grid-cols-2">
                        <input
                          type="text"
                          value={output.output_kind}
                          onChange={(e) =>
                            updateBriefOutput(output.id, { output_kind: e.target.value })
                          }
                          className={FIELD_INPUT_CLS}
                          aria-label={`输出 ${index + 1} 类型`}
                        />
                        <input
                          type="text"
                          value={output.aspect_ratio}
                          onChange={(e) =>
                            updateBriefOutput(output.id, { aspect_ratio: e.target.value })
                          }
                          className={FIELD_INPUT_CLS}
                          aria-label={`输出 ${index + 1} 比例`}
                          placeholder="1:1 / 16:9 / 3:4"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {rewriteStatus === 'error' && (
          <div className="mt-s-3 rounded-input bg-danger/10 px-s-3 py-s-2 text-xs text-danger">
            LLM 改写失败：{rewriteError ?? '未知错误'}
          </div>
        )}
        {rewriteSpecResponse && (
          <div
            data-testid="generation-brief-preview"
            className="mt-s-3 rounded-input border border-border-subtle bg-surface-01 p-s-3"
          >
            <div className="mb-s-2 flex flex-wrap items-center justify-between gap-s-2">
              <div>
                <p className="font-mono uppercase tracking-wider text-ink-faint">LLM 改写结果</p>
                <p className="mt-1 text-ink-muted">
                  {rewriteIsStale
                    ? 'brief 已再次编辑；重新改写后才会把这版结果带入生图。'
                    : '这版规格会随确认动作进入生图任务。'}
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full px-s-2 py-s-1',
                  rewriteIsStale ? 'bg-amber-400/10 text-amber-600' : 'bg-accent/10 text-accent'
                )}
              >
                {rewriteIsStale ? '已过期' : '可用于生成'}
              </span>
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-input bg-surface-02 p-s-2 text-[11px] leading-relaxed text-ink-secondary">
              {rewriteSpecResponse.spec_markdown}
            </pre>
          </div>
        )}
      </div>

      {guardNote && (
        <div className="rounded-input bg-amber-400/10 px-s-3 py-s-2 text-xs text-amber-600">
          {guardNote}
        </div>
      )}

      {/* ── EXPANDED mode — all fields ── */}
      {mode === 'expanded' && (
        <div className="flex flex-col gap-s-3">
          {spec.name && (
            <EditableCell
              label="产品名"
              field={spec.name}
              fieldName="name"
              onChange={(val) => updateField('name', val)}
            />
          )}
          <EditableCell
            label="品牌"
            field={spec.brand}
            fieldName="brand"
            onChange={(val) => updateField('brand', val)}
          />
          <EditableCell
            label="品类"
            field={spec.category}
            fieldName="category"
            onChange={(val) => updateField('category', val)}
          />
          <EditableCell
            label="风格"
            field={spec.product_type}
            fieldName="product_type"
            onChange={(val) => updateField('product_type', val)}
            isProductType
          />
          <EditableCell
            label="品牌色"
            field={spec.brand_color_hex}
            fieldName="brand_color_hex"
            onChange={(val) => updateField('brand_color_hex', val)}
            isColor
          />
          {spec.price && (
            <label data-testid="field-price" className="flex flex-col gap-s-1 text-xs">
              <span className="font-mono uppercase tracking-wider text-ink-faint">
                价格
                <ConfidenceBadge field={spec.price} />
              </span>
              <input
                type="number"
                value={spec.price.value}
                onChange={(e) =>
                  setSpec((prev) => ({
                    ...prev,
                    price: prev.price
                      ? {
                          ...prev.price,
                          value: Number.parseFloat(e.target.value) || 0,
                          confidence: 1,
                        }
                      : null,
                  }))
                }
                className={FIELD_INPUT_CLS}
              />
            </label>
          )}
          {spec.selling_points.length > 0 && (
            <div data-testid="field-selling_points" className="flex flex-col gap-s-1 text-xs">
              <span className="font-mono uppercase tracking-wider text-ink-faint">卖点</span>
              {spec.selling_points.map((sp, i) => (
                <input
                  key={`${sp.reasoning}-${i}`}
                  type="text"
                  value={sp.value}
                  onChange={(e) =>
                    setSpec((prev) => ({
                      ...prev,
                      selling_points: prev.selling_points.map((s, j) =>
                        j === i ? { ...s, value: e.target.value, confidence: 1 } : s
                      ),
                    }))
                  }
                  className={FIELD_INPUT_CLS}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-input border border-border-subtle bg-surface-02 p-s-3 text-xs">
        <label className="flex flex-col gap-s-1">
          <span className="font-mono uppercase tracking-wider text-ink-faint">模板方案</span>
          <select
            data-testid="template-scheme-select"
            value={selectedSchemeRef}
            onChange={(e) => setSelectedSchemeRef(e.target.value)}
            className={FIELD_INPUT_CLS}
          >
            {schemes.length === 0 ? (
              <option value="builtin:default">默认模板方案</option>
            ) : (
              schemes
                .filter((scheme) => scheme.enabled)
                .map((scheme) => (
                  <option key={scheme.id} value={scheme.id}>
                    {scheme.source === 'built_in' ? '内置 · ' : '自定义 · '}
                    {scheme.name}
                  </option>
                ))
            )}
          </select>
        </label>
        <p className="mt-s-2 text-ink-muted">
          默认方案保持现有生成效果；自定义方案会作为生成约束写入最终提示词。
        </p>
      </div>

      <div
        data-testid="output-plan-card"
        className="rounded-input border border-border-subtle bg-surface-02 p-s-3 text-xs"
      >
        <div className="mb-s-3 flex flex-wrap items-center justify-between gap-s-2">
          <div>
            <h3 className="font-mono uppercase tracking-wider text-ink-faint">输出计划</h3>
            <p className="mt-1 text-ink-muted">
              {sourceLabel(plan.plan_source)} · 已选{' '}
              {plan.items.filter((item) => item.enabled).length}/{plan.items.length} 项 ·
              仅确认后才会开始生成
            </p>
          </div>
          <div className="flex flex-wrap gap-s-2">
            <button
              type="button"
              onClick={() => addPlanItem('white_bg')}
              className="rounded-input border border-border-subtle px-s-2 py-s-1 text-ink-secondary hover:border-accent hover:text-accent"
            >
              + 白底主图
            </button>
            <button
              type="button"
              onClick={() => addPlanItem('model_showcase')}
              className="rounded-input border border-border-subtle px-s-2 py-s-1 text-ink-secondary hover:border-accent hover:text-accent"
            >
              + 模特图
            </button>
            <button
              type="button"
              onClick={() => addPlanItem('ugc_style')}
              className="rounded-input border border-border-subtle px-s-2 py-s-1 text-ink-secondary hover:border-accent hover:text-accent"
            >
              + 试穿/买家秀
            </button>
            <button
              type="button"
              onClick={() => addPlanItem('banner')}
              className="rounded-input border border-border-subtle px-s-2 py-s-1 text-ink-secondary hover:border-accent hover:text-accent"
            >
              + Banner
            </button>
            <button
              data-testid="add-full-kit-plan"
              type="button"
              onClick={addFullKitPlan}
              className="rounded-input border border-border-subtle px-s-2 py-s-1 text-ink-secondary hover:border-accent hover:text-accent"
            >
              添加完整 14 图
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-s-2">
          {plan.items.length === 0 ? (
            <div className="rounded-input border border-dashed border-border-subtle p-s-3 text-ink-muted">
              暂无输出项，请添加白底主图、模特图、买家秀、Banner 或完整 14 图计划。
            </div>
          ) : (
            plan.items.map((item, index) => (
              <div
                key={item.id}
                data-testid={`output-plan-item-${item.id}`}
                className={cn(
                  'grid gap-s-2 rounded-input border border-border-subtle bg-surface-01 p-s-2',
                  item.enabled ? 'opacity-100' : 'opacity-55'
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-s-2">
                  <label className="flex min-w-0 flex-1 items-start gap-s-2">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(e) => updatePlanItem(item.id, { enabled: e.target.checked })}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-ink-primary">
                        {index + 1}. {item.title}
                      </span>
                      <span className="mt-0.5 block text-ink-muted">
                        {item.reason || '已加入输出计划'} · {item.aspect_ratio || '自适应'}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => removePlanItem(item.id)}
                    className="text-ink-faint hover:text-danger"
                  >
                    移除
                  </button>
                </div>

                <div className="grid gap-s-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-s-1">
                    <span className="font-mono uppercase tracking-wider text-ink-faint">
                      输出类型
                    </span>
                    <input
                      type="text"
                      value={item.output_kind}
                      onChange={(e) => updatePlanItem(item.id, { output_kind: e.target.value })}
                      className={FIELD_INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-s-1">
                    <span className="font-mono uppercase tracking-wider text-ink-faint">
                      模板 Ref
                    </span>
                    <input
                      type="text"
                      value={item.template_ref ?? ''}
                      onChange={(e) =>
                        updatePlanItem(item.id, { template_ref: e.target.value || null })
                      }
                      placeholder={item.template_name ?? '可留空使用推荐模板'}
                      className={FIELD_INPUT_CLS}
                    />
                  </label>
                  <label className="flex flex-col gap-s-1">
                    <span className="font-mono uppercase tracking-wider text-ink-faint">
                      保存目标
                    </span>
                    <select
                      value={item.destination_type}
                      onChange={(e) =>
                        updatePlanItem(item.id, {
                          destination_type: e.target.value as OutputDestinationType,
                          slot_id: e.target.value === 'asset' ? null : item.slot_id,
                        })
                      }
                      className={FIELD_INPUT_CLS}
                    >
                      <option value="asset">独立资产</option>
                      <option value="kit_slot">套包槽位</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-s-1">
                    <span className="font-mono uppercase tracking-wider text-ink-faint">
                      槽位 / 比例
                    </span>
                    <input
                      type="text"
                      value={
                        item.destination_type === 'kit_slot'
                          ? (item.slot_id ?? '')
                          : (item.aspect_ratio ?? '')
                      }
                      onChange={(e) =>
                        item.destination_type === 'kit_slot'
                          ? updatePlanItem(item.id, { slot_id: e.target.value || null })
                          : updatePlanItem(item.id, { aspect_ratio: e.target.value || null })
                      }
                      placeholder={
                        item.destination_type === 'kit_slot' ? 'H1 / M1…' : '1:1 / 16:9…'
                      }
                      className={FIELD_INPUT_CLS}
                    />
                  </label>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Action row ── */}
      <div className="flex items-center gap-s-3 pt-s-2">
        <button
          data-testid="start-button"
          type="button"
          onClick={handleStart}
          disabled={planBlocked || isJobActive}
          className={cn(
            'inline-flex items-center justify-center rounded-input bg-accent px-s-4 py-s-2 text-sm font-medium text-ink-base-l',
            'transition-colors duration-fast hover:bg-accent-soft',
            'disabled:opacity-50 disabled:pointer-events-none'
          )}
        >
          {isJobActive ? '生成任务已启动' : '确认计划并开始生成'}
        </button>

        {mode === 'expanded' ? (
          <button
            type="button"
            onClick={() => handleSetMode('minimal')}
            className="text-sm text-accent underline-offset-4 hover:underline"
          >
            收起
          </button>
        ) : (
          <button
            data-testid="expand-link"
            type="button"
            onClick={() => handleSetMode('expanded')}
            className="text-sm text-accent underline-offset-4 hover:underline"
          >
            展开详情
          </button>
        )}
      </div>
    </div>
  );
}

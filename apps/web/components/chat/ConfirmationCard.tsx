'use client';

import { useLocale } from 'next-intl';
import * as React from 'react';

import { useTemplateSchemes } from '@/hooks/use-templates';
import { LOW_CONF_THRESHOLD } from '@/lib/chat/constants';
import { useChatStore } from '@/lib/chat/store';
import type { ConfirmationMode, FieldInference, InferredSpec } from '@/lib/chat/types';
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
  onStart: (spec: InferredSpec, plan: GenerationPlan) => void;
  onModeChange: (mode: ConfirmationMode) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FIELD_INPUT_CLS =
  'rounded-input border border-border-subtle bg-surface-02 px-s-2 py-s-1 text-sm text-ink-primary w-full focus:outline-none focus:ring-1 focus:ring-accent';

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

function makeManualPlanItem(kind: 'white_bg' | 'banner'): GenerationPlanItem {
  return {
    id: `manual-${kind}-${Date.now().toString(36)}`,
    output_kind: kind,
    title: kind === 'white_bg' ? '白底产品主图' : '促销海报 / Banner',
    reason: '用户手动添加',
    template_ref: null,
    template_name: null,
    aspect_ratio: kind === 'white_bg' ? '1:1' : '16:9',
    destination_type: 'asset',
    slot_id: null,
    enabled: true,
  };
}

function sourceLabel(source: GenerationPlan['plan_source']): string {
  if (source === 'explicit') return '用户指定';
  if (source === 'fallback') return '规则兜底';
  if (source === 'manual') return '手动编辑';
  return '智能推荐';
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
            value={field.value}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded-input border border-border-subtle bg-surface-02 p-s-1"
          />
          <span className="font-mono text-sm text-ink-secondary">{field.value}</span>
        </span>
      ) : isProductType ? (
        <select
          value={normalizeProductType(field.value)}
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
          value={field.value}
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
function ColorSwatch({ hex }: { hex: string }) {
  return (
    <span className="inline-flex items-center gap-s-2">
      <span
        className="inline-block h-5 w-5 rounded-sm border border-border-subtle"
        style={{ backgroundColor: hex }}
      />
      <span className="font-mono text-sm text-ink-secondary">{hex}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ConfirmationCard({
  inferred,
  outputPlan,
  onStart,
  onModeChange,
}: ConfirmationCardProps) {
  const locale = useLocale() as 'zh' | 'en';
  const confirmation_mode = useChatStore((s) => s.confirmation_mode);
  const setConfirmationMode = useChatStore((s) => s.setConfirmationMode);
  const setOutputPlan = useChatStore((s) => s.setOutputPlan);
  const activeJobId = useChatStore((s) => s.active_job_id);

  // Local editable copy of spec fields
  const [spec, setSpec] = React.useState<InferredSpec>(() => inferred);
  const [plan, setPlan] = React.useState<GenerationPlan>(() => outputPlan);
  const [guardNote, setGuardNote] = React.useState<string | null>(null);
  const schemesQuery = useTemplateSchemes(locale);
  const schemes = schemesQuery.data ?? [];
  const [selectedSchemeRef, setSelectedSchemeRef] = React.useState<string>('builtin:default');

  // Determine effective mode — default to minimal when store is null
  const mode: ConfirmationMode = confirmation_mode ?? 'minimal';

  React.useEffect(() => {
    setPlan(outputPlan);
  }, [outputPlan]);

  // Low-confidence fields for "asking" mode
  const lowConfFields = React.useMemo(() => {
    const fields: Array<{ key: keyof InferredSpec; label: string }> = [];
    if (spec.brand.confidence < LOW_CONF_THRESHOLD) fields.push({ key: 'brand', label: '品牌' });
    if (spec.category.confidence < LOW_CONF_THRESHOLD)
      fields.push({ key: 'category', label: '品类' });
    if (spec.product_type.confidence < LOW_CONF_THRESHOLD)
      fields.push({ key: 'product_type', label: '风格' });
    if (spec.brand_color_hex.confidence < LOW_CONF_THRESHOLD)
      fields.push({ key: 'brand_color_hex', label: '品牌色' });
    return fields;
  }, [spec]);

  // Auto-activate asking mode when low-conf fields exist
  React.useEffect(() => {
    if (lowConfFields.length > 0 && mode === 'minimal') {
      setConfirmationMode('asking');
      onModeChange('asking');
    }
  }, [lowConfFields.length, mode, onModeChange, setConfirmationMode]);

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

  function addPlanItem(kind: 'white_bg' | 'banner') {
    commitPlan({
      ...plan,
      plan_source: 'manual',
      items: [...plan.items, makeManualPlanItem(kind)],
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

  // Polish Queue #1 — onStart guard
  function handleStart() {
    if (
      spec.brand.confidence < LOW_CONF_THRESHOLD ||
      spec.category.confidence < LOW_CONF_THRESHOLD
    ) {
      handleSetMode('asking');
      setGuardNote('请先确认品牌或品类');
      return;
    }
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
      }
    );
  }

  // Check if asking mode still has unresolved low-conf fields
  const askingBlocked =
    mode === 'asking' &&
    (spec.brand.confidence < LOW_CONF_THRESHOLD ||
      spec.category.confidence < LOW_CONF_THRESHOLD ||
      spec.product_type.confidence < LOW_CONF_THRESHOLD ||
      spec.brand_color_hex.confidence < LOW_CONF_THRESHOLD);
  const planBlocked = plan.items.filter((item) => item.enabled).length === 0;
  const isJobActive = Boolean(activeJobId);

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

      {guardNote && (
        <div className="rounded-input bg-amber-400/10 px-s-3 py-s-2 text-xs text-amber-600">
          {guardNote}
        </div>
      )}

      {/* ── MINIMAL / ASKING shared preview ── */}
      {(mode === 'minimal' || mode === 'asking') && (
        <div className="flex flex-col gap-s-2 text-sm">
          <div data-testid="field-category" className="flex items-center gap-s-2">
            <span className="font-mono uppercase tracking-wider text-xs text-ink-faint w-16">
              品类
            </span>
            <span className="text-ink-primary">{spec.category.value}</span>
            <ConfidenceBadge field={spec.category} />
          </div>
          <div data-testid="field-product_type" className="flex items-center gap-s-2">
            <span className="font-mono uppercase tracking-wider text-xs text-ink-faint w-16">
              风格
            </span>
            <span className="text-ink-primary">{spec.product_type.value}</span>
            <ConfidenceBadge field={spec.product_type} />
          </div>
          <div data-testid="field-brand_color_hex" className="flex items-center gap-s-2">
            <span className="font-mono uppercase tracking-wider text-xs text-ink-faint w-16">
              品牌色
            </span>
            <ColorSwatch hex={spec.brand_color_hex.value} />
            <ConfidenceBadge field={spec.brand_color_hex} />
          </div>
        </div>
      )}

      {/* ── ASKING mode — low-conf editable cells ── */}
      {mode === 'asking' && lowConfFields.length > 0 && (
        <div className="flex flex-col gap-s-3 border-t border-border-subtle pt-s-3">
          <p className="text-xs text-ink-muted">以下字段置信度较低，请确认：</p>
          {lowConfFields.map(({ key, label }) => {
            const f = spec[key] as FieldInference<string>;
            return (
              <EditableCell
                key={key}
                label={label}
                field={f}
                fieldName={key}
                onChange={(val) => updateField(key, val)}
                isColor={key === 'brand_color_hex'}
                isProductType={key === 'product_type'}
              />
            );
          })}
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
              暂无输出项，请添加白底主图、Banner 或完整 14 图计划。
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
          disabled={askingBlocked || planBlocked || isJobActive}
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

import type { KitSellingPoint, KitSkuMetaPayload } from '@/hooks/use-kit-pipeline';
import {
  type FieldInference,
  type InferredSpec,
  type Locale,
  inferenceText,
} from '@/lib/chat/types';
import type { GenerationPlan, GenerationPlanItem } from '@/lib/generation/types';

const PRODUCT_TYPES = ['blue_hat', 'sports', 'general_food', 'other'] as const;
export type BriefProductType = (typeof PRODUCT_TYPES)[number];

export interface GenerationBriefProductDraft {
  name: string;
  brand: string;
  category: string;
  product_type: BriefProductType;
  brand_color_hex: string;
  price: number;
}

export interface GenerationBriefOutputDraft {
  id: string;
  enabled: boolean;
  title: string;
  output_kind: string;
  template_ref: string;
  template_name: string;
  destination_type: GenerationPlanItem['destination_type'];
  slot_id: string;
  aspect_ratio: string;
  reason: string;
}

export interface GenerationBriefDraft {
  product: GenerationBriefProductDraft;
  selling_points: string[];
  outputs: GenerationBriefOutputDraft[];
}

export interface RewriteSpecPayload {
  locale: Locale;
  sku_meta: KitSkuMetaPayload;
  selling_points: KitSellingPoint[];
}

function normalizeProductType(value: unknown): BriefProductType {
  if (typeof value !== 'string') return 'other';
  const raw = value.trim().toLowerCase();
  if ((PRODUCT_TYPES as readonly string[]).includes(raw)) return raw as BriefProductType;
  if (/(蓝帽|保健|health|supplement)/i.test(value)) return 'blue_hat';
  if (/(运动|健身|sports?|fitness)/i.test(value)) return 'sports';
  if (/(食品|零食|饮品|茶|咖啡|food|snack|drink|beverage)/i.test(value)) {
    return 'general_food';
  }
  return 'other';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function manualField<T>(value: T, reasoning: string): FieldInference<T> {
  return {
    value,
    confidence: 1,
    reasoning,
  };
}

export function buildGenerationBriefDraft(
  inferred: InferredSpec,
  plan: GenerationPlan
): GenerationBriefDraft {
  return {
    product: {
      name: inferenceText(inferred.name),
      brand: inferenceText(inferred.brand),
      category: inferenceText(inferred.category),
      product_type: normalizeProductType(inferenceText(inferred.product_type)),
      brand_color_hex: inferenceText(inferred.brand_color_hex),
      price: typeof inferred.price?.value === 'number' ? inferred.price.value : 0,
    },
    selling_points: (inferred.selling_points ?? [])
      .map((sp) => stringValue(sp.value))
      .filter(Boolean),
    outputs: plan.items.map((item) => ({
      id: item.id,
      enabled: item.enabled,
      title: item.title,
      output_kind: item.output_kind,
      template_ref: item.template_ref ?? '',
      template_name: item.template_name ?? '',
      destination_type: item.destination_type,
      slot_id: item.slot_id ?? '',
      aspect_ratio: item.aspect_ratio ?? '',
      reason: item.reason ?? '',
    })),
  };
}

export function generationBriefCacheKey(draft: GenerationBriefDraft): string {
  return JSON.stringify(draft);
}

export function applyGenerationBriefDraft(
  draft: GenerationBriefDraft,
  previousSpec: InferredSpec,
  previousPlan: GenerationPlan
): { spec: InferredSpec; plan: GenerationPlan } {
  const reason = '用户在 LLM brief 中确认/编辑';
  const name = draft.product.name.trim();
  const sellingPoints = draft.selling_points.map((point) => point.trim()).filter(Boolean);
  const outputById = new Map(draft.outputs.map((output) => [output.id, output]));

  return {
    spec: {
      ...previousSpec,
      name: name ? manualField(name, reason) : previousSpec.name,
      brand: manualField(draft.product.brand.trim(), reason),
      category: manualField(draft.product.category.trim(), reason),
      product_type: manualField(draft.product.product_type, reason),
      brand_color_hex: manualField(draft.product.brand_color_hex.trim(), reason),
      price: manualField(Number.isFinite(draft.product.price) ? draft.product.price : 0, reason),
      selling_points: sellingPoints.map((point) => manualField(point, reason)),
    },
    plan: {
      ...previousPlan,
      plan_source: previousPlan.plan_source === 'recommended' ? 'manual' : previousPlan.plan_source,
      items: previousPlan.items.map((item) => {
        const output = outputById.get(item.id);
        if (!output) return item;
        return {
          ...item,
          enabled: output.enabled,
          title: output.title.trim() || item.title,
          output_kind: output.output_kind.trim() || item.output_kind,
          template_ref: output.template_ref.trim() || null,
          template_name: output.template_name.trim() || item.template_name,
          destination_type: output.destination_type,
          slot_id: output.slot_id.trim() || null,
          aspect_ratio: output.aspect_ratio.trim() || null,
          reason: output.reason.trim() || item.reason,
        };
      }),
    },
  };
}

export function buildRewriteSpecPayload(
  draft: GenerationBriefDraft,
  locale: Locale,
  userPrompt: string | null = null
): RewriteSpecPayload {
  const promptText = userPrompt?.trim();
  const sellingPointTexts = draft.selling_points.map((point) => point.trim()).filter(Boolean);
  const outputBriefTexts = draft.outputs
    .filter((output) => output.enabled)
    .map((output) => {
      const parts = [
        output.title.trim(),
        output.output_kind.trim() ? `类型：${output.output_kind.trim()}` : '',
        output.aspect_ratio.trim() ? `比例：${output.aspect_ratio.trim()}` : '',
        output.reason.trim() ? `意图：${output.reason.trim()}` : '',
        output.template_name.trim() ? `模板：${output.template_name.trim()}` : '',
      ].filter(Boolean);
      return parts.join('；');
    })
    .filter(Boolean);
  const defaultPoint =
    [draft.product.brand, draft.product.category, promptText].filter(Boolean).join(' ') ||
    '商品基础展示';
  const productPoints = sellingPointTexts.length > 0 ? sellingPointTexts : [defaultPoint];
  const selling_points: KitSellingPoint[] = [
    ...productPoints.map((point) => ({
      title: point,
      evidence: promptText ? `${point}；用户提示：${promptText}` : point,
      priority: 'high' as const,
    })),
    ...outputBriefTexts.map((point) => ({
      title: `输出计划：${point.slice(0, 48)}`,
      evidence: promptText ? `${point}；用户提示：${promptText}` : point,
      priority: 'medium' as const,
    })),
  ];

  return {
    locale,
    sku_meta: {
      sku: '',
      name: draft.product.name.trim(),
      brand: draft.product.brand.trim(),
      category: draft.product.category.trim(),
      product_type: draft.product.product_type,
      price: Number.isFinite(draft.product.price) ? draft.product.price : 0,
    },
    selling_points,
  };
}

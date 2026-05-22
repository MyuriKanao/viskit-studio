import { buildGenerationBriefDraft } from '@/lib/chat/generation-brief';
import type { InferredSpec, Locale } from '@/lib/chat/types';
import type {
  GenerationJobCreateRequest,
  GenerationJobOutputCreateRequest,
  GenerationPlan,
  GenerationPlanItem,
  ProductProfilePayload,
  SourceImageRef,
} from '@/lib/generation/types';

export interface BuildGenerationJobPayloadInput {
  kitClientId: string;
  sourceImage: SourceImageRef;
  locale: Locale;
  userPrompt: string | null;
  stylePrompt: string;
  product: ProductProfilePayload;
  outputPlan: GenerationPlan;
  inferred: InferredSpec;
  spec: unknown;
  specMarkdown?: string;
  compliance?: unknown;
  templateSchemeRef?: string | null;
  templateSlotOverrides?: Record<string, string>;
  marketingKitId?: number | null;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function productLine(product: ProductProfilePayload): string {
  return [product.brand, product.name, product.category, product.product_type]
    .filter(Boolean)
    .join(' · ');
}

function templateRefForItem(locale: Locale, item: GenerationPlanItem): string {
  const explicit = clean(item.template_ref);
  if (explicit) return explicit;
  const kind = item.output_kind;
  if (item.slot_id?.startsWith('M') || kind === 'detail') return `builtin:${locale}:detail-macro`;
  if (kind === 'banner' || kind === 'poster') return `builtin:${locale}:poster-banner`;
  if (kind === 'custom') return `builtin:${locale}:social-media`;
  return `builtin:${locale}:hero-image`;
}

function templateNameForRef(ref: string, item: GenerationPlanItem): string {
  if (item.template_name) return item.template_name;
  if (ref.includes('detail-macro')) return '细节微距图';
  if (ref.includes('poster-banner')) return '促销海报 / Banner';
  if (ref.includes('social-media')) return '社媒素材图';
  if (ref.includes('hero-image')) return '白底/纯色底产品主图';
  return ref;
}

function sizeForItem(item: GenerationPlanItem): { width: number; height: number } {
  const ratio = clean(item.aspect_ratio);
  if (item.slot_id?.startsWith('M') || item.output_kind === 'detail')
    return { width: 1024, height: 1536 };
  if (ratio === '16:9') return { width: 1536, height: 864 };
  if (ratio === '9:16') return { width: 864, height: 1536 };
  if (ratio === '3:4') return { width: 1024, height: 1536 };
  if (ratio === '4:3') return { width: 1536, height: 1024 };
  if (item.output_kind === 'banner' || item.output_kind === 'poster')
    return { width: 1024, height: 1536 };
  return { width: 1024, height: 1024 };
}

function sectionRecord(spec: unknown, slotId: string | null): Record<string, unknown> | null {
  if (!slotId || typeof spec !== 'object' || spec === null) return null;
  const source = spec as Record<string, unknown>;
  const key = slotId.startsWith('H')
    ? 'hero_sections'
    : slotId.startsWith('M')
      ? 'detail_sections'
      : null;
  if (!key || !Array.isArray(source[key])) return null;
  const section = source[key].find((entry) => {
    return (
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>).id === slotId
    );
  });
  return typeof section === 'object' && section !== null
    ? (section as Record<string, unknown>)
    : null;
}

function sectionThreePiece(spec: unknown, slotId: string | null) {
  const section = sectionRecord(spec, slotId);
  const raw =
    section && typeof section.three_piece === 'object' && section.three_piece !== null
      ? (section.three_piece as Record<string, unknown>)
      : null;
  return {
    visual: clean(raw?.visual),
    copy: clean(raw?.copy) || clean(raw?.copy_text),
    design: clean(raw?.design_note),
  };
}

function buildOutputPrompt(
  input: BuildGenerationJobPayloadInput,
  item: GenerationPlanItem
): string {
  const section = sectionThreePiece(input.spec, item.slot_id);
  const sellingPoints = input.product.selling_points.join('、');
  const lines = [
    `产品：${productLine(input.product) || '待生成商品'}`,
    `输出：${item.title} (${item.output_kind})`,
    sellingPoints ? `核心卖点：${sellingPoints}` : '',
    input.userPrompt ? `用户要求：${input.userPrompt}` : '',
    input.stylePrompt ? `整体风格：${input.stylePrompt}` : '',
    section.visual ? `画面：${section.visual}` : '',
    section.copy ? `图内文案：${section.copy}` : '',
    section.design ? `设计说明：${section.design}` : '',
    item.reason ? `计划理由：${item.reason}` : '',
    '请基于参考商品图生成电商视觉素材，保持商品主体一致，画面干净、商业可用。',
  ].filter(Boolean);
  return lines.join('\n');
}

function outputKey(item: GenerationPlanItem, index: number): string {
  return clean(item.slot_id) || clean(item.id) || `output-${index + 1}`;
}

export function buildGenerationJobCreateRequest(
  input: BuildGenerationJobPayloadInput
): GenerationJobCreateRequest {
  const enabledItems = input.outputPlan.items.filter((item) => item.enabled);
  const outputs: GenerationJobOutputCreateRequest[] = enabledItems.map((item, index) => {
    const templateRef = templateRefForItem(input.locale, item);
    const { width, height } = sizeForItem(item);
    const canWriteKitSlot = item.destination_type === 'kit_slot' && input.marketingKitId != null;
    return {
      output_key: outputKey(item, index),
      output_kind: item.output_kind || 'custom',
      template_ref: templateRef,
      template_name: templateNameForRef(templateRef, item),
      aspect_ratio: item.aspect_ratio,
      width,
      height,
      prompt: buildOutputPrompt(input, item),
      destination_type: canWriteKitSlot ? 'kit_slot' : 'asset',
      marketing_kit_id: canWriteKitSlot ? input.marketingKitId : null,
      slot_id: canWriteKitSlot ? item.slot_id : null,
    };
  });

  return {
    source_image_ref: input.sourceImage.source_image_ref,
    user_prompt: input.userPrompt ?? '',
    locale: input.locale,
    client_job_id: input.kitClientId,
    marketing_kit_id: input.marketingKitId ?? null,
    planner_payload: {
      kit_client_id: input.kitClientId,
      product: input.product,
      output_plan: input.outputPlan,
      combined_brief: buildGenerationBriefDraft(input.inferred, input.outputPlan),
      spec: input.spec,
      spec_markdown: input.specMarkdown,
      compliance: input.compliance,
      style_prompt: input.stylePrompt,
      template_scheme_ref: input.templateSchemeRef ?? null,
      template_slot_overrides: input.templateSlotOverrides ?? {},
    },
    outputs,
  };
}

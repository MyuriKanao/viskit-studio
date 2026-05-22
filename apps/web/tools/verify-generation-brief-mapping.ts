import {
  applyGenerationBriefDraft,
  buildGenerationBriefDraft,
  buildRewriteSpecPayload,
} from '@/lib/chat/generation-brief';
import { type FieldInference, type InferredSpec, normalizeInferredSpec } from '@/lib/chat/types';
import { buildGenerationJobCreateRequest } from '@/lib/generation/job-payload';
import type { GenerationPlan, ProductProfilePayload, SourceImageRef } from '@/lib/generation/types';

function field<T>(value: T): FieldInference<T> {
  return {
    value,
    confidence: 0.9,
    reasoning: 'fixture',
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const inferred: InferredSpec = {
  name: field('燕麦能量棒'),
  brand: field('Viskit'),
  category: field('健康零食'),
  product_type: field('general_food'),
  brand_color_hex: field('#4f46e5'),
  price: field(29),
  selling_points: [field('高蛋白'), field('低糖配方')],
};

const plan: GenerationPlan = {
  plan_id: 'plan-fixture',
  source_image_ref: 'source-fixture',
  plan_source: 'recommended',
  requires_confirmation: true,
  user_prompt: '做一套适合小红书的素材',
  items: [
    {
      id: 'hero',
      output_kind: 'product_main',
      title: '产品主图',
      reason: '用于首屏展示',
      template_ref: null,
      template_name: null,
      aspect_ratio: '1:1',
      destination_type: 'asset',
      slot_id: null,
      enabled: true,
    },
    {
      id: 'banner',
      output_kind: 'banner',
      title: '活动 Banner',
      reason: '用于促销露出',
      template_ref: null,
      template_name: null,
      aspect_ratio: '16:9',
      destination_type: 'asset',
      slot_id: null,
      enabled: false,
    },
  ],
};

const baseDraft = buildGenerationBriefDraft(inferred, plan);
const editedDraft = {
  ...baseDraft,
  product: {
    ...baseDraft.product,
    brand: 'Viskit Studio',
  },
  selling_points: ['高蛋白饱腹', '低糖轻负担'],
  outputs: baseDraft.outputs.map((output) =>
    output.id === 'hero'
      ? {
          ...output,
          title: '高级感产品主图',
          reason: '突出能量棒包装和低糖卖点',
        }
      : output
  ),
};

const applied = applyGenerationBriefDraft(editedDraft, inferred, plan);
assert(applied.spec.brand.value === 'Viskit Studio', 'brief product brand maps back to spec');
assert(
  applied.spec.selling_points[0]?.value === '高蛋白饱腹',
  'brief selling point maps back to spec'
);
const noSellingPoints = applyGenerationBriefDraft(
  { ...editedDraft, selling_points: [] },
  inferred,
  plan
);
assert(noSellingPoints.spec.selling_points.length === 0, 'empty brief selling points stay empty');
assert(applied.plan.plan_source === 'manual', 'edited recommended plan is marked manual');
assert(applied.plan.items[0]?.title === '高级感产品主图', 'brief output title maps back to plan');

const rewritePayload = buildRewriteSpecPayload(editedDraft, 'zh', '做一套适合小红书的素材');
assert(rewritePayload.sku_meta.brand === 'Viskit Studio', 'rewrite payload uses edited brand');
assert(rewritePayload.selling_points.length === 3, 'rewrite payload includes output brief context');
assert(
  rewritePayload.selling_points.some((point) => point.evidence.includes('突出能量棒包装')),
  'rewrite payload carries edited output reason'
);

const sourceImage: SourceImageRef = {
  source_image_ref: 'src-fixture',
  preview_url: null,
  mime: 'image/png',
};
const product: ProductProfilePayload = {
  name: applied.spec.name?.value ?? null,
  brand: applied.spec.brand.value,
  category: applied.spec.category.value,
  product_type: applied.spec.product_type.value,
  price: applied.spec.price?.value ?? null,
  brand_color_hex: applied.spec.brand_color_hex.value,
  selling_points: applied.spec.selling_points.map((point) => point.value),
};
const jobPayload = buildGenerationJobCreateRequest({
  kitClientId: 'kit-fixture',
  sourceImage,
  locale: 'zh',
  userPrompt: '做一套适合小红书的素材',
  stylePrompt: '高蛋白饱腹、低糖轻负担',
  product,
  outputPlan: applied.plan,
  inferred: applied.spec,
  spec: { hero_sections: [] },
  specMarkdown: '# fixture',
  compliance: { ok: true },
});
const combinedBrief = jobPayload.planner_payload.combined_brief as ReturnType<
  typeof buildGenerationBriefDraft
>;
assert(jobPayload.outputs.length === 1, 'generation job keeps only enabled outputs');
assert(
  jobPayload.outputs[0]?.template_ref === 'builtin:zh:hero-image',
  'adapter fills template ref'
);
assert(
  jobPayload.outputs[0]?.destination_type === 'asset',
  'adapter keeps backend-safe asset destination'
);
assert(combinedBrief.product.brand === 'Viskit Studio', 'job planner payload carries edited brief');

const malformedInferred = normalizeInferredSpec({
  category: field('健康零食'),
  product_type: field('general_food'),
  brand_color_hex: field('#4f46e5'),
  selling_points: undefined,
} as unknown as InferredSpec);
const malformedDraft = buildGenerationBriefDraft(malformedInferred, plan);
assert(malformedDraft.product.brand === '', 'missing inferred brand normalizes to empty string');
assert(
  malformedDraft.selling_points.length === 0,
  'missing selling points normalize to empty list'
);

const fourByFivePayload = buildGenerationJobCreateRequest({
  kitClientId: 'kit-fixture',
  sourceImage,
  locale: 'zh',
  userPrompt: null,
  stylePrompt: '',
  product,
  outputPlan: {
    ...plan,
    items: [
      {
        ...plan.items[0],
        aspect_ratio: '4:5',
        enabled: true,
      },
    ],
  },
  inferred: applied.spec,
  spec: { hero_sections: [] },
});
assert(fourByFivePayload.outputs[0]?.width === 1088, '4:5 width is divisible by 16');
assert(fourByFivePayload.outputs[0]?.height === 1360, '4:5 height is divisible by 16');

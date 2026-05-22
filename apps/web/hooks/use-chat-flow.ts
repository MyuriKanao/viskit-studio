'use client';

/**
 * use-chat-flow — orchestrates the full image → extract → confirm → spec → generate → redirect
 * pipeline for /new-kit chat UI (Phase D).
 *
 * Design constraints:
 *  - R10: chat-store MUST NOT open a second EventSource. Progress arrives via onProgress
 *    callback fanned out from the single useGenerateKit SSE consumer.
 *  - Polish Queue #1: onStart guard refuses to proceed when brand/category confidence < threshold.
 *  - MessageInput stays presentational; all async orchestration lives here.
 */

import { useLocale } from 'next-intl';
import { useCallback } from 'react';

import { useExtract } from '@/hooks/use-extract';
import {
  useGenerationJob,
  useGenerationPlan,
  usePersistSourceImage,
} from '@/hooks/use-generation-job';
import { useGenerateKit, useKitSpec } from '@/hooks/use-kit-pipeline';
import type { KitSellingPoint, KitSkuMetaPayload } from '@/hooks/use-kit-pipeline';
import type { SpecResponse } from '@/hooks/use-kit-pipeline';
import { LOW_CONF_THRESHOLD } from '@/lib/chat/constants';
import { buildGenerationBriefDraft, buildRewriteSpecPayload } from '@/lib/chat/generation-brief';
import { useChatStore } from '@/lib/chat/store';
import type { InferredSpec, ProgressEvent } from '@/lib/chat/types';
import { buildGenerationJobCreateRequest } from '@/lib/generation/job-payload';
import type {
  GenerationJobStatus,
  GenerationPlan,
  ProductProfilePayload,
  SourceImageRef,
} from '@/lib/generation/types';

const PRODUCT_TYPES = ['blue_hat', 'sports', 'general_food', 'other'] as const;
type ProductType = (typeof PRODUCT_TYPES)[number];

function normalizeProductType(value: unknown): ProductType {
  if (typeof value !== 'string') return 'other';
  const raw = value.trim().toLowerCase();
  if ((PRODUCT_TYPES as readonly string[]).includes(raw)) return raw as ProductType;
  if (/(蓝帽|保健|health|supplement)/i.test(value)) return 'blue_hat';
  if (/(运动|健身|sports?|fitness)/i.test(value)) return 'sports';
  if (/(食品|零食|饮品|茶|咖啡|food|snack|drink|beverage)/i.test(value)) {
    return 'general_food';
  }
  return 'other';
}

function sellingPointValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildProductProfile(inferred: InferredSpec): ProductProfilePayload {
  return {
    name: inferred.name?.value ?? null,
    brand: inferred.brand.value,
    category: inferred.category.value,
    product_type: normalizeProductType(inferred.product_type.value),
    price: inferred.price?.value ?? null,
    brand_color_hex: inferred.brand_color_hex.value,
    selling_points: inferred.selling_points
      .map((sp) => sellingPointValue(sp.value))
      .filter(Boolean),
  };
}

function buildSellingPoints(inferred: InferredSpec, userPrompt: string | null): KitSellingPoint[] {
  const promptText = userPrompt?.trim();
  const pointTexts = inferred.selling_points
    .map((sp) => sellingPointValue(sp.value))
    .filter(Boolean);
  const defaultPoint =
    [inferred.brand.value, inferred.category.value, promptText].filter(Boolean).join(' ') ||
    '商品基础展示';
  return (pointTexts.length > 0 ? pointTexts : [defaultPoint]).filter(Boolean).map((point) => ({
    title: point,
    evidence: promptText ? `${point}；用户提示：${promptText}` : point,
    priority: 'high' as const,
  }));
}

function isFullKitPlan(plan: GenerationPlan): boolean {
  const slots = new Set(plan.items.map((item) => item.slot_id).filter(Boolean));
  return (
    plan.items.length === 14 &&
    ['H1', 'H2', 'H3', 'H4', 'H5', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'].every(
      (slot) => slots.has(slot)
    )
  );
}

function isActiveGenerationStatus(status: GenerationJobStatus): boolean {
  return (
    status === 'planned' || status === 'queued' || status === 'running' || status === 'stopping'
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function prepareImagePayload(imageUrl: string, fallbackMime: string) {
  if (imageUrl.startsWith('data:image/')) {
    return { imageUrl, mime: fallbackMime };
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`图片读取失败 (${response.status})`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('图片读取失败：返回内容不是图片');
  }
  return {
    imageUrl: await blobToDataUrl(blob),
    mime: blob.type || fallbackMime,
  };
}

type HandleImageDropOptions = {
  appendImageMessage?: boolean;
  sourceImage?: SourceImageRef | null;
};

// ---------------------------------------------------------------------------
// Image drop → extract
// ---------------------------------------------------------------------------

/** Call when user drops/pastes an image (and optionally provides a description).
 *  Appends messages, fires /extract, sets inferred_spec + confirmation_mode. */
export function useChatImageFlow() {
  const locale = useLocale() as 'zh' | 'en';
  const kitClientId = useChatStore((s) => s.kit_client_id);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setHeroImage = useChatStore((s) => s.setHeroImage);
  const setSourceImage = useChatStore((s) => s.setSourceImage);
  const setUserPrompt = useChatStore((s) => s.setUserPrompt);
  const setInferredSpec = useChatStore((s) => s.setInferredSpec);
  const setOutputPlan = useChatStore((s) => s.setOutputPlan);
  const setConfirmationMode = useChatStore((s) => s.setConfirmationMode);
  const setActiveJobId = useChatStore((s) => s.setActiveJobId);
  const extractMutation = useExtract();
  const extract = extractMutation.mutateAsync;
  const persistSourceImageMutation = usePersistSourceImage();
  const persistSourceImage = persistSourceImageMutation.mutateAsync;
  const planMutation = useGenerationPlan();
  const createPlan = planMutation.mutateAsync;

  const handleImageDrop = useCallback(
    async (
      imageUrl: string,
      mime: string,
      description?: string,
      options: HandleImageDropOptions = {}
    ) => {
      // 1. Persist hero image and optional prompt in store
      const userPrompt = description?.trim() || null;
      const existingSourceImage = options.sourceImage ?? null;
      setHeroImage({ url: imageUrl, mime });
      setSourceImage(existingSourceImage);
      setUserPrompt(userPrompt);
      setOutputPlan(null);
      setActiveJobId(null);

      // 2. Append user image bubble
      if (options.appendImageMessage !== false) {
        appendMessage({ role: 'user', type: 'image_ref', content: imageUrl });
      }

      // 3. Append user text bubble if description was provided
      if (userPrompt) {
        appendMessage({ role: 'user', type: 'text', content: userPrompt });
      }

      // 4. Append AI "推断中…" placeholder
      const pendingMessageId = appendMessage({
        role: 'ai',
        type: 'text',
        content: '正在推断商品信息…',
      });

      // 5. Persist source image, then fire /extract and /generation/plan.
      try {
        const imagePayload = await prepareImagePayload(imageUrl, mime);
        const sourceImage =
          existingSourceImage ??
          (await persistSourceImage({
            imageUrl: imagePayload.imageUrl,
            mime: imagePayload.mime,
          }));
        setSourceImage(sourceImage);

        const inferred = await extract({
          kitClientId,
          imageUrl: imagePayload.imageUrl,
          description,
        });

        // 6a. Persist inferred spec
        setInferredSpec(inferred);

        // 6b. Set initial confirmation mode based on required-field confidence
        const hasLowConf =
          inferred.brand.confidence < LOW_CONF_THRESHOLD ||
          inferred.category.confidence < LOW_CONF_THRESHOLD ||
          inferred.product_type.confidence < LOW_CONF_THRESHOLD ||
          inferred.brand_color_hex.confidence < LOW_CONF_THRESHOLD;
        setConfirmationMode(hasLowConf ? 'asking' : 'minimal');

        updateMessage(pendingMessageId, {
          content: '商品信息已推断，正在生成可确认的输出计划…',
        });
        const outputPlan = await createPlan({
          kit_client_id: kitClientId,
          source_image_ref: sourceImage.source_image_ref,
          user_prompt: userPrompt,
          locale,
          product: buildProductProfile(inferred),
        });
        setOutputPlan(outputPlan);

        // 6c. Append AI card message — MessageList renders ConfirmationCard for this type
        updateMessage(pendingMessageId, { content: '推断完成，请确认商品信息和输出计划。' });
        appendMessage({ role: 'ai', type: 'card', content: 'confirmation-card' });
      } catch (err) {
        // 6d. On failure: append error bubble; flow stays recoverable (user can re-drop)
        const msg = err instanceof Error ? err.message : String(err);
        updateMessage(pendingMessageId, {
          content: `推断失败：${msg}。请重新上传图片。`,
        });
      }
    },
    [
      appendMessage,
      createPlan,
      extract,
      kitClientId,
      locale,
      persistSourceImage,
      setConfirmationMode,
      setActiveJobId,
      setHeroImage,
      setInferredSpec,
      setOutputPlan,
      setSourceImage,
      setUserPrompt,
      updateMessage,
    ]
  );

  const handleImageUpload = useCallback(
    async (imageUrl: string, mime: string) => {
      setHeroImage({ url: imageUrl, mime });
      setSourceImage(null);
      setUserPrompt(null);
      setInferredSpec(null);
      setOutputPlan(null);
      setConfirmationMode(null);
      setActiveJobId(null);
      appendMessage({ role: 'user', type: 'image_ref', content: imageUrl });

      try {
        const imagePayload = await prepareImagePayload(imageUrl, mime);
        const sourceImage = await persistSourceImage({
          imageUrl: imagePayload.imageUrl,
          mime: imagePayload.mime,
        });
        setSourceImage(sourceImage);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendMessage({
          role: 'ai',
          type: 'text',
          content: `图片保存失败：${msg}。请重新上传图片。`,
        });
      }
    },
    [
      appendMessage,
      persistSourceImage,
      setActiveJobId,
      setConfirmationMode,
      setHeroImage,
      setInferredSpec,
      setOutputPlan,
      setSourceImage,
      setUserPrompt,
    ]
  );

  return {
    handleImageDrop,
    handleImageUpload,
    isExtracting:
      extractMutation.isPending || persistSourceImageMutation.isPending || planMutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// "开始生成" → spec → generate → redirect (D3)
// ---------------------------------------------------------------------------

/** Returns a handleStart callback to pass into ConfirmationCard.onStart.
 *  Chains /spec → /generate → router.push('/kits/{db_kit_id}').
 *
 *  onProgress fan-out (Polish Queue #4): progress events are forwarded to chat via
 *  the GenerateParams.onProgress callback — NOT via a second EventSource (R10). */
export function useChatStartFlow(onProgress?: (event: ProgressEvent) => void) {
  const locale = useLocale();
  const kitClientId = useChatStore((s) => s.kit_client_id);
  const sourceImage = useChatStore((s) => s.source_image);
  const outputPlan = useChatStore((s) => s.output_plan);
  const userPrompt = useChatStore((s) => s.user_prompt);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setConfirmationMode = useChatStore((s) => s.setConfirmationMode);
  const setActiveJobId = useChatStore((s) => s.setActiveJobId);
  const specMut = useKitSpec();
  const createSpec = specMut.mutateAsync;
  const genKit = useGenerateKit();
  const startGenerate = genKit.start;
  const {
    phase: generationJobPhase,
    errorMessage: generationJobErrorMessage,
    job: generationJobSnapshot,
    activeJobId,
    start: startGenerationJob,
    stop: stopGenerationJob,
    resume: resumeGenerationJob,
    refresh: refreshGenerationJob,
  } = useGenerationJob({ onProgress });

  const handleStart = useCallback(
    async (
      inferred: InferredSpec,
      confirmedPlan?: GenerationPlan,
      rewrittenSpec?: SpecResponse
    ) => {
      // Polish Queue #1 guard: refuse when brand/category confidence is still low
      if (
        inferred.brand.confidence < LOW_CONF_THRESHOLD ||
        inferred.category.confidence < LOW_CONF_THRESHOLD
      ) {
        setConfirmationMode('asking');
        appendMessage({
          role: 'ai',
          type: 'text',
          content: '请先确认品牌和品类后再开始生成。',
        });
        return;
      }

      const plan = confirmedPlan ?? outputPlan;
      const enabledItems = plan?.items.filter((item) => item.enabled) ?? [];
      if (!sourceImage?.source_image_ref || !plan || enabledItems.length === 0) {
        appendMessage({
          role: 'ai',
          type: 'text',
          content: '请先保存源图并确认至少一个输出计划后再开始生成。',
        });
        return;
      }

      // Build SkuMetaIn payload (sku/name are optional — server fills defaults per HIGH-3)
      const skuMeta: KitSkuMetaPayload = {
        sku: '', // server will synthesize KIT-{ts} when empty string / null coerced server-side
        name: inferred.name?.value ?? '',
        brand: inferred.brand.value,
        category: inferred.category.value,
        product_type: normalizeProductType(inferred.product_type.value),
        price: inferred.price?.value ?? 0,
      };

      const promptText = userPrompt?.trim();
      const sellingPoints = buildSellingPoints(inferred, userPrompt);

      // Append AI progress placeholder
      appendMessage({ role: 'ai', type: 'text', content: '输出计划已确认，正在生成规格…' });

      try {
        // Step 1: /spec. If the user already ran the LLM brief rewrite and did
        // not edit after it, reuse that response so the visible brief feeds the
        // exact downstream generation payload.
        const specResp =
          rewrittenSpec ??
          (await createSpec({
            kit_id: kitClientId,
            locale: locale as 'zh' | 'en',
            sku_meta: skuMeta,
            selling_points: sellingPoints,
          }));

        appendMessage({
          role: 'ai',
          type: 'text',
          content: rewrittenSpec
            ? `已使用改写后的 brief，正在创建后台生成任务（${enabledItems.length} 个输出）…`
            : `规格完成，正在创建后台生成任务（${enabledItems.length} 个输出）…`,
        });

        // Step 2: create durable generation job. Job progress is observed through
        // GET/SSE by useGenerationJob; unmounting this component only closes the
        // subscription and does not cancel backend work.
        const progressMessages = new Map<string, string>();
        const selectedPlan: GenerationPlan = {
          ...plan,
          items: enabledItems,
          requires_confirmation: true,
        };
        const product = buildProductProfile(inferred);
        const stylePrompt = [promptText, ...inferred.selling_points.map((sp) => sp.value)]
          .filter(Boolean)
          .join('、');
        if (isFullKitPlan(selectedPlan)) {
          // Explicit legacy 14-slot kit path: this preserves the existing full-kit
          // flow and is not used as a catch-all fallback for durable job failures.
          const result = await startGenerate({
            kit_id: kitClientId,
            brand_color_hex: inferred.brand_color_hex.value,
            locale: locale as 'zh' | 'en',
            spec: specResp.spec,
            style_prompt: stylePrompt,
            template_scheme_ref: inferred.template_scheme_ref ?? null,
            template_slot_overrides: inferred.template_slot_overrides ?? {},
            onProgress: (e: ProgressEvent) => {
              onProgress?.(e);
              const existingId = progressMessages.get(e.slot);
              const content =
                e.status === 'success'
                  ? `${e.slot} 生成完成`
                  : e.status === 'failed'
                    ? `${e.slot} 生成失败`
                    : e.status === 'pending'
                      ? `等待生成 ${e.slot}…`
                      : `生成中 ${e.slot}…`;
              if (existingId) {
                useChatStore.getState().updateMessage(existingId, { content });
              } else {
                const id = appendMessage({
                  role: 'ai',
                  type: 'text',
                  content,
                });
                progressMessages.set(e.slot, id);
              }
            },
          });
          if (result) {
            appendMessage({
              role: 'ai',
              type: 'text',
              content: '旧版 14 图生成完成，可在套包详情查看。',
            });
          }
          return;
        }

        const snapshot = await startGenerationJob(
          buildGenerationJobCreateRequest({
            kitClientId,
            sourceImage,
            locale: locale as 'zh' | 'en',
            userPrompt: promptText ?? null,
            stylePrompt,
            product,
            outputPlan: selectedPlan,
            inferred,
            spec: specResp.spec,
            specMarkdown: specResp.spec_markdown,
            compliance: specResp.compliance,
            templateSchemeRef: inferred.template_scheme_ref ?? null,
            templateSlotOverrides: inferred.template_slot_overrides ?? {},
          })
        );

        setActiveJobId(isActiveGenerationStatus(snapshot.status) ? snapshot.job_id : null);
        appendMessage({
          role: 'ai',
          type: 'text',
          content: `后台任务已启动：${snapshot.job_id}。离开页面不会取消生成，可稍后返回继续查看。`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendMessage({
          role: 'ai',
          type: 'text',
          content: `生成失败：${msg}。请重试。`,
        });
      }
    },
    [
      appendMessage,
      createSpec,
      kitClientId,
      locale,
      onProgress,
      outputPlan,
      setActiveJobId,
      setConfirmationMode,
      sourceImage,
      startGenerate,
      startGenerationJob,
      userPrompt,
    ]
  );

  const handleRewriteBrief = useCallback(
    async (inferred: InferredSpec, plan: GenerationPlan) => {
      const draft = buildGenerationBriefDraft(inferred, plan);
      const payload = buildRewriteSpecPayload(draft, locale as 'zh' | 'en', userPrompt);
      return createSpec({
        kit_id: kitClientId,
        ...payload,
      });
    },
    [createSpec, kitClientId, locale, userPrompt]
  );

  const handleStop = useCallback(async () => {
    const stopped = await stopGenerationJob();
    if (stopped) {
      setActiveJobId(null);
      appendMessage({
        role: 'ai',
        type: 'text',
        content: `已请求停止任务 ${stopped.job_id}，未开始的输出不会再调度。`,
      });
    }
    return stopped;
  }, [appendMessage, setActiveJobId, stopGenerationJob]);

  const handleResume = useCallback(
    async (jobId: string) => {
      const snapshot = await resumeGenerationJob(jobId);
      if (snapshot) {
        setActiveJobId(isActiveGenerationStatus(snapshot.status) ? snapshot.job_id : null);
      }
      return snapshot;
    },
    [resumeGenerationJob, setActiveJobId]
  );

  return {
    handleStart,
    handleRewriteBrief,
    specPhase: specMut.status,
    genPhase: generationJobPhase,
    job: generationJobSnapshot,
    activeJobId,
    errorMessage: generationJobErrorMessage,
    handleStop,
    resumeJob: handleResume,
    refreshJob: refreshGenerationJob,
  };
}

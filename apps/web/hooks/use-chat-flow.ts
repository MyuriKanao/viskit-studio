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
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { useExtract } from '@/hooks/use-extract';
import { useGenerateKit, useKitSpec } from '@/hooks/use-kit-pipeline';
import type { KitSellingPoint, KitSkuMetaPayload } from '@/hooks/use-kit-pipeline';
import { LOW_CONF_THRESHOLD } from '@/lib/chat/constants';
import { useChatStore } from '@/lib/chat/store';
import type { InferredSpec, ProgressEvent } from '@/lib/chat/types';

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

// ---------------------------------------------------------------------------
// Image drop → extract
// ---------------------------------------------------------------------------

/** Call when user drops/pastes an image (and optionally provides a description).
 *  Appends messages, fires /extract, sets inferred_spec + confirmation_mode. */
export function useChatImageFlow() {
  const kitClientId = useChatStore((s) => s.kit_client_id);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setHeroImage = useChatStore((s) => s.setHeroImage);
  const setUserPrompt = useChatStore((s) => s.setUserPrompt);
  const setInferredSpec = useChatStore((s) => s.setInferredSpec);
  const setConfirmationMode = useChatStore((s) => s.setConfirmationMode);
  const extractMutation = useExtract();
  const extract = extractMutation.mutateAsync;

  const handleImageDrop = useCallback(
    async (imageUrl: string, mime: string, description?: string) => {
      // 1. Persist hero image and optional prompt in store
      const userPrompt = description?.trim() || null;
      setHeroImage({ url: imageUrl, mime });
      setUserPrompt(userPrompt);

      // 2. Append user image bubble
      appendMessage({ role: 'user', type: 'image_ref', content: imageUrl });

      // 3. Append user text bubble if description was provided
      if (userPrompt) {
        appendMessage({ role: 'user', type: 'text', content: userPrompt });
      }

      // 4. Append AI "推断中…" placeholder
      const pendingMessageId = appendMessage({
        role: 'ai',
        type: 'text',
        content: '推断中…',
      });

      // 5. Fire /extract
      try {
        const inferred = await extract({
          kitClientId,
          imageUrl,
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

        // 6c. Append AI card message — MessageList renders ConfirmationCard for this type
        updateMessage(pendingMessageId, { content: '推断完成，请确认商品信息。' });
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
      extract,
      kitClientId,
      setConfirmationMode,
      setHeroImage,
      setInferredSpec,
      setUserPrompt,
      updateMessage,
    ]
  );

  return { handleImageDrop, isExtracting: extractMutation.isPending };
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
  const router = useRouter();
  const locale = useLocale();
  const kitClientId = useChatStore((s) => s.kit_client_id);
  const userPrompt = useChatStore((s) => s.user_prompt);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setConfirmationMode = useChatStore((s) => s.setConfirmationMode);
  const specMut = useKitSpec();
  const createSpec = specMut.mutateAsync;
  const genKit = useGenerateKit();
  const startGenerate = genKit.start;

  const handleStart = useCallback(
    async (inferred: InferredSpec) => {
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
      const pointTexts = inferred.selling_points
        .map((sp) => sellingPointValue(sp.value))
        .filter(Boolean);
      const fallbackPoint = [inferred.brand.value, inferred.category.value, promptText]
        .filter(Boolean)
        .join(' ') || '商品基础展示';
      const sellingPoints: KitSellingPoint[] = (pointTexts.length > 0 ? pointTexts : [fallbackPoint])
        .filter(Boolean)
        .map((point) => ({
          title: point,
          evidence: promptText ? `${point}；用户提示：${promptText}` : point,
          priority: 'high' as const,
        }));

      // Append AI progress placeholder
      appendMessage({ role: 'ai', type: 'text', content: '正在规划图片内容…' });

      try {
        // Step 1: /spec
        const specResp = await createSpec({
          kit_id: kitClientId,
          locale: locale as 'zh' | 'en',
          sku_meta: skuMeta,
          selling_points: sellingPoints,
        });

        appendMessage({ role: 'ai', type: 'text', content: '规格完成，正在生成图片…' });

        // Step 2: /generate with onProgress fan-out (R10 — single SSE consumer)
        const progressMessages = new Map<string, string>();
        const result = await startGenerate({
          kit_id: kitClientId,
          brand_color_hex: inferred.brand_color_hex.value,
          locale: locale as 'zh' | 'en',
          spec: specResp.spec,
          style_prompt: [promptText, ...inferred.selling_points.map((sp) => sp.value)]
            .filter(Boolean)
            .join('、'),
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
          appendMessage({ role: 'ai', type: 'text', content: '图片生成完成，正在跳转…' });
          router.push(`/${locale}/kits/${result.db_kit_id}`);
        }
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
      router,
      setConfirmationMode,
      startGenerate,
      userPrompt,
    ]
  );

  return { handleStart, specPhase: specMut.status, genPhase: genKit.phase };
}

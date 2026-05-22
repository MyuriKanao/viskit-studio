'use client';

import { RotateCcw } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { MessageInput } from '@/components/chat/MessageInput';
import { MessageList } from '@/components/chat/MessageList';
import { GenerationJobPreview } from '@/components/generation/GenerationJobPreview';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { useChatStartFlow } from '@/hooks/use-chat-flow';
import { fetchGenerationJob } from '@/hooks/use-generation-job';
import { imageBytesUrl, importSourceImageFromImageId, resolveApiImageSrc } from '@/lib/api/images';
import { useChatStore } from '@/lib/chat/store';
import type { FieldInference, InferredSpec } from '@/lib/chat/types';
import type { GenerationPlan } from '@/lib/generation/types';

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const LAST_JOB_STORAGE_KEY = 'viskit:new-kit:last-generation-job-id';

function isLiveGenerationStatus(status: string | null | undefined): boolean {
  return (
    status === 'planned' || status === 'queued' || status === 'running' || status === 'stopping'
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function recoveredField<T>(value: T, reasoning: string): FieldInference<T> {
  return { value, confidence: 1, reasoning };
}

function buildRecoveredSpec(
  payload: Record<string, unknown>,
  jobPrompt: string | null
): InferredSpec {
  const product = asRecord(payload.product);
  const brief = asRecord(asRecord(payload.combined_brief).product);
  const sellingPoints = Array.isArray(product.selling_points) ? product.selling_points : [];
  const reasoning = jobPrompt ? `从历史任务恢复：${jobPrompt}` : '从历史任务恢复';
  const name = asString(product.name) || asString(brief.name);
  const price = asNumber(product.price) ?? asNumber(brief.price);

  return {
    name: name ? recoveredField(name, reasoning) : null,
    brand: recoveredField(asString(product.brand) || asString(brief.brand), reasoning),
    category: recoveredField(asString(product.category) || asString(brief.category), reasoning),
    product_type: recoveredField(
      asString(product.product_type) || asString(brief.product_type) || 'other',
      reasoning
    ),
    brand_color_hex: recoveredField(
      asString(product.brand_color_hex) || asString(brief.brand_color_hex) || '#1D9AB2',
      reasoning
    ),
    price: price === null ? null : recoveredField(price, reasoning),
    selling_points: sellingPoints
      .map((point) => asString(point).trim())
      .filter(Boolean)
      .map((point) => recoveredField(point, reasoning)),
    template_scheme_ref: asString(payload.template_scheme_ref) || null,
    template_slot_overrides: asRecord(payload.template_slot_overrides) as Record<string, string>,
  };
}

function recoverOutputPlan(
  payload: Record<string, unknown>,
  sourceImageRef: string
): GenerationPlan | null {
  const plan = asRecord(payload.output_plan);
  const items = plan.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  return {
    plan_id: asString(plan.plan_id) || null,
    source_image_ref: sourceImageRef,
    plan_source:
      plan.plan_source === 'explicit' ||
      plan.plan_source === 'recommended' ||
      plan.plan_source === 'fallback' ||
      plan.plan_source === 'manual'
        ? plan.plan_source
        : 'manual',
    requires_confirmation: true,
    items: items as GenerationPlan['items'],
    user_prompt: asString(plan.user_prompt) || null,
  };
}

export default function NewKitPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const resetChat = useChatStore((s) => s.reset);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setHeroImage = useChatStore((s) => s.setHeroImage);
  const setSourceImage = useChatStore((s) => s.setSourceImage);
  const setUserPrompt = useChatStore((s) => s.setUserPrompt);
  const setInferredSpec = useChatStore((s) => s.setInferredSpec);
  const setOutputPlan = useChatStore((s) => s.setOutputPlan);
  const setConfirmationMode = useChatStore((s) => s.setConfirmationMode);
  const setActiveJobId = useChatStore((s) => s.setActiveJobId);
  const sourceImage = useChatStore((s) => s.source_image);
  const outputPlan = useChatStore((s) => s.output_plan);
  const sourceImageId = searchParams.get('source_image_id');
  const recoverJobId = searchParams.get('recover_job_id');
  const importedSourceRef = React.useRef<string | null>(null);
  const recoveredJobRef = React.useRef<string | null>(null);
  const terminalRedirectJobRef = React.useRef<string | null>(null);

  const {
    handleStart,
    handleRewriteBrief,
    genPhase,
    job,
    activeJobId,
    errorMessage,
    handleStop,
    resumeJob,
  } = useChatStartFlow();

  const handleStartNewTask = React.useCallback(() => {
    resetChat();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LAST_JOB_STORAGE_KEY);
    }
    router.replace(pathname, { scroll: false });
  }, [pathname, resetChat, router]);

  React.useEffect(() => {
    if (!recoverJobId || recoveredJobRef.current === recoverJobId) return;
    let cancelled = false;
    resetChat();
    const statusMessageId = appendMessage({
      role: 'ai',
      type: 'text',
      content: '正在恢复历史任务内容…',
    });

    void fetchGenerationJob(recoverJobId)
      .then((snapshot) => {
        if (cancelled) return;
        recoveredJobRef.current = recoverJobId;
        const sourceImageRef = snapshot.source_image_ref;
        const payload = snapshot.planner_payload;
        const recoveredPlan = sourceImageRef ? recoverOutputPlan(payload, sourceImageRef) : null;
        if (!sourceImageRef || !recoveredPlan) {
          throw new Error('历史任务缺少源图或输出计划，无法恢复。');
        }
        const previewUrl = `/api/source-images/${encodeURIComponent(sourceImageRef)}/image`;
        const resolvedPreviewUrl = resolveApiImageSrc(previewUrl);
        const recoveredSpec = buildRecoveredSpec(payload, snapshot.user_prompt);

        setHeroImage({ url: resolvedPreviewUrl, mime: 'image/png' });
        setSourceImage({
          source_image_ref: sourceImageRef,
          preview_url: previewUrl,
          mime: 'image/png',
        });
        setUserPrompt(snapshot.user_prompt);
        setInferredSpec(recoveredSpec);
        setOutputPlan(recoveredPlan);
        setConfirmationMode('minimal');
        setActiveJobId(null);

        appendMessage({ role: 'user', type: 'image_ref', content: resolvedPreviewUrl });
        if (snapshot.user_prompt?.trim()) {
          appendMessage({ role: 'user', type: 'text', content: snapshot.user_prompt });
        }
        updateMessage(statusMessageId, {
          content: `已恢复任务 ${snapshot.job_id} 的商品信息和输出计划，可直接重新生成。`,
        });
        appendMessage({ role: 'ai', type: 'card', content: 'confirmation-card' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        updateMessage(statusMessageId, {
          content: `历史任务恢复失败：${message}`,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    appendMessage,
    recoverJobId,
    resetChat,
    setActiveJobId,
    setConfirmationMode,
    setHeroImage,
    setInferredSpec,
    setOutputPlan,
    setSourceImage,
    setUserPrompt,
    updateMessage,
  ]);

  React.useEffect(() => {
    if (!sourceImageId || importedSourceRef.current === sourceImageId) return;
    const imageUrl = imageBytesUrl(sourceImageId);
    let cancelled = false;

    resetChat();
    setHeroImage({ url: imageUrl, mime: 'image/png' });
    setSourceImage(null);
    setUserPrompt(null);
    setInferredSpec(null);
    setOutputPlan(null);
    setConfirmationMode(null);
    setActiveJobId(null);
    const imageMessageId = appendMessage({ role: 'user', type: 'image_ref', content: imageUrl });
    const statusMessageId = appendMessage({
      role: 'ai',
      type: 'text',
      content: '正在带入这张图…',
    });

    void importSourceImageFromImageId(sourceImageId)
      .then((imported) => {
        if (cancelled) return;
        const mime = imported.mime ?? 'image/png';
        importedSourceRef.current = sourceImageId;
        setHeroImage({ url: imported.data_url, mime });
        setSourceImage({
          source_image_ref: imported.source_image_ref,
          preview_url: imported.preview_url,
          mime,
        });
        updateMessage(imageMessageId, { content: imported.data_url });
        updateMessage(statusMessageId, {
          content: '输入修改描述后发送即可重新生成。',
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        updateMessage(statusMessageId, {
          content: `图片带入失败：${message}`,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    appendMessage,
    resetChat,
    setActiveJobId,
    setConfirmationMode,
    setHeroImage,
    setInferredSpec,
    setOutputPlan,
    setSourceImage,
    setUserPrompt,
    sourceImageId,
    updateMessage,
  ]);

  React.useEffect(() => {
    if (sourceImageId || recoverJobId) return;
    const params =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const jobIdFromUrl = params?.get('job_id') ?? null;
    const storedJobId =
      typeof window !== 'undefined' ? window.localStorage.getItem(LAST_JOB_STORAGE_KEY) : null;
    const jobId = jobIdFromUrl || storedJobId;
    if (!jobId || jobId === activeJobId) return;
    void resumeJob(jobId);
  }, [activeJobId, recoverJobId, resumeJob, sourceImageId]);

  React.useEffect(() => {
    if (!activeJobId || !isLiveGenerationStatus(job?.status) || typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(LAST_JOB_STORAGE_KEY, activeJobId);
    const params = new URLSearchParams(window.location.search);
    if (params.get('job_id') === activeJobId) return;
    params.set('job_id', activeJobId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [activeJobId, job?.status, pathname, router]);

  React.useEffect(() => {
    if (!job || isLiveGenerationStatus(job.status)) return;
    if (terminalRedirectJobRef.current === job.job_id) return;
    terminalRedirectJobRef.current = job.job_id;
    setActiveJobId(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LAST_JOB_STORAGE_KEY);
    }
  }, [job, setActiveJobId]);

  // Warmup ping to mitigate cold-start latency (B3.5); failures are non-fatal
  React.useEffect(() => {
    fetch(`${apiBase}/api/kits/_warmup/extract`).catch(() => {});
  }, []);

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] grid-rows-[64px_1fr] bg-ink-base">
      <div className="row-span-2">
        <Sidebar />
      </div>
      <div className="col-start-2">
        <Topbar />
      </div>
      <main className="col-start-2 row-start-2 grid min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(520px,3fr)_minmax(320px,2fr)]">
        <section
          data-testid="chat-pane"
          aria-label="套包生成对话"
          className="flex min-h-0 flex-col border-r border-border-subtle bg-surface-01"
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-s-4 py-s-3">
            <div>
              <p className="text-sm font-medium text-ink-primary">新建套包</p>
              <p className="text-xs text-ink-muted">会话会自动暂存，切换页面后可继续</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleStartNewTask}
              className="h-8 px-s-2 text-xs"
            >
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              新任务
            </Button>
          </div>
          <MessageList
            onStart={(spec, plan, rewrittenSpec) => void handleStart(spec, plan, rewrittenSpec)}
            onRewriteBrief={handleRewriteBrief}
          />
          <MessageInput />
        </section>

        <section
          data-testid="grid-pane"
          aria-label="生成图片预览"
          className="min-h-0 overflow-auto p-s-4"
        >
          <GenerationJobPreview
            sourceImage={sourceImage}
            plan={outputPlan}
            job={job}
            phase={genPhase}
            errorMessage={errorMessage}
            onStop={handleStop}
          />
        </section>
      </main>
    </div>
  );
}

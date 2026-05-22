'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { MessageInput } from '@/components/chat/MessageInput';
import { MessageList } from '@/components/chat/MessageList';
import { GenerationJobPreview } from '@/components/generation/GenerationJobPreview';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { useChatStartFlow } from '@/hooks/use-chat-flow';
import { imageBytesUrl, importSourceImageFromImageId } from '@/lib/api/images';
import { useChatStore } from '@/lib/chat/store';

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const LAST_JOB_STORAGE_KEY = 'viskit:new-kit:last-generation-job-id';

function isLiveGenerationStatus(status: string | null | undefined): boolean {
  return (
    status === 'planned' || status === 'queued' || status === 'running' || status === 'stopping'
  );
}

function queuePathFrom(pathname: string): string {
  return pathname.replace(/\/new-kit$/, '/queue') || '/queue';
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
  const importedSourceRef = React.useRef<string | null>(null);
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

  React.useEffect(() => {
    resetChat();
  }, [resetChat]);

  React.useEffect(() => {
    if (!sourceImageId || importedSourceRef.current === sourceImageId) return;
    const imageUrl = imageBytesUrl(sourceImageId);
    let cancelled = false;

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
    if (sourceImageId) return;
    const params =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const jobIdFromUrl = params?.get('job_id') ?? null;
    const storedJobId =
      typeof window !== 'undefined' ? window.localStorage.getItem(LAST_JOB_STORAGE_KEY) : null;
    const jobId = jobIdFromUrl || storedJobId;
    if (!jobId || jobId === activeJobId) return;
    void resumeJob(jobId);
  }, [activeJobId, resumeJob, sourceImageId]);

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
    router.replace(queuePathFrom(pathname), { scroll: false });
  }, [job, pathname, router, setActiveJobId]);

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

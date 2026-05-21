'use client';

import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { MessageInput } from '@/components/chat/MessageInput';
import { MessageList } from '@/components/chat/MessageList';
import { GenerationJobPreview } from '@/components/generation/GenerationJobPreview';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { useChatStartFlow } from '@/hooks/use-chat-flow';
import { useChatStore } from '@/lib/chat/store';

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const LAST_JOB_STORAGE_KEY = 'viskit:new-kit:last-generation-job-id';

export default function NewKitPage() {
  const router = useRouter();
  const pathname = usePathname();
  const resetChat = useChatStore((s) => s.reset);
  const sourceImage = useChatStore((s) => s.source_image);
  const outputPlan = useChatStore((s) => s.output_plan);

  const { handleStart, genPhase, job, activeJobId, errorMessage, handleStop, resumeJob } =
    useChatStartFlow();

  React.useEffect(() => {
    resetChat();
  }, [resetChat]);

  React.useEffect(() => {
    const params =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const jobIdFromUrl = params?.get('job_id') ?? null;
    const storedJobId =
      typeof window !== 'undefined' ? window.localStorage.getItem(LAST_JOB_STORAGE_KEY) : null;
    const jobId = jobIdFromUrl || storedJobId;
    if (!jobId || jobId === activeJobId) return;
    void resumeJob(jobId);
  }, [activeJobId, resumeJob]);

  React.useEffect(() => {
    if (!activeJobId || typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_JOB_STORAGE_KEY, activeJobId);
    const params = new URLSearchParams(window.location.search);
    if (params.get('job_id') === activeJobId) return;
    params.set('job_id', activeJobId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [activeJobId, pathname, router]);

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
          <MessageList onStart={(spec, plan) => void handleStart(spec, plan)} />
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

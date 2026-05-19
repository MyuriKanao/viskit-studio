'use client';

import * as React from 'react';

import { MessageInput } from '@/components/chat/MessageInput';
import { MessageList } from '@/components/chat/MessageList';
import { ImageGrid, type ImageMeta } from '@/components/kit-detail/image-grid';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { useChatStartFlow } from '@/hooks/use-chat-flow';
import { useChatStore } from '@/lib/chat/store';

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export default function NewKitPage() {
  const [images, setImages] = React.useState<ImageMeta[]>([]);
  const resetChat = useChatStore((s) => s.reset);

  const handleProgress = React.useCallback(
    (event: { slot: string; status: ImageMeta['status']; png_path?: string | null }) => {
      setImages((current) => {
        const idx = current.findIndex((img) => img.image_id === event.slot);
        const next: ImageMeta = {
          image_id: event.slot,
          status: event.status,
          png_path: event.png_path ?? (idx >= 0 ? current[idx].png_path : null),
        };
        if (idx < 0) return [...current, next];
        const copy = [...current];
        copy[idx] = next;
        return copy;
      });
    },
    []
  );

  // D3: wire /spec → /generate → redirect
  const { handleStart } = useChatStartFlow(handleProgress);

  React.useEffect(() => {
    resetChat();
  }, [resetChat]);

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
          <MessageList onStart={(spec) => void handleStart(spec)} />
          <MessageInput />
        </section>

        <section
          data-testid="grid-pane"
          aria-label="生成图片预览"
          className="min-h-0 overflow-auto p-s-4"
        >
          <ImageGrid images={images} />
        </section>
      </main>
    </div>
  );
}

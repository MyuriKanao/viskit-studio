'use client';

import * as React from 'react';

import { ConfirmationCard } from '@/components/chat/ConfirmationCard';
import { useChatStore } from '@/lib/chat/store';
import type { ChatMessage, InferredSpec } from '@/lib/chat/types';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface MessageListProps {
  /** Forwarded to ConfirmationCard when a 'card' message is rendered (D2). */
  onStart: (spec: InferredSpec) => void;
}

// ---------------------------------------------------------------------------
// Individual message bubble
// ---------------------------------------------------------------------------
function MessageBubble({
  msg,
  onStart,
}: { msg: ChatMessage; onStart: (spec: InferredSpec) => void }) {
  const isUser = msg.role === 'user';

  // D2: card-type message renders ConfirmationCard inline
  if (msg.type === 'card') {
    return <CardMessage onStart={onStart} />;
  }

  if (msg.type === 'image_ref') {
    return (
      <div
        data-testid={`message-${msg.id}`}
        className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
      >
        <div
          className={cn(
            'max-w-[70%] rounded-xl overflow-hidden',
            isUser ? 'bg-accent text-ink-base-l' : 'bg-surface-02 text-ink-primary'
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={msg.content} alt="uploaded" className="max-h-48 w-auto object-cover" />
          <p className="px-s-3 py-s-2 text-xs opacity-80">图片已上传</p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={`message-${msg.id}`}
      className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'max-w-[70%] rounded-xl px-s-3 py-s-2 text-sm',
          isUser ? 'bg-accent text-ink-base-l' : 'bg-surface-02 text-ink-primary'
        )}
      >
        {msg.content}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card message — reads inferred_spec from store, renders ConfirmationCard
// ---------------------------------------------------------------------------
function CardMessage({ onStart }: { onStart: (spec: InferredSpec) => void }) {
  const inferred_spec = useChatStore((s) => s.inferred_spec);
  const setConfirmationMode = useChatStore((s) => s.setConfirmationMode);

  if (!inferred_spec) {
    // Skeleton while spec is not yet in store (should not normally happen, but be safe)
    return (
      <div
        data-testid="confirmation-card-skeleton"
        className="rounded-xl border border-border-subtle bg-surface-02 p-s-4 animate-pulse h-32"
      />
    );
  }

  return (
    <ConfirmationCard
      inferred={inferred_spec}
      onStart={onStart}
      onModeChange={setConfirmationMode}
    />
  );
}

// ---------------------------------------------------------------------------
// MessageList
// ---------------------------------------------------------------------------
export function MessageList({ onStart }: MessageListProps) {
  const messages = useChatStore((s) => s.messages);
  const messageCount = messages.length;
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (messageCount >= 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messageCount]);

  return (
    <div
      data-testid="message-list"
      className="flex-1 overflow-y-auto px-s-4 py-s-4 flex flex-col gap-s-3"
    >
      {messageCount === 0 && (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">
          上传商品图开始生成套包
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} onStart={onStart} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

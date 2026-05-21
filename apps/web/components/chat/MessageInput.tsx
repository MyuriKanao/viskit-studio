'use client';

import * as React from 'react';

import { useChatImageFlow } from '@/hooks/use-chat-flow';
import { MAX_IMAGE_BYTES } from '@/lib/chat/constants';
import { useChatStore } from '@/lib/chat/store';
import { cn } from '@/lib/utils';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function MessageInput() {
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const appendMessage = useChatStore((s) => s.appendMessage);
  const heroImage = useChatStore((s) => s.hero_image);
  const sourceImage = useChatStore((s) => s.source_image);
  const outputPlan = useChatStore((s) => s.output_plan);
  const confirmation_mode = useChatStore((s) => s.confirmation_mode);

  const { handleImageDrop, isExtracting } = useChatImageFlow();

  const isDisabled = confirmation_mode !== null || isExtracting;
  const isImportedImageWaitingForPrompt = Boolean(heroImage && !outputPlan && !confirmation_mode);
  const isDisabledRef = React.useRef(isDisabled);

  React.useEffect(() => {
    isDisabledRef.current = isDisabled;
  }, [isDisabled]);

  const handleImageFile = React.useCallback(
    async (file: File) => {
      if (isDisabledRef.current) return;
      setError(null);
      if (file.size > MAX_IMAGE_BYTES) {
        setError('图片超过 8 MB 大小限制，请压缩后重试');
        return;
      }
      try {
        const url = await fileToDataUrl(file);
        // Pass current text as optional description alongside the image
        await handleImageDrop(url, file.type, text.trim() || undefined);
        setText('');
      } catch {
        setError('图片读取失败，请重试');
      }
    },
    [handleImageDrop, text]
  );

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || isDisabled) return;
    if (isImportedImageWaitingForPrompt && heroImage) {
      setError(null);
      await handleImageDrop(heroImage.url, heroImage.mime, trimmed, {
        appendImageMessage: false,
        sourceImage,
      });
      setText('');
      return;
    }
    appendMessage({ role: 'user', type: 'text', content: trimmed });
    setText('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // Drag-and-drop handlers
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (isDisabled) return;
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (isDisabled) return;
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      await handleImageFile(file);
    }
  }

  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file || isDisabled) return;
    if (file.type.startsWith('image/')) {
      await handleImageFile(file);
    } else {
      setError('请选择图片文件');
    }
  }

  // Paste handling
  React.useEffect(() => {
    async function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (isDisabledRef.current) return;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            await handleImageFile(file);
            return;
          }
        }
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleImageFile]);

  return (
    <div className="border-t border-border-subtle p-s-3 flex flex-col gap-s-2">
      {error && (
        <div className="rounded-input bg-danger/10 px-s-3 py-s-2 text-xs text-danger">{error}</div>
      )}

      {/* Drop zone */}
      <div
        data-testid="image-drop-zone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'rounded-input border-2 border-dashed px-s-3 py-s-2 text-center text-xs text-ink-faint transition-colors duration-fast',
          isDragOver ? 'border-accent bg-accent/5 text-accent' : 'border-border-subtle',
          isDisabled && 'opacity-50'
        )}
      >
        <input
          ref={fileInputRef}
          data-testid="image-upload-input"
          type="file"
          accept="image/*"
          disabled={isDisabled}
          onChange={handleFileInputChange}
          className="sr-only"
        />
        <div className="flex flex-col items-center justify-center gap-s-2 sm:flex-row">
          <button
            data-testid="image-upload-button"
            type="button"
            disabled={isDisabled}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'inline-flex items-center justify-center rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-1.5 text-xs font-medium text-ink-secondary',
              'transition-colors duration-fast hover:border-accent hover:text-accent',
              'disabled:pointer-events-none disabled:opacity-50'
            )}
          >
            选择图片
          </button>
          <span>或拖拽 / 粘贴图片至此</span>
        </div>
      </div>

      {/* Text input row */}
      <div className="flex gap-s-2">
        <input
          ref={inputRef}
          data-testid="message-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          placeholder={
            isDisabled
              ? '请先完成确认'
              : isImportedImageWaitingForPrompt
                ? '描述想怎么修改这张图…'
                : '输入消息…'
          }
          className={cn(
            'flex-1 rounded-input border border-border-subtle bg-surface-02 px-s-3 py-s-2 text-sm text-ink-primary placeholder:text-ink-faint',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1',
            'disabled:opacity-50 disabled:pointer-events-none'
          )}
        />
        <button
          data-testid="send-button"
          type="button"
          onClick={() => void handleSend()}
          disabled={isDisabled || !text.trim()}
          className={cn(
            'inline-flex items-center justify-center rounded-input bg-accent px-s-4 py-s-2 text-sm font-medium text-ink-base-l',
            'transition-colors duration-fast hover:bg-accent-soft',
            'disabled:opacity-50 disabled:pointer-events-none'
          )}
        >
          {isImportedImageWaitingForPrompt ? '再生成' : '发送'}
        </button>
      </div>
    </div>
  );
}

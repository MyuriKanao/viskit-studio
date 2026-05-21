'use client';

import { Loader2, MousePointer2, Move, Redo2, Type, Undo2, Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCommandStack } from '@/lib/editor/command-stack';
import { cn } from '@/lib/utils';

export type ToolId = 'select' | 'text' | 'move' | 'inpaint' | 'undo' | 'redo';

export interface ToolRailProps {
  activeTool: 'select' | 'text' | 'move' | 'inpaint' | null;
  onToolChange: (tool: 'select' | 'text' | 'move' | 'inpaint') => void;
  onInpaintStart: () => void;
  inpaintStatus: 'idle' | 'streaming' | 'success' | 'error' | 'aborted';
  onInpaintAbort: () => void;
  onUndo: () => void;
  onRedo: () => void;
  hasMask: boolean;
  className?: string;
}

type ButtonState = 'idle' | 'active' | 'disabled' | 'loading';

const STATE_CLASSES: Record<ButtonState, string> = {
  idle: 'bg-transparent text-ink-muted hover:bg-surface-03',
  active: 'bg-accent-wash text-accent ring-1 ring-accent',
  disabled: 'opacity-40 cursor-not-allowed pointer-events-none',
  loading: 'bg-accent-wash text-accent',
};

export function ToolRail({
  activeTool,
  onToolChange,
  onInpaintStart,
  inpaintStatus,
  onInpaintAbort,
  onUndo,
  onRedo,
  hasMask,
  className,
}: ToolRailProps) {
  const t = useTranslations('editor.tools');
  const undoEmpty = useCommandStack((s) => s.undoStack.length === 0);
  const redoEmpty = useCommandStack((s) => s.redoStack.length === 0);
  const isStreaming = inpaintStatus === 'streaming';

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (el?.matches('input, textarea, [contenteditable=true]')) return;

      if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        if (!redoEmpty && !isStreaming) {
          onRedo();
        }
        return;
      }

      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        if (!undoEmpty && !isStreaming) {
          onUndo();
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case 'v':
        case 'V':
          if (!isStreaming) onToolChange('select');
          break;
        case 't':
        case 'T':
          if (!isStreaming) onToolChange('text');
          break;
        case 'm':
        case 'M':
          if (!isStreaming) onToolChange('move');
          break;
        case 'i':
        case 'I':
          if (!isStreaming) {
            if (hasMask) onInpaintStart();
          } else {
            onInpaintAbort();
          }
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isStreaming,
    hasMask,
    undoEmpty,
    redoEmpty,
    onToolChange,
    onInpaintStart,
    onInpaintAbort,
    onUndo,
    onRedo,
  ]);

  function getToolState(id: 'select' | 'text' | 'move'): ButtonState {
    if (isStreaming) return 'disabled';
    return activeTool === id ? 'active' : 'idle';
  }

  function getInpaintState(): ButtonState {
    if (isStreaming) return 'loading';
    if (!hasMask) return 'disabled';
    return activeTool === 'inpaint' ? 'active' : 'idle';
  }

  function getUndoState(): ButtonState {
    if (isStreaming) return 'disabled';
    return undoEmpty ? 'disabled' : 'idle';
  }

  function getRedoState(): ButtonState {
    if (isStreaming) return 'disabled';
    return redoEmpty ? 'disabled' : 'idle';
  }

  const selectState = getToolState('select');
  const textState = getToolState('text');
  const moveState = getToolState('move');
  const inpaintState = getInpaintState();
  const undoState = getUndoState();
  const redoState = getRedoState();

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex flex-col gap-1 rounded-card border border-border-subtle bg-surface-02 p-2',
          className
        )}
        data-testid="tool-rail"
      >
        {/* Select */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-state={selectState}
              data-testid="tool-select"
              className={cn(STATE_CLASSES[selectState])}
              onClick={() => onToolChange('select')}
              aria-label={t('select')}
            >
              <MousePointer2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('select')} (V)</TooltipContent>
        </Tooltip>

        {/* Text */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-state={textState}
              data-testid="tool-text"
              className={cn(STATE_CLASSES[textState])}
              onClick={() => onToolChange('text')}
              aria-label={t('text')}
            >
              <Type className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('text')} (T)</TooltipContent>
        </Tooltip>

        {/* Move */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-state={moveState}
              data-testid="tool-move"
              className={cn(STATE_CLASSES[moveState])}
              onClick={() => onToolChange('move')}
              aria-label={t('move')}
            >
              <Move className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('move')} (M)</TooltipContent>
        </Tooltip>

        {/* Inpaint */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-state={inpaintState}
              data-testid="tool-inpaint"
              className={cn(STATE_CLASSES[inpaintState])}
              onClick={isStreaming ? onInpaintAbort : onInpaintStart}
              aria-label={t('inpaint')}
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('inpaint')} (I)</TooltipContent>
        </Tooltip>

        {/* Undo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-state={undoState}
              data-testid="tool-undo"
              className={cn(STATE_CLASSES[undoState])}
              onClick={onUndo}
              aria-label={t('undo')}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('undo')} (Ctrl+Z)</TooltipContent>
        </Tooltip>

        {/* Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-state={redoState}
              data-testid="tool-redo"
              className={cn(STATE_CLASSES[redoState])}
              onClick={onRedo}
              aria-label={t('redo')}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('redo')} (Ctrl+Shift+Z)</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

'use client';

import { Loader2, MousePointer2, Move, Redo2, Type, Undo2, Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ComponentType, useEffect, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCommandStack } from '@/lib/editor/command-stack';
import { EDITOR_TOOL_REGISTRY, type EditorToolDefinition } from '@/lib/editor/tools';
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
  tools?: readonly EditorToolDefinition[];
  className?: string;
}

type ButtonState = 'idle' | 'active' | 'disabled' | 'loading';

const STATE_CLASSES: Record<ButtonState, string> = {
  idle: 'bg-transparent text-ink-muted hover:bg-surface-03',
  active: 'bg-accent-wash text-accent ring-1 ring-accent',
  disabled: 'opacity-40 cursor-not-allowed pointer-events-none',
  loading: 'bg-accent-wash text-accent',
};

const TOOL_ICONS = {
  select: MousePointer2,
  move: Move,
  text: Type,
  inpaint: Wand2,
} satisfies Record<'select' | 'move' | 'text' | 'inpaint', ComponentType<{ className?: string }>>;

export function ToolRail({
  activeTool,
  onToolChange,
  onInpaintStart,
  inpaintStatus,
  onInpaintAbort,
  onUndo,
  onRedo,
  hasMask,
  tools = EDITOR_TOOL_REGISTRY,
  className,
}: ToolRailProps) {
  const t = useTranslations('editor.tools');
  const undoEmpty = useCommandStack((s) => s.undoStack.length === 0);
  const redoEmpty = useCommandStack((s) => s.redoStack.length === 0);
  const isStreaming = inpaintStatus === 'streaming';
  const visibleTools = useMemo(() => tools.filter((tool) => tool.id in TOOL_ICONS), [tools]);
  const visibleToolIds = useMemo(
    () => new Set(visibleTools.map((tool) => tool.id)),
    [visibleTools]
  );

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
          if (!isStreaming && visibleToolIds.has('select')) onToolChange('select');
          break;
        case 't':
        case 'T':
          if (!isStreaming && visibleToolIds.has('text')) onToolChange('text');
          break;
        case 'm':
        case 'M':
          if (!isStreaming && visibleToolIds.has('move')) onToolChange('move');
          break;
        case 'i':
        case 'I':
          if (!visibleToolIds.has('inpaint')) return;
          if (isStreaming) {
            onInpaintAbort();
          } else if (activeTool === 'inpaint' && hasMask) {
            onInpaintStart();
          } else {
            onToolChange('inpaint');
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
    activeTool,
    visibleToolIds,
  ]);

  function getToolState(id: 'select' | 'text' | 'move' | 'inpaint'): ButtonState {
    if (isStreaming) return 'disabled';
    return activeTool === id ? 'active' : 'idle';
  }

  function getInpaintState(): ButtonState {
    if (isStreaming) return 'loading';
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

  const undoState = getUndoState();
  const redoState = getRedoState();

  function handleToolClick(id: 'select' | 'text' | 'move' | 'inpaint') {
    if (id !== 'inpaint') {
      onToolChange(id);
      return;
    }
    if (isStreaming) {
      onInpaintAbort();
      return;
    }
    if (activeTool === 'inpaint' && hasMask) {
      onInpaintStart();
      return;
    }
    onToolChange('inpaint');
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex flex-col gap-1 rounded-card border border-border-subtle bg-surface-02 p-2',
          className
        )}
        data-testid="tool-rail"
      >
        {visibleTools.map((tool) => {
          const id = tool.id as 'select' | 'text' | 'move' | 'inpaint';
          const state = id === 'inpaint' ? getInpaintState() : getToolState(id);
          const Icon = id === 'inpaint' && isStreaming ? Loader2 : TOOL_ICONS[id];
          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  data-state={state}
                  data-testid={tool.testId}
                  className={cn(STATE_CLASSES[state])}
                  disabled={state === 'disabled'}
                  onClick={() => handleToolClick(id)}
                  aria-label={t(tool.id)}
                >
                  <Icon
                    className={cn('h-4 w-4', isStreaming && id === 'inpaint' && 'animate-spin')}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t(tool.id)}
                {tool.shortcut ? ` (${tool.shortcut})` : null}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Undo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-state={undoState}
              data-testid="tool-undo"
              className={cn(STATE_CLASSES[undoState])}
              disabled={undoState === 'disabled'}
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
              disabled={redoState === 'disabled'}
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

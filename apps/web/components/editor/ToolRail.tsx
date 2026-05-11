'use client';

import {
  Loader2,
  type LucideIcon,
  MousePointer2,
  Move,
  Redo2,
  Type,
  Undo2,
  Wand2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCommandStack } from '@/lib/editor/command-stack';
import { cn } from '@/lib/utils';

export type ToolId = 'select' | 'text' | 'move' | 'inpaint' | 'undo' | 'redo';

type Tool = 'select' | 'text' | 'move' | 'inpaint';

type InpaintStatus = 'idle' | 'streaming' | 'success' | 'error' | 'aborted';

export interface ToolRailProps {
  activeTool: Tool | null;
  onToolChange: (tool: Tool) => void;
  onInpaintStart: () => void;
  inpaintStatus: InpaintStatus;
  onInpaintAbort: () => void;
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

interface RailButtonProps {
  id: ToolId;
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  shortcut: string;
  state: ButtonState;
  onClick: () => void;
}

function RailButton({
  id,
  icon: Icon,
  iconClassName,
  label,
  shortcut,
  state,
  onClick,
}: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-state={state}
          data-testid={`tool-${id}`}
          className={STATE_CLASSES[state]}
          onClick={onClick}
          aria-label={label}
        >
          <Icon className={cn('h-4 w-4', iconClassName)} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label} ({shortcut})
      </TooltipContent>
    </Tooltip>
  );
}

export function ToolRail({
  activeTool,
  onToolChange,
  onInpaintStart,
  inpaintStatus,
  onInpaintAbort,
  hasMask,
  className,
}: ToolRailProps) {
  const t = useTranslations('editor.tools');
  const undoEmpty = useCommandStack((s) => s.undoStack.length === 0);
  const redoEmpty = useCommandStack((s) => s.redoStack.length === 0);
  const isStreaming = inpaintStatus === 'streaming';

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (el?.matches('input, textarea, [contenteditable=true]')) return;

      if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        if (!redoEmpty && !isStreaming) useCommandStack.getState().redo();
        return;
      }

      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        if (!undoEmpty && !isStreaming) useCommandStack.getState().undo();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'v' && !isStreaming) onToolChange('select');
      else if (key === 't' && !isStreaming) onToolChange('text');
      else if (key === 'm' && !isStreaming) onToolChange('move');
      else if (key === 'i') {
        if (isStreaming) onInpaintAbort();
        else if (hasMask) onInpaintStart();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isStreaming, hasMask, undoEmpty, redoEmpty, onToolChange, onInpaintStart, onInpaintAbort]);

  const toolState = (id: Tool): ButtonState => {
    if (isStreaming && id !== 'inpaint') return 'disabled';
    return activeTool === id ? 'active' : 'idle';
  };

  const inpaintState: ButtonState = isStreaming
    ? 'loading'
    : !hasMask
      ? 'disabled'
      : activeTool === 'inpaint'
        ? 'active'
        : 'idle';

  const stackButtonState = (empty: boolean): ButtonState =>
    isStreaming || empty ? 'disabled' : 'idle';

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex flex-col gap-1 rounded-card border border-border-subtle bg-surface-02 p-2',
          className
        )}
        data-testid="tool-rail"
      >
        <RailButton
          id="select"
          icon={MousePointer2}
          label={t('select')}
          shortcut="V"
          state={toolState('select')}
          onClick={() => onToolChange('select')}
        />
        <RailButton
          id="text"
          icon={Type}
          label={t('text')}
          shortcut="T"
          state={toolState('text')}
          onClick={() => onToolChange('text')}
        />
        <RailButton
          id="move"
          icon={Move}
          label={t('move')}
          shortcut="M"
          state={toolState('move')}
          onClick={() => onToolChange('move')}
        />
        <RailButton
          id="inpaint"
          icon={isStreaming ? Loader2 : Wand2}
          iconClassName={isStreaming ? 'animate-spin' : undefined}
          label={t('inpaint')}
          shortcut="I"
          state={inpaintState}
          onClick={isStreaming ? onInpaintAbort : onInpaintStart}
        />
        <RailButton
          id="undo"
          icon={Undo2}
          label={t('undo')}
          shortcut="Ctrl+Z"
          state={stackButtonState(undoEmpty)}
          onClick={() => useCommandStack.getState().undo()}
        />
        <RailButton
          id="redo"
          icon={Redo2}
          label={t('redo')}
          shortcut="Ctrl+Shift+Z"
          state={stackButtonState(redoEmpty)}
          onClick={() => useCommandStack.getState().redo()}
        />
      </div>
    </TooltipProvider>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CanvasStageProps } from '@/components/editor/CanvasStage';
import { HistoryTimeline } from '@/components/editor/HistoryTimeline';
import { LayerPanel } from '@/components/editor/LayerPanel';
import { TextLayerOverlay } from '@/components/editor/TextLayerOverlay';
import { ToolOptionsPanel } from '@/components/editor/ToolOptionsPanel';
import { ToolRail } from '@/components/editor/ToolRail';
import { useInpaint } from '@/hooks/use-inpaint';
import type { OcrBox } from '@/hooks/use-ocr';
import {
  type EditorProjectResponse,
  type ImageSaveMode,
  createEditResultFromDataUrl,
  getEditorProject,
  imageBytesUrl,
  importEditorProject,
  saveEditedImage,
  saveEditorProject,
} from '@/lib/api/images';
import { useCommandStack } from '@/lib/editor/command-stack';
import type { ViskitEditorDocument } from '@/lib/editor/document';
import {
  EDITOR_RASTER_EXPORT_FORMATS,
  downloadDataUrl,
  downloadText,
  safeDownloadName,
} from '@/lib/editor/downloads';
import { deserializeEditorDocument, serializeEditorDocument } from '@/lib/editor/serialization';
import { getEditorTestHooks } from '@/lib/editor/test-hooks';
import {
  type EditorToolConfig,
  type RegisteredToolId,
  resolveDefaultTool,
  resolveEnabledTools,
} from '@/lib/editor/tools';
import type {
  CanvasStageHandle,
  EditorActiveTool,
  EditorLayerSummary,
  MaskBox,
} from '@/lib/editor/types';
import { cn } from '@/lib/utils';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';

// CanvasStage uses fabric.js which touches `document` at module init —
// must be dynamically imported with ssr: false. The dynamic() typing in
// Next 14 doesn't natively expose ref-forwarding even though the runtime
// supports it (v13+), so we cast to a ForwardRef component shape.
const CanvasStage = dynamic(
  () => import('@/components/editor/CanvasStage').then((m) => m.CanvasStage),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="canvas-skeleton"
        className="size-full animate-pulse rounded-card bg-surface-02"
      />
    ),
  }
) as unknown as React.ForwardRefExoticComponent<
  CanvasStageProps & React.RefAttributes<CanvasStageHandle>
>;

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 1536;

export interface EditorRootProps {
  imageId: string;
  config?: EditorToolConfig;
  sourceImageRef?: string | null;
  autoLoadProject?: boolean;
  className?: string;
  onProjectLoad?: (document: ViskitEditorDocument, project: EditorProjectResponse | null) => void;
  onProjectSave?: (project: EditorProjectResponse) => void;
  onProjectExport?: (document: ViskitEditorDocument) => void;
  onError?: (error: Error) => void;
}

export interface EditorRootHandle {
  getProjectDocument: () => ViskitEditorDocument | null;
  exportProjectJson: () => string | null;
  exportImageDataUrl: (options?: {
    format?: 'png' | 'jpeg' | 'webp';
    quality?: number;
  }) => string | null;
  saveProject: () => Promise<EditorProjectResponse>;
  loadProject: (payload: string | ViskitEditorDocument) => Promise<void>;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type ProjectStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'exported' | 'error';

export const EditorRoot = React.forwardRef<EditorRootHandle, EditorRootProps>(function EditorRoot(
  {
    imageId,
    config,
    sourceImageRef = null,
    autoLoadProject = false,
    className,
    onProjectLoad,
    onProjectSave,
    onProjectExport,
    onError,
  },
  ref
) {
  const t = useTranslations('editor');
  const locale = useLocale() as 'zh' | 'en';
  const router = useRouter();
  const enabledTools = React.useMemo(() => resolveEnabledTools(config), [config]);
  const enabledToolIds = React.useMemo(
    () => new Set<RegisteredToolId>(enabledTools.map((tool) => tool.id as RegisteredToolId)),
    [enabledTools]
  );
  const defaultTool = React.useMemo(() => resolveDefaultTool(config), [config]);
  const [activeTool, setActiveTool] = useState<EditorActiveTool>(
    (defaultTool?.id as EditorActiveTool) ?? 'select'
  );
  const [maskBox, setMaskBox] = useState<MaskBox | null>(null);
  const [layers, setLayers] = useState<EditorLayerSummary[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const hasMask = maskBox !== null;
  const canvasRef = useRef<CanvasStageHandle | null>(null);
  const inpaint = useInpaint();
  const [pendingEditResultRef, setPendingEditResultRef] = useState<string | null>(null);
  const [hasLocalCanvasEdits, setHasLocalCanvasEdits] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>('idle');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectRevision, setProjectRevision] = useState<number | null>(null);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);

  const imageUrl = imageBytesUrl(imageId);
  const selectedLayer =
    layers.find((layer) => layer.id === selectedLayerId) ??
    layers.find((layer) => layer.selected) ??
    null;

  useEffect(() => {
    if (activeTool && !enabledToolIds.has(activeTool as RegisteredToolId)) {
      setActiveTool((defaultTool?.id as EditorActiveTool) ?? null);
    }
  }, [activeTool, defaultTool, enabledToolIds]);

  const markLocalCanvasEdit = useCallback(() => {
    setHasLocalCanvasEdits(true);
    setSaveStatus('idle');
    setSaveError(null);
  }, []);

  const handleInpaintStart = useCallback(() => {
    if (!maskBox) return;
    void inpaint.start(imageId, { mask_box: maskBox, new_text: '' });
  }, [imageId, inpaint, maskBox]);

  const handleBoxClick = useCallback(
    (index: number, box: OcrBox) => {
      if (activeTool === 'text') {
        canvasRef.current?.upsertTextLayerFromOcr(index, box);
        markLocalCanvasEdit();
        return;
      }
      canvasRef.current?.selectByOcrIndex(index);
    },
    [activeTool, markLocalCanvasEdit]
  );

  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
    setHasLocalCanvasEdits(useCommandStack.getState().undoStack.length > 0);
    setSaveStatus('idle');
  }, []);

  const handleLayersChange = useCallback((nextLayers: EditorLayerSummary[]) => {
    setLayers(nextLayers);
  }, []);

  const handleSelectionChange = useCallback((layerId: string | null) => {
    setSelectedLayerId(layerId);
  }, []);

  const handleLayerSelect = useCallback((layerId: string) => {
    canvasRef.current?.selectLayerById(layerId);
    setSelectedLayerId(layerId);
  }, []);

  const handleLayerVisibilityToggle = useCallback((layerId: string, visible: boolean) => {
    canvasRef.current?.setLayerVisibility(layerId, visible);
  }, []);

  const handleLayerLockedToggle = useCallback((layerId: string, locked: boolean) => {
    canvasRef.current?.setLayerLocked(layerId, locked);
  }, []);

  const handleLayerMove = useCallback((layerId: string, direction: 'up' | 'down') => {
    canvasRef.current?.moveLayer(layerId, direction);
  }, []);

  const handleLayerDelete = useCallback((layerId: string) => {
    canvasRef.current?.deleteLayer(layerId);
  }, []);

  const handleLayerOpacityChange = useCallback((layerId: string, opacity: number) => {
    canvasRef.current?.setLayerOpacity(layerId, opacity);
  }, []);

  const handleRedo = useCallback(() => {
    canvasRef.current?.redo();
    setHasLocalCanvasEdits(useCommandStack.getState().undoStack.length > 0);
    setSaveStatus('idle');
  }, []);

  // Surface focused editor drivers only when the explicit editor test-hook flag is enabled.
  useEffect(() => {
    const hooks = getEditorTestHooks();
    if (!hooks) return;
    hooks.setMaskBox = setMaskBox;
    hooks.setActiveTool = setActiveTool;
  }, []);

  // On inpaint success: snapshot the canvas to history and clear the mask
  // affordance so the operator can draw a new region. The Inpaint button
  // disables again until the next mask is committed (hasMask flips false).
  useEffect(() => {
    if (inpaint.status !== 'success') return;
    const editResultRef =
      inpaint.editResultRef ??
      (typeof inpaint.lastEvent?.data.edit_result_ref === 'string'
        ? inpaint.lastEvent.data.edit_result_ref
        : null);
    const snapshot = canvasRef.current?.exportFabricSnapshot() ?? {};
    useCommandStack.getState().push({
      id: `${imageId}-${Date.now()}`,
      op_type: 'inpaint',
      payload: maskBox,
      snapshot_json: JSON.stringify(snapshot),
      ts: Date.now(),
    });
    canvasRef.current?.clearMaskRect();
    setMaskBox(null);
    if (editResultRef) {
      setPendingEditResultRef(editResultRef);
      setSaveStatus('idle');
      setSaveError(null);
    }
    inpaint.reset();
  }, [inpaint, imageId, maskBox]);

  const handleSaveEdit = useCallback(
    async (mode: ImageSaveMode) => {
      if ((!pendingEditResultRef && !hasLocalCanvasEdits) || saveStatus === 'saving') return;
      setSaveStatus('saving');
      setSaveError(null);
      try {
        let editResultRef = pendingEditResultRef;
        if (!editResultRef) {
          const dataUrl = canvasRef.current?.exportPngDataUrl();
          if (!dataUrl) throw new Error('Canvas export failed');
          const result = await createEditResultFromDataUrl(imageId, dataUrl, {
            op_type: 'canvas_text',
            command_count: useCommandStack.getState().undoStack.length,
          });
          editResultRef = result.edit_result_ref;
        }
        const saved = await saveEditedImage(imageId, {
          edit_result_ref: editResultRef,
          mode,
        });
        setPendingEditResultRef(null);
        setHasLocalCanvasEdits(false);
        useCommandStack.getState().clear();
        setSaveStatus('saved');
        if (saved.image_id !== imageId) {
          const prefix = locale === 'zh' ? '' : `/${locale}`;
          router.replace(`${prefix}/editor/${encodeURIComponent(saved.image_id)}`);
        }
      } catch (err) {
        setSaveError((err as Error).message);
        setSaveStatus('error');
      }
    },
    [hasLocalCanvasEdits, imageId, locale, pendingEditResultRef, router, saveStatus]
  );

  const getCurrentProjectDocument = useCallback(() => {
    return (
      canvasRef.current?.exportEditorDocument({
        imageId,
        imageUrl,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        activeToolId: activeTool ?? 'select',
        enabledToolGroups: [...new Set(enabledTools.map((tool) => tool.group))],
      }) ?? null
    );
  }, [activeTool, enabledTools, imageId, imageUrl]);

  const requireCurrentProjectDocument = useCallback(() => {
    const document = getCurrentProjectDocument();
    if (!document) throw new Error(t('project.canvasNotReady'));
    return document;
  }, [getCurrentProjectDocument, t]);

  const applyProjectDocument = useCallback(
    async (document: ViskitEditorDocument, project: EditorProjectResponse | null) => {
      await canvasRef.current?.loadEditorDocument(document);
      setProjectRevision(project?.revision ?? null);
      setHasLocalCanvasEdits(false);
      setPendingEditResultRef(null);
      setSaveStatus('idle');
      setProjectError(null);
      const projectTool = document.toolState.activeToolId as EditorActiveTool;
      if (projectTool && enabledToolIds.has(projectTool as RegisteredToolId)) {
        setActiveTool(projectTool);
      }
      onProjectLoad?.(document, project);
    },
    [enabledToolIds, onProjectLoad]
  );

  const handleOpenProject = useCallback(async () => {
    setProjectStatus('loading');
    setProjectError(null);
    try {
      const project = await getEditorProject(imageId);
      if (!project) {
        setProjectStatus('error');
        setProjectError(t('project.notFound'));
        return null;
      }
      const document = deserializeEditorDocument(JSON.stringify(project.document));
      await applyProjectDocument(document, project);
      setProjectStatus('saved');
      return project;
    } catch (err) {
      const error = err as Error;
      setProjectStatus('error');
      setProjectError(error.message);
      onError?.(error);
      return null;
    }
  }, [applyProjectDocument, imageId, onError, t]);

  const handleSaveProject = useCallback(async () => {
    setProjectStatus('saving');
    setProjectError(null);
    try {
      const document = requireCurrentProjectDocument();
      const project = await saveEditorProject(imageId, document, {
        sourceImageRef,
        expectedRevision: projectRevision,
      });
      setProjectRevision(project.revision);
      setProjectStatus('saved');
      setHasLocalCanvasEdits(false);
      onProjectSave?.(project);
      return project;
    } catch (err) {
      const error = err as Error;
      setProjectStatus('error');
      setProjectError(error.message);
      onError?.(error);
      throw error;
    }
  }, [
    imageId,
    onError,
    onProjectSave,
    projectRevision,
    requireCurrentProjectDocument,
    sourceImageRef,
  ]);

  const handleExportProject = useCallback(() => {
    try {
      const document = requireCurrentProjectDocument();
      downloadText(
        safeDownloadName(imageId, 'viskit-project.json'),
        serializeEditorDocument(document)
      );
      setProjectStatus('exported');
      setProjectError(null);
      onProjectExport?.(document);
    } catch (err) {
      const error = err as Error;
      setProjectStatus('error');
      setProjectError(error.message);
      onError?.(error);
    }
  }, [imageId, onError, onProjectExport, requireCurrentProjectDocument]);

  const handleExportImage = useCallback(
    (format: 'png' | 'jpeg' | 'webp') => {
      const dataUrl = canvasRef.current?.exportImageDataUrl({
        format,
        quality: format === 'png' ? undefined : 0.92,
      });
      if (!dataUrl) {
        const error = new Error(t('project.canvasNotReady'));
        setProjectStatus('error');
        setProjectError(error.message);
        onError?.(error);
        return;
      }
      downloadDataUrl(safeDownloadName(imageId, format), dataUrl);
      setProjectStatus('exported');
      setProjectError(null);
    },
    [imageId, onError, t]
  );

  const handleProjectFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      setProjectStatus('loading');
      setProjectError(null);
      try {
        const document = deserializeEditorDocument(await file.text());
        await applyProjectDocument(document, null);
        const project = await importEditorProject(imageId, document, {
          sourceImageRef,
          expectedRevision: projectRevision,
        });
        setProjectRevision(project.revision);
        setProjectStatus('saved');
        onProjectSave?.(project);
      } catch (err) {
        const error = err as Error;
        setProjectStatus('error');
        setProjectError(error.message);
        onError?.(error);
      }
    },
    [applyProjectDocument, imageId, onError, onProjectSave, projectRevision, sourceImageRef]
  );

  useEffect(() => {
    if (!autoLoadProject) return;
    const timer = window.setTimeout(() => {
      void handleOpenProject();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [autoLoadProject, handleOpenProject]);

  React.useImperativeHandle(
    ref,
    () => ({
      getProjectDocument: getCurrentProjectDocument,
      exportProjectJson: () => {
        const document = getCurrentProjectDocument();
        return document ? serializeEditorDocument(document) : null;
      },
      exportImageDataUrl: (options) => canvasRef.current?.exportImageDataUrl(options) ?? null,
      saveProject: handleSaveProject,
      loadProject: async (payload) => {
        const document =
          typeof payload === 'string'
            ? deserializeEditorDocument(payload)
            : deserializeEditorDocument(JSON.stringify(payload));
        await applyProjectDocument(document, null);
      },
    }),
    [applyProjectDocument, getCurrentProjectDocument, handleSaveProject]
  );

  const projectBusy = projectStatus === 'loading' || projectStatus === 'saving';

  return (
    <div className={cn('flex h-screen flex-col bg-surface-01 text-ink-primary', className)}>
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface-02 px-s-5 py-s-3">
        <span className="font-display text-ink-primary">{t('title')}</span>
        <div className="flex flex-wrap items-center justify-end gap-s-2 text-xs">
          <input
            ref={projectFileInputRef}
            type="file"
            accept="application/json,.json,.viskit-project.json"
            className="hidden"
            onChange={(event) => void handleProjectFileChange(event)}
          />
          <button
            type="button"
            disabled={projectBusy}
            onClick={() => void handleOpenProject()}
            className="rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-1 text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('project.open')}
          </button>
          <button
            type="button"
            disabled={projectBusy}
            onClick={() => void handleSaveProject().catch(() => undefined)}
            className="rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-1 text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('project.save')}
          </button>
          <button
            type="button"
            disabled={projectBusy}
            onClick={() => projectFileInputRef.current?.click()}
            className="rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-1 text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('project.import')}
          </button>
          <button
            type="button"
            disabled={projectBusy}
            onClick={handleExportProject}
            className="rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-1 text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('project.exportJson')}
          </button>
          {EDITOR_RASTER_EXPORT_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              disabled={projectBusy}
              onClick={() => handleExportImage(format)}
              className="rounded-input border border-border-subtle bg-surface-01 px-s-2 py-s-1 uppercase text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {format}
            </button>
          ))}
          {pendingEditResultRef || hasLocalCanvasEdits ? (
            <>
              <span className="text-ink-muted">{t('save.pending')}</span>
              <button
                type="button"
                disabled={saveStatus === 'saving'}
                onClick={() => void handleSaveEdit('replace')}
                className="rounded-input border border-border-subtle bg-surface-01 px-s-3 py-s-1 text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('save.replace')}
              </button>
              <button
                type="button"
                disabled={saveStatus === 'saving'}
                onClick={() => void handleSaveEdit('copy')}
                className="rounded-input bg-accent px-s-3 py-s-1 text-ink-base-l transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('save.copy')}
              </button>
            </>
          ) : saveStatus === 'saved' ? (
            <span className="text-success">{t('save.saved')}</span>
          ) : null}
          {saveStatus === 'error' && saveError ? (
            <span className="text-danger" role="alert">
              {t('save.error')}: {saveError}
            </span>
          ) : null}
          {projectStatus !== 'idle' && (
            <span
              className={cn(projectStatus === 'error' ? 'text-danger' : 'text-ink-muted')}
              role={projectStatus === 'error' ? 'alert' : undefined}
            >
              {projectStatus === 'error' && projectError
                ? `${t('project.error')}: ${projectError}`
                : t(`project.status.${projectStatus}`)}
            </span>
          )}
        </div>
      </header>

      {/* Middle row: ToolRail + canvas area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tool rail */}
        <ToolRail
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onInpaintStart={handleInpaintStart}
          onInpaintAbort={inpaint.abort}
          onUndo={handleUndo}
          onRedo={handleRedo}
          inpaintStatus={inpaint.status}
          hasMask={hasMask}
          tools={enabledTools}
          className="shrink-0 m-s-3"
        />

        {/* Canvas region */}
        <div className="flex flex-1 items-center justify-center overflow-auto p-s-5">
          <div className="relative" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
            <CanvasStage
              ref={canvasRef}
              imageId={imageId}
              imageUrl={imageUrl}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              activeTool={activeTool}
              onMaskChange={setMaskBox}
              onLocalEdit={markLocalCanvasEdit}
              onLayersChange={handleLayersChange}
              onSelectionChange={handleSelectionChange}
              imageLoadErrorLabel={t('canvas.imageLoadError')}
            />
            {/* TextLayerOverlay stacked absolute over canvas */}
            <TextLayerOverlay
              imageId={imageId}
              canvasWidth={CANVAS_WIDTH}
              canvasHeight={CANVAS_HEIGHT}
              onBoxClick={handleBoxClick}
              className="absolute inset-0"
            />
          </div>
        </div>

        <div className="flex w-[320px] shrink-0 flex-col gap-s-3 overflow-y-auto border-l border-border-subtle bg-surface-01 p-s-3">
          <LayerPanel
            layers={layers}
            selectedLayerId={selectedLayerId}
            onSelectLayer={handleLayerSelect}
            onToggleVisibility={handleLayerVisibilityToggle}
            onToggleLocked={handleLayerLockedToggle}
            onMoveLayer={handleLayerMove}
            onDeleteLayer={handleLayerDelete}
            onChangeOpacity={handleLayerOpacityChange}
          />
          <ToolOptionsPanel
            activeTool={activeTool}
            selectedLayer={selectedLayer}
            maskBox={maskBox}
            inpaintStatus={inpaint.status}
            onInpaintStart={handleInpaintStart}
            onInpaintAbort={inpaint.abort}
          />
        </div>
      </div>

      {/* Bottom: history timeline */}
      <div className="m-s-3">
        <HistoryTimeline />
      </div>
    </div>
  );
});

EditorRoot.displayName = 'EditorRoot';

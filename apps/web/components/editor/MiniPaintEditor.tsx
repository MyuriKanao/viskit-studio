'use client';

import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import * as React from 'react';

import {
  type ImageSaveMode,
  createEditResultFromDataUrl,
  imageBytesUrl,
  saveEditedImage,
} from '@/lib/api/images';
import { cn } from '@/lib/utils';

type MiniPaintLayers = {
  reset_layers: (autoInsert?: boolean) => Promise<unknown>;
  insert: (settings: Record<string, unknown>, canAutomate?: boolean) => Promise<unknown>;
  get_dimensions: () => { width: number; height: number };
  convert_layers_to_canvas: (ctx: CanvasRenderingContext2D) => void;
  Base_gui?: {
    set_size: (width: number, height: number) => void;
    GUI_preview?: {
      zoom: (value: number) => void;
    };
  };
};

type MiniPaintWindow = Window & {
  AppConfig?: { layers?: unknown[] };
  Layers?: MiniPaintLayers;
  FileOpen?: unknown;
  FileSave?: unknown;
  State?: unknown;
  initMiniPaint?: () => void;
  __viskit_embedded_minipaint?: boolean;
  __minipaint_bundle_loading?: Promise<void>;
  __minipaint_initialized?: boolean;
};

type LoadState = 'loading' | 'ready' | 'saving' | 'error';

export interface MiniPaintEditorProps {
  imageId?: string;
  className?: string;
}

function ensureMiniPaintTheme(): void {
  if (document.querySelector('link[data-minipaint-viskit-theme]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/minipaint/viskit-theme.css';
  link.dataset.minipaintViskitTheme = 'true';
  document.head.appendChild(link);
}

function ensureMiniPaintBundle(): Promise<void> {
  const globalWindow = window as MiniPaintWindow;
  globalWindow.__viskit_embedded_minipaint = true;
  ensureMiniPaintTheme();
  if (globalWindow.Layers && document.querySelector('#main_menu .menu_bar')) {
    return Promise.resolve();
  }
  if (globalWindow.__minipaint_bundle_loading) return globalWindow.__minipaint_bundle_loading;

  globalWindow.__minipaint_bundle_loading = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-minipaint-bundle]');
    if (existing) {
      globalWindow.initMiniPaint?.();
      resolve();
      globalWindow.__minipaint_bundle_loading = undefined;
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('minipaint_bundle_load_error')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = '/minipaint/dist/bundle.js';
    script.async = true;
    script.dataset.minipaintBundle = 'true';
    script.onload = () => {
      ensureMiniPaintTheme();
      globalWindow.__minipaint_bundle_loading = undefined;
      resolve();
    };
    script.onerror = () => {
      globalWindow.__minipaint_bundle_loading = undefined;
      reject(new Error('minipaint_bundle_load_error'));
    };
    document.body.appendChild(script);
  });

  return globalWindow.__minipaint_bundle_loading;
}

function waitForMiniPaint(): Promise<MiniPaintLayers> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const globalWindow = window as MiniPaintWindow;
      if (globalWindow.Layers) {
        window.clearInterval(timer);
        resolve(globalWindow.Layers);
        return;
      }

      globalWindow.initMiniPaint?.();

      if (attempts > 120) {
        window.clearInterval(timer);
        reject(new Error('minipaint_init_timeout'));
      }
    }, 50);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('source_image_decode_error'));
    image.src = src;
  });
}

function resetMiniPaintRuntime(): void {
  const globalWindow = window as MiniPaintWindow;
  globalWindow.__minipaint_initialized = false;
  globalWindow.Layers = undefined;
  globalWindow.AppConfig = undefined;
  globalWindow.State = undefined;
  globalWindow.FileOpen = undefined;
  globalWindow.FileSave = undefined;
  globalWindow.__viskit_embedded_minipaint = false;
  globalWindow.__minipaint_bundle_loading = undefined;
}

const MiniPaintWorkspace = React.memo(function MiniPaintWorkspace() {
  return (
    <>
      <nav aria-label="主菜单" className="main_menu" id="main_menu" />
      <div className="wrapper">
        <div className="submenu">
          <a className="logo" href="#main_wrapper">
            Viskit Studio
          </a>
          <div className="block attributes" id="action_attributes" />
          <button className="undo_button" id="undo_button" type="button">
            <span className="sr_only">撤销</span>
          </button>
        </div>

        <div className="sidebar_left" id="tools_container" />

        <div className="middle_area" id="middle_area">
          <canvas className="ruler_left" id="ruler_left" />
          <canvas className="ruler_top" id="ruler_top" />

          <div className="main_wrapper" id="main_wrapper">
            <div className="canvas_wrapper" id="canvas_wrapper">
              <div id="mouse" />
              <div className="transparent-grid" id="canvas_minipaint_background" />
              <canvas id="canvas_minipaint">
                <div className="trn error">你的浏览器不支持 canvas，或 JavaScript 未启用。</div>
              </canvas>
            </div>
          </div>
        </div>

        <div className="sidebar_right">
          <div className="preview block">
            <h2 className="trn toggle" data-target="toggle_preview">
              Preview
            </h2>
            <div id="toggle_preview" />
          </div>

          <div className="colors block">
            <h2 className="trn toggle" data-target="toggle_colors">
              Colors
            </h2>
            <div className="content" id="toggle_colors" />
          </div>

          <div className="block" id="info_base">
            <h2 className="trn toggle toggle-full" data-target="toggle_info">
              Information
            </h2>
            <div className="content" id="toggle_info" />
          </div>

          <div className="details block" id="details_base">
            <h2 className="trn toggle toggle-full" data-target="toggle_details">
              Layer details
            </h2>
            <div className="content details-content" id="toggle_details" />
          </div>

          <div className="layers block">
            <h2 className="trn">Layers</h2>
            <div className="content" id="layers_base" />
          </div>
        </div>
      </div>
    </>
  );
});

export function MiniPaintEditor({ imageId, className }: MiniPaintEditorProps) {
  const t = useTranslations('editor');
  const locale = useLocale();
  const homeHref = locale === 'zh' ? '/' : `/${locale}`;
  const objectUrlRef = React.useRef<string | null>(null);
  const loadAbortRef = React.useRef<AbortController | null>(null);
  const loadSequenceRef = React.useRef(0);
  const mountedRef = React.useRef(false);
  const [state, setState] = React.useState<LoadState>('loading');
  const [message, setMessage] = React.useState<string>(t('miniPaint.loading'));
  const [savedImageId, setSavedImageId] = React.useState<string | null>(null);

  const describeError = React.useCallback(
    (error: unknown, fallback: string) => {
      if (!(error instanceof Error)) return fallback;

      if (error.message.startsWith(t('canvas.imageLoadError'))) {
        return error.message;
      }

      switch (error.message) {
        case 'minipaint_bundle_load_error':
          return t('miniPaint.errors.bundle');
        case 'minipaint_init_timeout':
          return t('miniPaint.errors.init');
        case 'source_image_decode_error':
          return t('miniPaint.errors.decode');
        default:
          if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
            return t('miniPaint.errors.network');
          }
          return fallback;
      }
    },
    [t]
  );

  const revokeObjectUrl = React.useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    document.body.classList.add('viskit-minipaint-body');

    return () => {
      mountedRef.current = false;
      loadAbortRef.current?.abort();
      revokeObjectUrl();
      resetMiniPaintRuntime();
      document.body.classList.remove('viskit-minipaint-body');
      document.querySelector('link[data-minipaint-viskit-theme]')?.remove();
    };
  }, [revokeObjectUrl]);

  const loadCurrentImage = React.useCallback(async () => {
    const loadId = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadId;
    loadAbortRef.current?.abort();
    const abortController = new AbortController();
    loadAbortRef.current = abortController;

    setState('loading');
    setMessage(t('miniPaint.loading'));
    setSavedImageId(null);

    try {
      await ensureMiniPaintBundle();
      const layers = await waitForMiniPaint();
      if (!mountedRef.current || loadSequenceRef.current !== loadId) return;

      if (!imageId) {
        await layers.reset_layers(false);
        layers.Base_gui?.set_size(1024, 1024);
        await layers.insert({ name: t('miniPaint.blankLayer') }, false);
        layers.Base_gui?.GUI_preview?.zoom(100);
        if (!mountedRef.current || loadSequenceRef.current !== loadId) return;
        setState('ready');
        setMessage(t('miniPaint.blankReady'));
        return;
      }

      const response = await fetch(imageBytesUrl(imageId), {
        cache: 'no-store',
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`${t('canvas.imageLoadError')} (${response.status})`);
      }
      if (!mountedRef.current || loadSequenceRef.current !== loadId) return;

      revokeObjectUrl();
      objectUrlRef.current = URL.createObjectURL(await response.blob());
      const image = await loadImage(objectUrlRef.current);
      if (!mountedRef.current || loadSequenceRef.current !== loadId) return;

      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;

      await layers.reset_layers(false);
      layers.Base_gui?.set_size(width, height);
      await layers.insert(
        {
          name: imageId,
          type: 'image',
          data: image,
          width,
          height,
          width_original: width,
          height_original: height,
        },
        false
      );
      layers.Base_gui?.GUI_preview?.zoom(100);
      if (!mountedRef.current || loadSequenceRef.current !== loadId) return;
      setState('ready');
      setMessage(t('miniPaint.ready'));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!mountedRef.current || loadSequenceRef.current !== loadId) return;
      setState('error');
      setMessage(describeError(error, t('canvas.imageLoadError')));
    }
  }, [describeError, imageId, revokeObjectUrl, t]);

  React.useEffect(() => {
    void loadCurrentImage();
  }, [loadCurrentImage]);

  const exportPngDataUrl = React.useCallback(() => {
    const layers = (window as MiniPaintWindow).Layers;
    if (!layers) {
      throw new Error(t('project.canvasNotReady'));
    }
    const dimensions = layers.get_dimensions();
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error(t('project.canvasNotReady'));
    }
    layers.convert_layers_to_canvas(ctx);
    return canvas.toDataURL('image/png');
  }, [t]);

  const handleSave = React.useCallback(
    async (mode: ImageSaveMode) => {
      if (!imageId) {
        setState('error');
        setMessage(t('miniPaint.errors.saveBlank'));
        return;
      }
      setState('saving');
      setMessage(t('miniPaint.saving'));
      try {
        const dataUrl = exportPngDataUrl();
        const editResult = await createEditResultFromDataUrl(imageId, dataUrl, {
          op_type: 'minipaint_canvas',
          editor: 'miniPaint',
        });
        const saved = await saveEditedImage(imageId, {
          edit_result_ref: editResult.edit_result_ref,
          mode,
        });
        setSavedImageId(saved.image_id);
        setState('ready');
        setMessage(t('save.saved'));
      } catch (error) {
        setState('error');
        setMessage(describeError(error, t('save.error')));
      }
    },
    [describeError, exportPngDataUrl, imageId, t]
  );

  const handleDownload = React.useCallback(() => {
    try {
      const anchor = document.createElement('a');
      anchor.href = exportPngDataUrl();
      anchor.download = imageId
        ? `${imageId.replace(/[^A-Za-z0-9_.-]+/g, '_')}-edited.png`
        : 'viskit-editor-canvas.png';
      anchor.click();
    } catch (error) {
      setState('error');
      setMessage(describeError(error, t('save.error')));
    }
  }, [describeError, exportPngDataUrl, imageId, t]);

  return (
    <main className={cn('viskit-minipaint-shell h-screen min-h-0 bg-ink-base', className)}>
      <MiniPaintWorkspace />

      <div className="viskit-editor-actions">
        <span
          className={cn(
            'viskit-editor-status',
            state === 'error' ? 'is-error' : state === 'ready' ? 'is-ready' : ''
          )}
          role={state === 'error' ? 'alert' : 'status'}
        >
          {message}
          {savedImageId ? <span className="viskit-editor-saved-id">{savedImageId}</span> : null}
        </span>
        <button type="button" onClick={loadCurrentImage}>
          {imageId ? t('miniPaint.reload') : t('miniPaint.newCanvas')}
        </button>
        <button type="button" onClick={handleDownload}>
          {t('miniPaint.download')}
        </button>
        <a className="viskit-editor-home" href={homeHref}>
          {t('miniPaint.home')}
        </a>
        <button
          type="button"
          disabled={state === 'saving' || !imageId}
          onClick={() => void handleSave('copy')}
        >
          {t('save.copy')}
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={state === 'saving' || !imageId}
          onClick={() => void handleSave('replace')}
        >
          {t('save.replace')}
        </button>
      </div>

      <div className="mobile_menu">
        <button className="left_mobile_menu" id="left_mobile_menu_button" type="button">
          <span className="sr_only">切换工具栏</span>
        </button>
        <button className="right_mobile_menu" id="mobile_menu_button" type="button">
          <span className="sr_only">切换属性栏</span>
        </button>
      </div>
      <div className="hidden" id="tmp" />
      <div id="popups" />
    </main>
  );
}

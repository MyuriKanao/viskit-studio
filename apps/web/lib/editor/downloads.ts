export type EditorImageExportFormat = 'png' | 'jpeg' | 'webp';

export const EDITOR_RASTER_EXPORT_FORMATS = [
  'png',
  'jpeg',
  'webp',
] as const satisfies readonly EditorImageExportFormat[];

export function safeDownloadName(imageId: string, extension: string) {
  return `${imageId.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'viskit-editor'}.${extension}`;
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadDataUrl(filename: string, dataUrl: string) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function resolveApiImageSrc(src: string | null | undefined): string {
  if (!src) return '';
  if (src.startsWith('/api/')) return `${baseUrl}${src}`;
  return src;
}

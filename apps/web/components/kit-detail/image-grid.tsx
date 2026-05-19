'use client';

import * as React from 'react';

import { resolveApiImageSrc } from '@/lib/api/images';
import { cn } from '@/lib/utils';

export interface ImageMeta {
  image_id: string;
  png_path: string | null;
  status?: string;
}

export interface ImageGridProps {
  images: ImageMeta[];
  kitId?: string;
  className?: string;
}

interface SseEvent {
  image_id?: string;
  status?: string;
  png_path?: string | null;
  progress?: number;
  brand_color_locked?: boolean;
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export function ImageGrid({ images, kitId, className }: ImageGridProps) {
  const [state, setState] = React.useState<ImageMeta[]>(images);

  React.useEffect(() => {
    setState(images);
  }, [images]);

  React.useEffect(() => {
    if (!kitId) return;
    const url = `${baseUrl}/api/kits/${encodeURIComponent(kitId)}/events`;
    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch {
      return;
    }
    const handle = (ev: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(ev.data) as SseEvent;
        if (!parsed.image_id) return;
        setState((current) => {
          const idx = current.findIndex((c) => c.image_id === parsed.image_id);
          const next: ImageMeta = {
            image_id: parsed.image_id ?? '',
            png_path: parsed.png_path ?? (idx >= 0 ? current[idx].png_path : null),
            status: parsed.status ?? (idx >= 0 ? current[idx].status : undefined),
          };
          if (idx >= 0) {
            const copy = [...current];
            copy[idx] = next;
            return copy;
          }
          return [...current, next];
        });
      } catch {
        // Ignore malformed events — backend may send heartbeat lines.
      }
    };
    es.addEventListener('message', handle);
    return () => {
      es?.removeEventListener('message', handle);
      es?.close();
    };
  }, [kitId]);

  // Split into hero (H*) and detail (M*) buckets.
  const heroes = state.filter((m) => m.image_id.startsWith('H')).slice(0, 5);
  const details = state.filter((m) => m.image_id.startsWith('M')).slice(0, 9);
  while (heroes.length < 5) heroes.push({ image_id: `H${heroes.length + 1}`, png_path: null });
  while (details.length < 9) details.push({ image_id: `M${details.length + 1}`, png_path: null });

  return (
    <div className={cn('flex flex-col gap-s-4', className)}>
      <section aria-label="Hero images" className="flex flex-col gap-s-2">
        <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
          H1–H5 · Hero · 1:1
        </span>
        <div className="grid grid-cols-5 gap-s-2">
          {heroes.map((img, i) => (
            <Tile key={img.image_id} img={img} index={i} aspect="aspect-square" />
          ))}
        </div>
      </section>
      <section aria-label="Detail images" className="flex flex-col gap-s-2">
        <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">
          M1–M9 · Detail · 3:4
        </span>
        <div className="grid grid-cols-4 gap-s-2">
          {details.map((img, i) => (
            <Tile key={img.image_id} img={img} index={i + 5} aspect="aspect-[3/4]" />
          ))}
        </div>
      </section>
    </div>
  );
}

function Tile({ img, index, aspect }: { img: ImageMeta; index: number; aspect: string }) {
  const hasImage = !!img.png_path;
  const imageSrc = resolveImageSrc(img.png_path);
  const status = img.status;
  const isActive = status === 'running' || status === 'in_progress';
  const isDone = status === 'success' || status === 'color_locked' || status === 'ready';
  const isFailed = status === 'failed' || status === 'needs_review' || status === 'error';
  const label = isActive ? '生成中' : isDone ? '完成' : isFailed ? '待处理' : null;
  return (
    <div
      aria-label={`${img.image_id}${img.status ? ` · ${img.status}` : ''}`}
      className={cn(
        'relative overflow-hidden rounded-input border bg-surface-02 opacity-0 animate-fade-in-stagger',
        isActive
          ? 'border-accent shadow-[0_0_0_1px_var(--accent),0_0_24px_rgba(221,87,60,0.24)]'
          : 'border-border-subtle',
        aspect
      )}
      style={{ ['--i' as string]: index } as React.CSSProperties}
    >
      {hasImage ? (
        <img
          src={imageSrc}
          alt={`${img.image_id} preview`}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn('absolute inset-0 bg-surface-03', isActive && 'animate-pulse')}
        />
      )}
      {isActive ? (
        <span className="absolute inset-x-s-2 top-s-2 h-1 overflow-hidden rounded-full bg-surface-01/80">
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-accent" />
        </span>
      ) : null}
      <span className="absolute bottom-s-1 left-s-1 rounded-input bg-ink-base/70 px-s-2 py-0.5 font-mono text-xs text-ink-secondary backdrop-blur-sm">
        {img.image_id}
      </span>
      {label ? (
        <span
          className={cn(
            'absolute bottom-s-1 right-s-1 rounded-input px-s-2 py-0.5 text-xs backdrop-blur-sm',
            isActive
              ? 'bg-accent text-ink-base-l'
              : isFailed
                ? 'bg-warning/90 text-ink-base'
                : 'bg-ink-base/70 text-ink-secondary'
          )}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

function resolveImageSrc(src: string | null): string {
  return resolveApiImageSrc(src);
}

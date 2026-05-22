'use client';

import { AlertCircle, CheckCircle2, Clock3, Download, ExternalLink, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { resolveApiImageSrc } from '@/lib/api/images';
import type {
  GenerationJobSnapshot,
  GenerationJobStatus,
  GenerationOutput,
  GenerationOutputStatus,
} from '@/lib/generation/types';
import { cn } from '@/lib/utils';

type SupportedLocale = 'zh' | 'en';

export function isGenerationJobActive(status: GenerationJobStatus): boolean {
  return (
    status === 'planned' || status === 'queued' || status === 'running' || status === 'stopping'
  );
}

export function isGenerationJobComplete(status: GenerationJobStatus): boolean {
  return status === 'succeeded' || status === 'ready';
}

export function isGenerationJobFailed(status: GenerationJobStatus): boolean {
  return status === 'failed' || status === 'needs_review' || status === 'interrupted';
}

function localePrefix(locale: SupportedLocale): string {
  return locale === 'zh' ? '' : `/${locale}`;
}

function statusLabel(
  status: GenerationJobStatus | GenerationOutputStatus,
  labels: Record<string, string>
): string {
  return labels[status] ?? status;
}

function statusTone(status: GenerationJobStatus | GenerationOutputStatus): string {
  if (status === 'failed' || status === 'needs_review' || status === 'interrupted') {
    return 'border-danger bg-danger/10 text-danger';
  }
  if (status === 'succeeded' || status === 'success' || status === 'ready') {
    return 'border-success bg-success/10 text-success';
  }
  if (status === 'partial' || status === 'stopped' || status === 'cancelled') {
    return 'border-warning bg-warning/10 text-warning';
  }
  if (
    status === 'running' ||
    status === 'queued' ||
    status === 'planned' ||
    status === 'stopping'
  ) {
    return 'border-accent bg-accent-wash text-accent';
  }
  return 'border-border-subtle bg-surface-02 text-ink-muted';
}

function statusIcon(status: GenerationJobStatus): React.ReactNode {
  if (isGenerationJobComplete(status))
    return <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />;
  if (isGenerationJobFailed(status))
    return <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />;
  if (
    status === 'running' ||
    status === 'queued' ||
    status === 'planned' ||
    status === 'stopping'
  ) {
    return <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />;
  }
  return <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />;
}

function outputIsComplete(output: GenerationOutput): boolean {
  return output.status === 'succeeded' || output.status === 'success' || output.status === 'ready';
}

function outputIsTerminal(output: GenerationOutput): boolean {
  return (
    outputIsComplete(output) ||
    output.status === 'failed' ||
    output.status === 'needs_review' ||
    output.status === 'stopped' ||
    output.status === 'cancelled'
  );
}

function outputImageSrc(output: GenerationOutput): string {
  return resolveApiImageSrc(output.image_url ?? output.download_url ?? output.png_path);
}

function canEditImageId(imageId: string): boolean {
  return (
    /^asset:(?!None$|null$|undefined$)[A-Za-z0-9_-]{1,80}$/.test(imageId) ||
    /^kit-slot:\d+:[HM][1-9]$/.test(imageId)
  );
}

function formatDateTime(value: string | null | undefined, locale: SupportedLocale): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function shortJobId(jobId: string): string {
  if (jobId.length <= 14) return jobId;
  return `${jobId.slice(0, 8)}…${jobId.slice(-4)}`;
}

export interface GenerationTaskRecordCardProps {
  job: GenerationJobSnapshot;
  locale: SupportedLocale;
  compact?: boolean;
}

export function GenerationTaskRecordCard({
  job,
  locale,
  compact = false,
}: GenerationTaskRecordCardProps) {
  const t = useTranslations('queue.task_card');
  const statusLabels = React.useMemo(
    () => ({
      draft: t('status.draft'),
      planned: t('status.planned'),
      queued: t('status.queued'),
      pending: t('status.pending'),
      running: t('status.running'),
      stopping: t('status.stopping'),
      stopped: t('status.stopped'),
      cancelled: t('status.cancelled'),
      succeeded: t('status.succeeded'),
      success: t('status.success'),
      ready: t('status.ready'),
      partial: t('status.partial'),
      failed: t('status.failed'),
      needs_review: t('status.needs_review'),
      interrupted: t('status.interrupted'),
    }),
    [t]
  );
  const outputs = React.useMemo(
    () => [...job.outputs].sort((a, b) => a.sort_order - b.sort_order),
    [job.outputs]
  );
  const doneCount = outputs.filter(outputIsTerminal).length;
  const successCount = outputs.filter(outputIsComplete).length;
  const failedCount = outputs.filter(
    (output) => output.status === 'failed' || output.status === 'needs_review'
  ).length;
  const totalCount = outputs.length;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const taskTitle = job.user_prompt?.trim() || outputs[0]?.title || t('untitled');
  const finishedLabel = job.finished_at
    ? formatDateTime(job.finished_at, locale)
    : formatDateTime(job.updated_at ?? job.created_at, locale);

  return (
    <article
      data-testid={`generation-task-${job.job_id}`}
      className={cn(
        'overflow-hidden rounded-card border border-border-subtle bg-surface-01 shadow-glass',
        compact ? 'p-s-3' : 'p-s-4'
      )}
    >
      <div className="flex flex-col gap-s-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-s-2">
            <Badge className={cn('gap-s-1 border', statusTone(job.status))}>
              {statusIcon(job.status)}
              <span>{statusLabel(job.status, statusLabels)}</span>
            </Badge>
            <span className="font-mono text-xs text-ink-faint">
              {t('job_label', { id: shortJobId(job.job_id) })}
            </span>
          </div>
          <h2
            className={cn(
              'mt-s-2 line-clamp-2 font-display text-ink-primary',
              compact ? 'text-base' : 'text-xl'
            )}
          >
            {taskTitle}
          </h2>
          <div className="mt-s-2 flex flex-wrap items-center gap-x-s-3 gap-y-s-1 text-xs text-ink-muted">
            <span>
              {t('created')} {formatDateTime(job.created_at, locale)}
            </span>
            <span>
              {isGenerationJobActive(job.status) ? t('updated') : t('finished')} {finishedLabel}
            </span>
            <span>
              {t('outputs')} {successCount}/{totalCount}
              {failedCount > 0 ? ` · ${t('failed_count', { count: failedCount })}` : ''}
            </span>
          </div>
        </div>

        <div className="min-w-40 lg:text-right">
          <div className="h-2 overflow-hidden rounded-pill bg-surface-03" aria-hidden="true">
            <span
              className={cn(
                'block h-full rounded-pill transition-all duration-std',
                isGenerationJobFailed(job.status) ? 'bg-danger' : 'bg-accent'
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-s-1 font-mono text-xs text-ink-faint">{progress}%</p>
        </div>
      </div>

      {job.error_message ? (
        <p className="mt-s-3 rounded-input border border-danger/30 bg-danger/10 px-s-3 py-s-2 text-xs text-danger">
          {job.error_message}
        </p>
      ) : null}

      <div
        className={cn(
          'mt-s-4 grid gap-s-3',
          compact
            ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4'
            : 'grid-cols-2 md:grid-cols-4 xl:grid-cols-6'
        )}
      >
        {outputs.map((output) => (
          <OutputRecordTile
            key={output.output_id}
            output={output}
            locale={locale}
            compact={compact}
            statusLabels={statusLabels}
            editLabel={t('edit')}
            downloadLabel={t('download')}
          />
        ))}
      </div>
    </article>
  );
}

function OutputRecordTile({
  output,
  locale,
  compact,
  statusLabels,
  editLabel,
  downloadLabel,
}: {
  output: GenerationOutput;
  locale: SupportedLocale;
  compact: boolean;
  statusLabels: Record<string, string>;
  editLabel: string;
  downloadLabel: string;
}) {
  const imageSrc = outputImageSrc(output);
  const complete = outputIsComplete(output);
  const hrefPrefix = localePrefix(locale);
  const editHref = `${hrefPrefix}/editor/${encodeURIComponent(output.image_id)}`;
  const canEdit = complete && canEditImageId(output.image_id);
  const downloadHref = resolveApiImageSrc(
    output.download_url ?? output.image_url ?? output.png_path
  );

  return (
    <div className="overflow-hidden rounded-input border border-border-subtle bg-surface-02">
      <div className={cn('relative bg-surface-03', compact ? 'aspect-square' : 'aspect-[4/3]')}>
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={output.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center text-xs text-ink-faint',
              output.status === 'running' && 'animate-pulse'
            )}
          >
            {statusLabel(output.status, statusLabels)}
          </div>
        )}
        <span
          className={cn(
            'absolute left-s-2 top-s-2 rounded-pill border px-s-2 py-0.5 text-[10px] font-medium',
            statusTone(output.status)
          )}
        >
          {statusLabel(output.status, statusLabels)}
        </span>
      </div>
      <div className="flex flex-col gap-s-2 p-s-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-ink-primary">{output.title}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] uppercase text-ink-faint">
            {output.output_kind}
          </p>
        </div>
        {output.error_message ? (
          <p className="line-clamp-2 rounded-input bg-danger/10 px-s-2 py-s-1 text-[10px] text-danger">
            {output.error_message}
          </p>
        ) : null}
        <div className="flex items-center gap-s-1">
          <Link
            href={editHref}
            prefetch={false}
            aria-disabled={!canEdit}
            className={cn(
              'inline-flex h-7 flex-1 items-center justify-center gap-s-1 rounded-input border px-s-2 text-[11px] transition-colors',
              canEdit
                ? 'border-border-subtle text-ink-secondary hover:border-accent hover:text-accent'
                : 'pointer-events-none border-border-subtle text-ink-faint opacity-50'
            )}
          >
            <ExternalLink aria-hidden="true" className="h-3 w-3" />
            <span>{editLabel}</span>
          </Link>
          <a
            href={downloadHref || undefined}
            download
            aria-disabled={!complete || !downloadHref}
            className={cn(
              'inline-flex h-7 w-8 items-center justify-center rounded-input border transition-colors',
              complete && downloadHref
                ? 'border-border-subtle text-ink-secondary hover:border-accent hover:text-accent'
                : 'pointer-events-none border-border-subtle text-ink-faint opacity-50'
            )}
          >
            <Download aria-hidden="true" className="h-3 w-3" />
            <span className="sr-only">{downloadLabel}</span>
          </a>
        </div>
      </div>
    </div>
  );
}

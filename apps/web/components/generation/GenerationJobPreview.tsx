'use client';

import { useLocale } from 'next-intl';
import Link from 'next/link';
import * as React from 'react';

import type { GenerationJobPhase } from '@/hooks/use-generation-job';
import { resolveApiImageSrc } from '@/lib/api/images';
import type {
  GenerationJobSnapshot,
  GenerationOutput,
  GenerationPlan,
  SourceImageRef,
} from '@/lib/generation/types';
import { cn } from '@/lib/utils';

export interface GenerationJobPreviewProps {
  sourceImage: SourceImageRef | null;
  plan: GenerationPlan | null;
  job: GenerationJobSnapshot | null;
  phase: GenerationJobPhase;
  errorMessage: string | null;
  onStop: () => Promise<unknown>;
  className?: string;
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return '等待确认';
  if (status === 'queued' || status === 'pending' || status === 'planned') return '排队中';
  if (status === 'running') return '生成中';
  if (status === 'stopping') return '停止中';
  if (status === 'stopped' || status === 'cancelled') return '已停止';
  if (status === 'failed' || status === 'needs_review') return '待处理';
  if (status === 'succeeded' || status === 'success' || status === 'ready') return '完成';
  return status;
}

function isComplete(output: GenerationOutput): boolean {
  return output.status === 'succeeded' || output.status === 'success' || output.status === 'ready';
}

function outputImageSrc(output: GenerationOutput): string {
  return resolveApiImageSrc(output.image_url ?? output.png_path ?? output.download_url);
}

export function GenerationJobPreview({
  sourceImage,
  plan,
  job,
  phase,
  errorMessage,
  onStop,
  className,
}: GenerationJobPreviewProps) {
  const locale = useLocale();
  const [isStopping, setIsStopping] = React.useState(false);
  const planItems = plan?.items.filter((item) => item.enabled) ?? [];
  const outputs = job?.outputs ?? [];
  const isActive =
    job?.status === 'queued' || job?.status === 'planned' || job?.status === 'running';
  const canStop = isActive && !isStopping && phase !== 'stopping';

  async function handleStop() {
    setIsStopping(true);
    try {
      await onStop();
    } finally {
      setIsStopping(false);
    }
  }

  return (
    <div className={cn('flex flex-col gap-s-4', className)}>
      <section className="rounded-xl border border-border-subtle bg-surface-01 p-s-4">
        <div className="flex items-start justify-between gap-s-3">
          <div>
            <h2 className="font-mono text-xs uppercase tracking-wider text-ink-faint">
              生成任务预览
            </h2>
            <p className="mt-s-1 text-sm text-ink-secondary">
              {job
                ? `Job ${job.job_id} · ${statusLabel(job.status)}`
                : '确认输出计划后开始后台生成'}
            </p>
          </div>
          {job ? (
            <button
              data-testid="generation-stop-button"
              type="button"
              onClick={handleStop}
              disabled={!canStop}
              className={cn(
                'rounded-input border px-s-3 py-s-2 text-xs font-medium transition-colors',
                canStop
                  ? 'border-warning text-warning hover:bg-warning/10'
                  : 'border-border-subtle text-ink-faint'
              )}
            >
              {phase === 'stopping' || isStopping ? '停止中…' : '停止后续输出'}
            </button>
          ) : null}
        </div>

        {sourceImage?.preview_url ? (
          <div className="mt-s-4 overflow-hidden rounded-input border border-border-subtle bg-surface-02">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveApiImageSrc(sourceImage.preview_url)}
              alt="Source product"
              className="max-h-56 w-full object-contain"
            />
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-s-3 rounded-input bg-danger/10 px-s-3 py-s-2 text-xs text-danger">
            {errorMessage}
          </div>
        ) : null}
      </section>

      {outputs.length > 0 ? (
        <section className="grid gap-s-3 sm:grid-cols-2">
          {outputs.map((output) => (
            <OutputTile key={output.output_id} output={output} locale={locale} />
          ))}
        </section>
      ) : (
        <section className="grid gap-s-3 sm:grid-cols-2">
          {planItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle bg-surface-01 p-s-4 text-sm text-ink-faint">
              上传商品图并确认输出计划后，这里会显示生成进度、下载和编辑入口。
            </div>
          ) : (
            planItems.map((item, index) => (
              <div
                key={item.id}
                className="rounded-xl border border-border-subtle bg-surface-01 p-s-3"
              >
                <div className="aspect-[4/3] rounded-input bg-surface-03" />
                <div className="mt-s-2 flex items-start justify-between gap-s-2">
                  <div>
                    <p className="text-sm font-medium text-ink-primary">{item.title}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {item.destination_type === 'kit_slot'
                        ? `套包槽位 ${item.slot_id || '待选'}`
                        : '独立资产'}
                      · {item.aspect_ratio || '自适应'} · 待确认
                    </p>
                  </div>
                  <span className="rounded-input bg-surface-03 px-s-2 py-1 font-mono text-[10px] uppercase text-ink-faint">
                    #{index + 1}
                  </span>
                </div>
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}

function OutputTile({ output, locale }: { output: GenerationOutput; locale: string }) {
  const imageSrc = outputImageSrc(output);
  const complete = isComplete(output);
  const downloadHref = resolveApiImageSrc(
    output.download_url ?? output.image_url ?? output.png_path
  );
  const editHref = `/${locale}/editor/${encodeURIComponent(output.image_id)}`;

  return (
    <article
      data-testid={`generation-output-${output.output_id}`}
      className="overflow-hidden rounded-xl border border-border-subtle bg-surface-01"
    >
      <div className="relative aspect-[4/3] bg-surface-03">
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={`${output.title} preview`}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <span
            className={cn(
              'absolute inset-0 bg-surface-03',
              output.status === 'running' && 'animate-pulse'
            )}
          />
        )}
        <span className="absolute left-s-2 top-s-2 rounded-input bg-ink-base/70 px-s-2 py-1 text-xs text-ink-secondary backdrop-blur-sm">
          {statusLabel(output.status)}
        </span>
      </div>
      <div className="flex flex-col gap-s-2 p-s-3">
        <div>
          <p className="text-sm font-medium text-ink-primary">{output.title}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {output.destination_type === 'kit_slot'
              ? `套包槽位 ${output.slot_id || '未指定'}`
              : '独立资产'}
            · {output.output_kind}
          </p>
        </div>
        {output.error_message ? (
          <p className="rounded-input bg-danger/10 px-s-2 py-s-1 text-xs text-danger">
            {output.error_message}
          </p>
        ) : null}
        <div className="flex gap-s-2">
          <a
            data-testid={`generation-output-download-${output.output_id}`}
            href={downloadHref || undefined}
            download
            aria-disabled={!complete || !downloadHref}
            className={cn(
              'rounded-input border px-s-3 py-s-1.5 text-xs',
              complete && downloadHref
                ? 'border-border-subtle text-ink-secondary hover:border-accent hover:text-accent'
                : 'pointer-events-none border-border-subtle text-ink-faint opacity-50'
            )}
          >
            下载
          </a>
          <Link
            data-testid={`generation-output-edit-${output.output_id}`}
            href={editHref}
            aria-disabled={!complete}
            className={cn(
              'rounded-input border px-s-3 py-s-1.5 text-xs',
              complete
                ? 'border-border-subtle text-ink-secondary hover:border-accent hover:text-accent'
                : 'pointer-events-none border-border-subtle text-ink-faint opacity-50'
            )}
          >
            编辑
          </Link>
        </div>
      </div>
    </article>
  );
}

'use client';

import {
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProgressEvent } from '@/lib/chat/types';
import {
  type GenerationJobCreateRequest,
  type GenerationJobSnapshot,
  type GenerationJobStatus,
  type GenerationOutput,
  type GenerationOutputStatus,
  type GenerationPlan,
  type GenerationPlanItem,
  type GenerationPlanRequest,
  type OutputDestinationType,
  type OutputPlanSource,
  type SourceImageRef,
  canonicalAssetImageId,
  canonicalJobOutputImageId,
  canonicalKitSlotImageId,
} from '@/lib/generation/types';

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export interface SourceImageUploadInput {
  imageUrl: string;
  mime: string;
  fileName?: string;
}

export interface GenerationJobListSnapshot {
  jobs: GenerationJobSnapshot[];
  total: number;
  limit: number;
  offset: number;
}

export interface UseGenerationJobRecordsOptions {
  limit?: number;
  offset?: number;
}

export type GenerationJobPhase =
  | 'idle'
  | 'planning'
  | 'creating'
  | 'resuming'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'success'
  | 'error';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asIdString(value: unknown): string | null {
  const id = asString(value);
  return id && id !== 'None' && id !== 'null' && id !== 'undefined' ? id : null;
}

function asImageId(value: unknown): string | null {
  const imageId = asIdString(value);
  if (!imageId) return null;
  if (/^asset:(?!None$|null$|undefined$)[A-Za-z0-9_-]{1,80}$/.test(imageId)) return imageId;
  if (/^kit-slot:\d+:[HM][1-9]$/.test(imageId)) return imageId;
  if (/^job-output:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(imageId)) return imageId;
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

async function readJsonOrThrow(response: Response, label: string): Promise<unknown> {
  if (response.ok) return response.json();
  let detail = `${response.status}`;
  try {
    const body = asRecord(await response.json());
    const bodyDetail = asString(body.detail) ?? asString(body.message) ?? asString(body.error);
    if (bodyDetail) detail = bodyDetail;
  } catch {
    // keep status-only detail
  }
  throw new Error(`${label} failed: ${detail}`);
}

function normalizeDestination(value: unknown): OutputDestinationType {
  return value === 'kit_slot' ? 'kit_slot' : 'asset';
}

function normalizePlanSource(value: unknown): OutputPlanSource {
  if (
    value === 'explicit' ||
    value === 'recommended' ||
    value === 'fallback' ||
    value === 'manual'
  ) {
    return value;
  }
  return 'recommended';
}

function normalizeOutputStatus(value: unknown): GenerationOutputStatus {
  if (
    value === 'queued' ||
    value === 'pending' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'success' ||
    value === 'ready' ||
    value === 'failed' ||
    value === 'stopped' ||
    value === 'cancelled' ||
    value === 'needs_review'
  ) {
    return value;
  }
  return 'queued';
}

function normalizeJobStatus(value: unknown): GenerationJobStatus {
  if (
    value === 'draft' ||
    value === 'planned' ||
    value === 'queued' ||
    value === 'running' ||
    value === 'stopping' ||
    value === 'stopped' ||
    value === 'succeeded' ||
    value === 'partial' ||
    value === 'ready' ||
    value === 'failed' ||
    value === 'needs_review' ||
    value === 'interrupted'
  ) {
    return value;
  }
  return 'queued';
}

function normalizePlanItem(raw: unknown, index: number): GenerationPlanItem {
  const item = asRecord(raw);
  const outputKey =
    asString(item.id) ??
    asString(item.output_id) ??
    asString(item.output_key) ??
    `planned-${index + 1}`;
  return {
    id: outputKey,
    output_kind: asString(item.output_kind) ?? asString(item.kind) ?? 'custom',
    title: asString(item.title) ?? asString(item.name) ?? `输出 ${index + 1}`,
    reason: asString(item.reason) ?? asString(item.rationale),
    template_ref: asString(item.template_ref),
    template_name: asString(item.template_name) ?? asString(item.template_title),
    aspect_ratio: asString(item.aspect_ratio),
    destination_type: normalizeDestination(item.destination_type ?? item.destination),
    slot_id: asString(item.slot_id),
    enabled: asBoolean(item.enabled) ?? true,
  };
}

function normalizeGenerationPlan(raw: unknown, request: GenerationPlanRequest): GenerationPlan {
  const body = asRecord(raw);
  const plan = asRecord(body.plan);
  const source = Object.keys(plan).length > 0 ? plan : body;
  const rawItems = source.items ?? source.outputs ?? body.items ?? body.outputs;
  const items = Array.isArray(rawItems) ? rawItems.map(normalizePlanItem) : [];
  return {
    plan_id: asString(source.plan_id) ?? asString(source.id),
    source_image_ref: asString(source.source_image_ref) ?? request.source_image_ref,
    plan_source: normalizePlanSource(source.plan_source ?? source.source),
    requires_confirmation: asBoolean(source.requires_confirmation) ?? true,
    items,
    user_prompt: asString(source.user_prompt) ?? request.user_prompt,
  };
}

function normalizeOutput(raw: unknown, jobId: string, index: number): GenerationOutput {
  const output = asRecord(raw);
  const outputId =
    asString(output.output_id) ??
    asString(output.id) ??
    asString(output.output_key) ??
    `output-${index + 1}`;
  const outputKey = asString(output.output_key) ?? outputId;
  const destinationType = normalizeDestination(output.destination_type ?? output.destination);
  const marketingKitId = asNumber(output.marketing_kit_id);
  const slotId = asIdString(output.slot_id);
  const assetId = asIdString(output.asset_id);
  const fallbackImageId =
    destinationType === 'kit_slot' && marketingKitId !== null && slotId
      ? canonicalKitSlotImageId(marketingKitId, slotId)
      : assetId
        ? canonicalAssetImageId(assetId)
        : canonicalJobOutputImageId(jobId, outputId);
  return {
    id: outputId,
    output_id: outputId,
    output_key: outputKey,
    output_kind: asString(output.output_kind) ?? asString(output.kind) ?? 'custom',
    title: asString(output.title) ?? asString(output.name) ?? outputKey,
    reason: asString(output.reason) ?? asString(output.rationale),
    template_ref: asString(output.template_ref),
    template_name: asString(output.template_name) ?? asString(output.template_title),
    aspect_ratio: asString(output.aspect_ratio),
    destination_type: destinationType,
    slot_id: slotId,
    asset_id: assetId,
    image_id: asImageId(output.image_id) ?? fallbackImageId,
    image_url: asString(output.image_url) ?? asString(output.url),
    download_url: asString(output.download_url),
    png_path: asString(output.png_path),
    status: normalizeOutputStatus(output.status),
    error_message: asString(output.error_message) ?? asString(output.error),
    sort_order: asNumber(output.sort_order) ?? index,
  };
}

function normalizeGenerationJob(raw: unknown, fallbackJobId?: string): GenerationJobSnapshot {
  const body = asRecord(raw);
  const source = asRecord(body.job);
  const job = Object.keys(source).length > 0 ? source : body;
  const jobId = asString(job.job_id) ?? asString(job.id) ?? fallbackJobId ?? '';
  const rawOutputs = job.outputs ?? body.outputs;
  const outputs = Array.isArray(rawOutputs)
    ? rawOutputs.map((output, index) => normalizeOutput(output, jobId, index))
    : [];
  return {
    job_id: jobId,
    client_job_id: asString(job.client_job_id),
    status: normalizeJobStatus(job.status),
    source_image_ref: asString(job.source_image_ref),
    user_prompt: asString(job.user_prompt),
    locale: asString(job.locale),
    marketing_kit_id: asNumber(job.marketing_kit_id),
    planner_payload: asRecord(job.planner_payload),
    outputs,
    error_message: asString(job.error_message) ?? asString(job.error),
    created_at: asString(job.created_at),
    updated_at: asString(job.updated_at),
    started_at: asString(job.started_at),
    finished_at: asString(job.finished_at),
  };
}

function jobPhaseFromStatus(status: GenerationJobStatus): GenerationJobPhase {
  if (status === 'ready' || status === 'succeeded') return 'success';
  if (status === 'stopping') return 'stopping';
  if (status === 'stopped' || status === 'interrupted' || status === 'partial') return 'stopped';
  if (status === 'failed' || status === 'needs_review') return 'error';
  if (status === 'running' || status === 'queued' || status === 'planned') return 'running';
  return 'idle';
}

function progressStatusFromOutput(status: GenerationOutputStatus): ProgressEvent['status'] {
  if (status === 'succeeded' || status === 'success' || status === 'ready') return 'success';
  if (status === 'failed' || status === 'needs_review') return 'failed';
  if (status === 'queued' || status === 'pending') return 'pending';
  return 'running';
}

async function postSourceImage(input: SourceImageUploadInput): Promise<SourceImageRef> {
  if (!input.imageUrl.startsWith('data:image/')) {
    throw new Error('/api/source-images requires a data:image URL');
  }
  const response = await fetch(`${baseUrl}/api/source-images`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      data_url: input.imageUrl,
    }),
  });
  const body = asRecord(await readJsonOrThrow(response, '/api/source-images'));
  const sourceImageRef =
    asString(body.source_image_ref) ?? asString(body.id) ?? asString(body.ref) ?? null;
  if (!sourceImageRef) {
    throw new Error('/api/source-images failed: missing source_image_ref');
  }
  return {
    source_image_ref: sourceImageRef,
    preview_url: asString(body.preview_url) ?? asString(body.url),
    mime: asString(body.mime) ?? input.mime,
  };
}

async function postGenerationPlan(request: GenerationPlanRequest): Promise<GenerationPlan> {
  const response = await fetch(`${baseUrl}/api/generation/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await readJsonOrThrow(response, '/api/generation/plan');
  const plan = normalizeGenerationPlan(body, request);
  if (plan.items.length === 0) {
    throw new Error('/api/generation/plan failed: empty output plan');
  }
  return plan;
}

async function postGenerationJob(
  request: GenerationJobCreateRequest
): Promise<GenerationJobSnapshot> {
  const response = await fetch(`${baseUrl}/api/generation/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await readJsonOrThrow(response, '/api/generation/jobs');
  const snapshot = normalizeGenerationJob(body);
  if (!snapshot.job_id) {
    throw new Error('/api/generation/jobs failed: missing job_id');
  }
  if (snapshot.outputs.length > 0) return snapshot;
  return fetchGenerationJobWithRetry(snapshot.job_id);
}

async function postStartGenerationJob(jobId: string): Promise<GenerationJobSnapshot> {
  const response = await fetch(
    `${baseUrl}/api/generation/jobs/${encodeURIComponent(jobId)}/start`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }
  );
  if (!response.ok) {
    await readJsonOrThrow(response, `/api/generation/jobs/${jobId}/start`);
  }
  return fetchGenerationJobWithRetry(jobId);
}

export async function fetchGenerationJob(jobId: string): Promise<GenerationJobSnapshot> {
  const response = await fetch(`${baseUrl}/api/generation/jobs/${encodeURIComponent(jobId)}`, {
    cache: 'no-store',
  });
  const body = await readJsonOrThrow(response, `/api/generation/jobs/${jobId}`);
  const snapshot = normalizeGenerationJob(body, jobId);
  if (!snapshot.job_id) {
    throw new Error(`/api/generation/jobs/${jobId} failed: missing job_id`);
  }
  return snapshot;
}

async function fetchGenerationJobWithRetry(
  jobId: string,
  attempts = 4
): Promise<GenerationJobSnapshot> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchGenerationJob(jobId);
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1) break;
      await new Promise((resolve) => window.setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function postStopGenerationJob(jobId: string): Promise<GenerationJobSnapshot> {
  const response = await fetch(`${baseUrl}/api/generation/jobs/${encodeURIComponent(jobId)}/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  const body = await readJsonOrThrow(response, `/api/generation/jobs/${jobId}/stop`);
  const snapshot = normalizeGenerationJob(body, jobId);
  return snapshot.outputs.length > 0 ? snapshot : fetchGenerationJobWithRetry(jobId);
}

async function fetchGenerationJobs(limit: number, offset = 0): Promise<GenerationJobListSnapshot> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetch(`${baseUrl}/api/generation/jobs?${params.toString()}`, {
    cache: 'no-store',
  });
  const body = await readJsonOrThrow(response, '/api/generation/jobs');
  const record = asRecord(body);
  const rawJobs = Array.isArray(body)
    ? body
    : Array.isArray(record.jobs)
      ? record.jobs
      : Array.isArray(record.items)
        ? record.items
        : [];
  const jobs = rawJobs
    .map((item) => normalizeGenerationJob(item))
    .filter((job) => Boolean(job.job_id));
  return {
    jobs,
    total: asNumber(record.total) ?? jobs.length,
    limit: asNumber(record.limit) ?? limit,
    offset: asNumber(record.offset) ?? offset,
  };
}

export function usePersistSourceImage() {
  return useMutation<SourceImageRef, Error, SourceImageUploadInput>({
    mutationFn: postSourceImage,
  });
}

export function useGenerationPlan() {
  return useMutation<GenerationPlan, Error, GenerationPlanRequest>({
    mutationFn: postGenerationPlan,
  });
}

export function useGenerationJobRecords(
  options: UseGenerationJobRecordsOptions = {}
): UseQueryResult<GenerationJobListSnapshot, Error> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  return useQuery<GenerationJobListSnapshot, Error>({
    queryKey: ['generation-jobs', 'records', limit, offset],
    queryFn: () => fetchGenerationJobs(limit, offset),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const hasLiveJob = jobs.some(
        (job) =>
          job.status === 'planned' ||
          job.status === 'queued' ||
          job.status === 'running' ||
          job.status === 'stopping'
      );
      return hasLiveJob ? 4000 : 15000;
    },
  });
}

export function useGenerationJobRecordPages(options: UseGenerationJobRecordsOptions = {}) {
  const limit = options.limit ?? 50;
  return useInfiniteQuery<GenerationJobListSnapshot, Error>({
    queryKey: ['generation-jobs', 'records', 'pages', limit],
    initialPageParam: options.offset ?? 0,
    queryFn: ({ pageParam }) => fetchGenerationJobs(limit, Number(pageParam) || 0),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.jobs.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    refetchInterval: (query) => {
      const jobs = query.state.data?.pages.flatMap((page) => page.jobs) ?? [];
      const hasLiveJob = jobs.some(
        (job) =>
          job.status === 'planned' ||
          job.status === 'queued' ||
          job.status === 'running' ||
          job.status === 'stopping'
      );
      return hasLiveJob ? 4000 : 15000;
    },
  });
}

export interface UseGenerationJobOptions {
  onProgress?: (event: ProgressEvent) => void;
}

export function useGenerationJob(options: UseGenerationJobOptions = {}) {
  const [phase, setPhase] = useState<GenerationJobPhase>('idle');
  const [job, setJob] = useState<GenerationJobSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const onProgressRef = useRef(options.onProgress);

  useEffect(() => {
    onProgressRef.current = options.onProgress;
  }, [options.onProgress]);

  const setSnapshot = useCallback((snapshot: GenerationJobSnapshot) => {
    activeJobIdRef.current = snapshot.job_id;
    setJob(snapshot);
    setPhase(jobPhaseFromStatus(snapshot.status));
    setErrorMessage(snapshot.error_message);
    for (const output of snapshot.outputs) {
      onProgressRef.current?.({
        slot: output.output_key,
        status: progressStatusFromOutput(output.status),
        message: output.status,
        png_path: output.png_path ?? output.image_url,
      });
    }
  }, []);

  const refresh = useCallback(
    async (jobId: string) => {
      const snapshot = await fetchGenerationJob(jobId);
      setSnapshot(snapshot);
      return snapshot;
    },
    [setSnapshot]
  );

  const resume = useCallback(
    async (jobId: string) => {
      if (!jobId || activeJobIdRef.current === jobId) return job;
      setPhase('resuming');
      setErrorMessage(null);
      try {
        return await refresh(jobId);
      } catch (err) {
        setErrorMessage((err as Error).message);
        setPhase('error');
        return null;
      }
    },
    [job, refresh]
  );

  const start = useCallback(
    async (request: GenerationJobCreateRequest) => {
      setPhase('creating');
      setErrorMessage(null);
      try {
        const created = await postGenerationJob(request);
        const snapshot = await postStartGenerationJob(created.job_id);
        setSnapshot(snapshot);
        return snapshot;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setErrorMessage(error.message);
        setPhase('error');
        throw error;
      }
    },
    [setSnapshot]
  );

  const stop = useCallback(async () => {
    const jobId = activeJobIdRef.current;
    if (!jobId) return null;
    setPhase('stopping');
    setErrorMessage(null);
    try {
      const snapshot = await postStopGenerationJob(jobId);
      setSnapshot(snapshot);
      return snapshot;
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase('error');
      return null;
    }
  }, [setSnapshot]);

  useEffect(() => {
    const jobId = job?.job_id;
    if (!jobId) return;
    const shouldSubscribe =
      job.status === 'queued' || job.status === 'planned' || job.status === 'running';
    if (!shouldSubscribe) return;

    const eventsUrl = `${baseUrl}/api/generation/jobs/${encodeURIComponent(jobId)}/events`;
    let eventSource: EventSource | null = null;
    let pollId: number | null = null;

    try {
      eventSource = new EventSource(eventsUrl);
      const handleSnapshotEvent = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as unknown;
          const snapshot = normalizeGenerationJob(parsed, jobId);
          if (snapshot.job_id && (snapshot.outputs.length > 0 || snapshot.status !== 'queued')) {
            setSnapshot(snapshot);
          } else {
            void refresh(jobId);
          }
        } catch {
          // A missed or malformed event is recovered by polling/GET snapshot.
          void refresh(jobId);
        }
      };
      const handleUpdateEvent = () => {
        void refresh(jobId);
      };
      eventSource.addEventListener('message', handleSnapshotEvent);
      eventSource.addEventListener('snapshot', handleSnapshotEvent);
      eventSource.addEventListener('update', handleUpdateEvent);
      eventSource.addEventListener('error', () => {
        void refresh(jobId);
      });
    } catch {
      // EventSource can fail in tests or non-browser runtimes; polling remains authoritative.
    }

    pollId = window.setInterval(() => {
      void refresh(jobId);
    }, 5000);

    return () => {
      eventSource?.close();
      if (pollId !== null) window.clearInterval(pollId);
    };
  }, [job?.job_id, job?.status, refresh, setSnapshot]);

  const reset = useCallback(() => {
    activeJobIdRef.current = null;
    setJob(null);
    setPhase('idle');
    setErrorMessage(null);
  }, []);

  return {
    phase,
    errorMessage,
    job,
    activeJobId: job?.job_id ?? null,
    start,
    resume,
    refresh,
    stop,
    reset,
  };
}

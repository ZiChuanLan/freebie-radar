/**
 * AI 引擎实时执行遥测（纯内存环形缓冲，不写 SQLite）：
 * - 追踪正在执行的同步审核 / 异步队列 / 历史补审 / 连通性测试任务与最新判定流
 * - 保存最近 25 次执行记录，供 AI 引擎面板实时展示过程与排障
 */

export type AiStage = "sync" | "queue" | "backfill" | "test";

export type AiLiveEvent = {
  title: string;
  keep: boolean;
  kind: string;
  category: string;
  quality: number | null;
  reason: string;
  at: string;
};

export type AiActiveJob = {
  id: string;
  stage: AiStage;
  label: string;
  sourceId?: string;
  model: string;
  total: number;
  done: number;
  kept: number;
  rejected: number;
  failed: number;
  totalBatches: number;
  completedBatches: number;
  startedAt: string;
  recentEvents: AiLiveEvent[];
};

export type AiRunRecord = {
  id: string;
  stage: AiStage;
  label: string;
  sourceId?: string;
  model: string;
  total: number;
  reviewed: number;
  kept: number;
  rejected: number;
  skippedBlocked?: number;
  failed: number;
  durationMs: number;
  ttfbAvgMs: number | null;
  finishedAt: string;
  error?: string;
};

type InternalJob = AiActiveJob & {
  startedMs: number;
  ttfbSum: number;
  ttfbCount: number;
};

const MAX_HISTORY = 25;
const MAX_EVENTS = 8;
const active = new Map<string, InternalJob>();
const history: AiRunRecord[] = [];
let seq = 0;

export function startAiJob(opts: {
  stage: AiStage;
  label: string;
  sourceId?: string;
  model: string;
  total: number;
  totalBatches: number;
}): string {
  seq += 1;
  const id = `ai-${Date.now()}-${seq}`;
  active.set(id, {
    id,
    stage: opts.stage,
    label: opts.label,
    sourceId: opts.sourceId,
    model: opts.model,
    total: opts.total,
    done: 0,
    kept: 0,
    rejected: 0,
    failed: 0,
    totalBatches: Math.max(1, opts.totalBatches),
    completedBatches: 0,
    startedAt: new Date().toISOString(),
    startedMs: Date.now(),
    ttfbSum: 0,
    ttfbCount: 0,
    recentEvents: [],
  });
  return id;
}

export function recordAiBatch(
  jobId: string,
  opts: {
    events?: AiLiveEvent[];
    kept?: number;
    rejected?: number;
    failed?: number;
    ttfbMs?: number | null;
  },
): void {
  const job = active.get(jobId);
  if (!job) return;
  job.completedBatches += 1;
  const kept = opts.kept ?? 0;
  const rejected = opts.rejected ?? 0;
  const failed = opts.failed ?? 0;
  job.kept += kept;
  job.rejected += rejected;
  job.failed += failed;
  job.done += kept + rejected;
  if (typeof opts.ttfbMs === "number" && Number.isFinite(opts.ttfbMs) && opts.ttfbMs >= 0) {
    job.ttfbSum += opts.ttfbMs;
    job.ttfbCount += 1;
  }
  if (opts.events?.length) {
    job.recentEvents = [...opts.events, ...job.recentEvents].slice(0, MAX_EVENTS);
  }
}

export function finishAiJob(
  jobId: string,
  extra?: { skippedBlocked?: number; error?: string },
): void {
  const job = active.get(jobId);
  if (!job) return;
  active.delete(jobId);
  const record: AiRunRecord = {
    id: job.id,
    stage: job.stage,
    label: job.label,
    sourceId: job.sourceId,
    model: job.model,
    total: job.total,
    reviewed: job.done,
    kept: job.kept,
    rejected: job.rejected,
    skippedBlocked: extra?.skippedBlocked,
    failed: job.failed,
    durationMs: Math.max(0, Date.now() - job.startedMs),
    ttfbAvgMs: job.ttfbCount > 0 ? Math.round(job.ttfbSum / job.ttfbCount) : null,
    finishedAt: new Date().toISOString(),
    error: extra?.error,
  };
  history.unshift(record);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
}

export function getAiTelemetry(): { active: AiActiveJob[]; history: AiRunRecord[] } {
  const activeList: AiActiveJob[] = [...active.values()].map(
    ({ startedMs: _ms, ttfbSum: _s, ttfbCount: _c, ...rest }) => rest,
  );
  return {
    active: activeList,
    history: [...history],
  };
}

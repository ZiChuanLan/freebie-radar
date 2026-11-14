import { getAiSettings, reviewItems, type AiVerdict } from "./ai-settings.ts";
import { FREEBIE_ONLY_SOURCES, isCategory, resolveKind, type ContentKind } from "./index.ts";
import { calibrateScoreByObtain } from "./alias.ts";
import type { RawItem } from "../collectors/types.ts";
import { get, run } from "../db.ts";
import { finishAiJob, recordAiBatch, startAiJob } from "./ai-telemetry.ts";

const VALID_OBTAIN = new Set(["free", "conditional", "lottery", "trial", "promo", "paid"]);

/**
 * AI 异步审核队列：
 * - 支持「极速抢码先推后审」模式在后台补齐 AI 结论
 * - 支持「推送前先审」模式消化超过同步上限的剩余新条目
 * - 审核通过（aiKeep=true）且尚未推送的条目，可通过回调触发补推（进即时或攒批队列）
 */

export type AiQueueJob = {
  itemId: number;
  sourceId?: string;
  url: string;
  title: string;
  summary: string;
  pushOnApprove?: boolean;
};

type PostReviewHandler = (sourceId: string, itemIds: number[]) => Promise<unknown>;

const queue: AiQueueJob[] = [];
let running = false;
let processed = 0;
let dropped = 0;
const MAX_QUEUE = 500;
let postReviewHandler: PostReviewHandler | null = null;

export function setPostReviewHandler(handler: PostReviewHandler | null): void {
  postReviewHandler = handler;
}

/** 采集侧调用：把新条目排进队列，立刻返回。 */
export function enqueueForAi(items: AiQueueJob[]): void {
  if (!items.length) return;
  const existingIds = new Set(queue.map((q) => q.itemId));
  const fresh = items.filter((it) => !existingIds.has(it.itemId));
  if (!fresh.length) return;
  if (queue.length + fresh.length > MAX_QUEUE) {
    const overflow = queue.length + fresh.length - MAX_QUEUE;
    queue.splice(0, overflow);
    dropped += overflow;
  }
  queue.push(...fresh);
  void drain();
}

export function aiQueueStats(): { queued: number; processed: number; dropped: number; running: boolean } {
  return { queued: queue.length, processed, dropped, running };
}

export type AppliedVerdict = {
  aiKeep: boolean;
  kind: ContentKind;
  category: string | null;
  obtain: string | null;
  score: number;
  reason: string | null;
};

function applyVerdictToItem(itemId: number, verdict: AiVerdict): AppliedVerdict | null {
  const nextCategory = isCategory(verdict.category) ? verdict.category : null;
  const nextObtain = verdict.obtain && VALID_OBTAIN.has(verdict.obtain) ? verdict.obtain : null;
  const nextQuality =
    typeof verdict.quality === "number" && Number.isFinite(verdict.quality)
      ? Math.min(5, Math.max(1, Math.round(verdict.quality)))
      : null;
  try {
    const cur = get<{
      score: number;
      ai_keep: number | null;
      obtain: string | null;
      category: string | null;
      title: string;
      summary: string | null;
      source_id: string;
      is_free: number;
      price: number | null;
    }>(
      "SELECT score, ai_keep, obtain, category, title, summary, source_id, is_free, price FROM items WHERE id = ?",
      itemId,
    );
    const effectiveCategory = nextCategory ?? cur?.category ?? null;
    const effectiveObtain = nextObtain ?? cur?.obtain ?? null;
    const effectiveKind = resolveKind(verdict.kind, verdict.keep, {
      title: cur?.title ?? "",
      summary: cur?.summary ?? "",
      sourceId: cur?.source_id,
      category: effectiveCategory,
      obtain: effectiveObtain,
      isFree: cur?.is_free === 1,
      price: cur?.price ?? null,
      freebieOnlySource: Boolean(cur?.source_id && FREEBIE_ONLY_SOURCES.has(cur.source_id)),
    });
    const effectiveKeep = effectiveKind === "noise" ? false : verdict.keep;
    const keep = effectiveKeep ? 1 : 0;
    const nextScore =
      cur && cur.ai_keep === null
        ? calibrateScoreByObtain(cur.score, effectiveObtain, effectiveKeep, nextQuality, effectiveKind)
        : cur?.score ?? 0;
    run(
      `UPDATE items
          SET ai = ?,
              ai_keep = ?,
              kind = ?,
              ai_quality = COALESCE(?, ai_quality),
              obtain = COALESCE(?, obtain),
              category = COALESCE(?, category),
              score = ?,
              ai_reviewed_at = ?
        WHERE id = ?`,
      JSON.stringify({ ...verdict, keep: effectiveKeep, kind: effectiveKind }),
      keep,
      effectiveKind,
      nextQuality,
      nextObtain,
      nextCategory,
      nextScore,
      new Date().toISOString(),
      itemId,
    );
    return {
      aiKeep: effectiveKeep,
      kind: effectiveKind,
      category: effectiveCategory,
      obtain: effectiveObtain,
      score: nextScore,
      reason: typeof verdict.reason === "string" && verdict.reason.trim() ? verdict.reason.trim() : null,
    };
  } catch {
    return null;
  }
}

/** 推送前同步审核：把本轮待推送新条目先送模型判定并写库，返回各 itemId 的最新结论。 */
export async function reviewFreshNow(items: AiQueueJob[]): Promise<Map<number, AppliedVerdict>> {
  const out = new Map<number, AppliedVerdict>();
  if (!items.length) return out;
  const s = getAiSettings();
  const raws = items.map((j) => ({
    externalId: String(j.itemId),
    url: j.url,
    title: j.title,
    summary: j.summary,
  })) as RawItem[];
  const srcId = items[0]?.sourceId;
  const jobId = startAiJob({
    stage: "sync",
    label: srcId ? `${srcId} · 推送前同步审核` : "推送前同步审核",
    sourceId: srcId,
    model: s.model,
    total: items.length,
    totalBatches: Math.ceil(items.length / s.batchSize),
  });
  let batchErr: string | undefined;
  try {
    const map = await reviewItems(raws, { ...s, maxItems: Math.max(s.maxItems, items.length) }, {
      onBatch: (ev) => {
        if (ev.error) batchErr = ev.error;
        let kept = 0;
        let rejected = 0;
        const events = [];
        for (let i = 0; i < ev.items.length; i += 1) {
          const v = ev.verdicts?.get(ev.start + i);
          if (!v) continue;
          const keep = Boolean(v.keep);
          if (keep) kept += 1;
          else rejected += 1;
          events.push({
            title: ev.items[i]!.title,
            keep,
            kind: v.kind ?? (keep ? "freebie" : "noise"),
            category: v.category ?? "-",
            quality: typeof v.quality === "number" ? v.quality : null,
            reason: v.reason ?? "",
            at: new Date().toISOString(),
          });
        }
        recordAiBatch(jobId, {
          events,
          kept,
          rejected,
          failed: ev.verdicts ? 0 : ev.count,
          ttfbMs: ev.ttfbMs,
        });
      },
    });
    if (!map) {
      finishAiJob(jobId, { error: batchErr ?? "模型未返回有效结论" });
      return out;
    }
    for (const [idx, verdict] of map) {
      const job = items[idx];
      if (!job) continue;
      const applied = applyVerdictToItem(job.itemId, verdict);
      if (applied) {
        processed += 1;
        out.set(job.itemId, applied);
      } else {
        dropped += 1;
      }
    }
    finishAiJob(jobId);
  } catch (err) {
    finishAiJob(jobId, { error: err instanceof Error ? err.message : String(err) });
  }
  return out;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const s = getAiSettings();
      const waveSize = Math.min(Math.max(s.batchSize * s.concurrency, 12), 48);
      const batch = queue.splice(0, waveSize);
      const raws = batch.map((j) => ({
        externalId: String(j.itemId),
        url: j.url,
        title: j.title,
        summary: j.summary,
      })) as RawItem[];

      const jobId = startAiJob({
        stage: "queue",
        label: "异步队列波次",
        sourceId: batch[0]?.sourceId,
        model: s.model,
        total: batch.length,
        totalBatches: Math.ceil(batch.length / s.batchSize),
      });
      let map;
      let batchErr: string | undefined;
      try {
        map = await reviewItems(raws, { ...s, maxItems: batch.length }, {
          onBatch: (ev) => {
            if (ev.error) batchErr = ev.error;
            let kept = 0;
            let rejected = 0;
            const events = [];
            for (let i = 0; i < ev.items.length; i += 1) {
              const v = ev.verdicts?.get(ev.start + i);
              if (!v) continue;
              const keep = Boolean(v.keep);
              if (keep) kept += 1;
              else rejected += 1;
              events.push({
                title: ev.items[i]!.title,
                keep,
                kind: v.kind ?? (keep ? "freebie" : "noise"),
                category: v.category ?? "-",
                quality: typeof v.quality === "number" ? v.quality : null,
                reason: v.reason ?? "",
                at: new Date().toISOString(),
              });
            }
            recordAiBatch(jobId, {
              events,
              kept,
              rejected,
              failed: ev.verdicts ? 0 : ev.count,
              ttfbMs: ev.ttfbMs,
            });
          },
        });
      } catch (err) {
        dropped += batch.length;
        finishAiJob(jobId, { error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      if (!map) {
        dropped += batch.length;
        finishAiJob(jobId, { error: batchErr ?? "模型未返回有效结论" });
        continue;
      }
      finishAiJob(jobId);

      const approvedBySource = new Map<string, number[]>();
      for (const [idx, verdict] of map) {
        const job = batch[idx];
        if (!job) continue;
        const applied = applyVerdictToItem(job.itemId, verdict);
        if (applied) {
          processed += 1;
          if (applied.aiKeep && job.pushOnApprove && job.sourceId) {
            const list = approvedBySource.get(job.sourceId) ?? [];
            list.push(job.itemId);
            approvedBySource.set(job.sourceId, list);
          }
        } else {
          dropped += 1;
        }
      }

      if (postReviewHandler && approvedBySource.size) {
        for (const [sourceId, ids] of approvedBySource) {
          try {
            await postReviewHandler(sourceId, ids);
          } catch (err) {
            console.error("[ai-queue] 补审补推回调失败:", err instanceof Error ? err.message : String(err));
          }
        }
      }
    }
  } finally {
    running = false;
  }
}

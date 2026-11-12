import { reviewItems } from "./ai-settings.ts";
import type { RawItem } from "../collectors/types.ts";
import { run } from "../db.ts";

/**
 * AI 二审队列：采集不再等模型。
 *
 * 背景：MG 是反代 Inception Labs 网页端，单次延迟 1.6-9 秒、偶发能到 49 秒。
 * 同步送审意味着 linux.do 一轮采集要 33 秒以上，而送码帖 1 分钟内就被抢光——
 * 时效性被二审吃掉，这是设计错误，不是调参能解决的。
 *
 * 现在的做法：
 *  采集 → 规则判定 → 立刻入库、立刻推送 → 条目丢进队列 → 后台慢慢补 AI 结论
 *
 * 代价：首轮推送只靠规则（NOISE_TITLE / DEAL_HINT / URGENT），
 *       AI 结论晚几十秒到几分钟才落库，用于列表筛选和后续统计。
 * 收益：采集从 33 秒回到 2 秒以内，送码帖不再错过窗口。
 */

type Job = {
  itemId: number;
  url: string;
  title: string;
  summary: string;
};

const queue: Job[] = [];
let running = false;
let processed = 0;
let dropped = 0;
const MAX_QUEUE = 500;

/** 采集侧调用：把新条目排进队列，立刻返回。 */
export function enqueueForAi(items: Job[]): void {
  if (!items.length) return;
  if (queue.length + items.length > MAX_QUEUE) {
    // 队列积压时丢最老的：老条目推送早过了，再审也没意义
    const overflow = queue.length + items.length - MAX_QUEUE;
    queue.splice(0, overflow);
    dropped += overflow;
  }
  queue.push(...items);
  void drain();
}

export function aiQueueStats(): { queued: number; processed: number; dropped: number; running: boolean } {
  return { queued: queue.length, processed, dropped, running };
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, 12);
      const raws = batch.map((j) => ({
        externalId: String(j.itemId),
        url: j.url,
        title: j.title,
        summary: j.summary,
      })) as RawItem[];

      let map;
      try {
        map = await reviewItems(raws);
      } catch {
        // 整批失败就丢掉，不阻塞后面的；这些条目保持 ai_keep = null，
        // 列表和推送会按「未判定」处理（放行 + 规则兜底）
        dropped += batch.length;
        continue;
      }
      if (!map) {
        dropped += batch.length;
        continue;
      }

      const at = new Date().toISOString();
      for (const [idx, verdict] of map) {
        const job = batch[idx];
        if (!job) continue;
        try {
          // 注意：items 表没有 updated_at 列，别往 UPDATE 里塞，
          // 之前写错这里导致整批回填静默失败（被 catch 吞掉）
          run(
            "UPDATE items SET ai = ?, ai_keep = ?, obtain = COALESCE(obtain, ?) WHERE id = ?",
            JSON.stringify(verdict),
            verdict.keep ? 1 : 0,
            verdict.obtain ?? null,
            job.itemId,
          );
        } catch {
          dropped += 1;
        }
      }
    }
  } finally {
    running = false;
  }
}

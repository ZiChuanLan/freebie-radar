import { all, get, run } from "./db.ts";
import { calibrateScoreByObtain } from "./enrich/alias.ts";
import { enrichItem, isCategory } from "./enrich/index.ts";
import { guessObtain } from "./enrich/obtain.ts";
import { aiQueueStats } from "./enrich/ai-queue.ts";
import {
  aiReady,
  DEFAULT_PROMPT,
  feedbackStats,
  getAiSettings,
  publicAiSettings,
  reviewItems,
  saveAiSettings,
  testAiConnection,
  type AiSettings,
} from "./enrich/ai-settings.ts";

function updateAi(id: number, ai: string, keep: number, score: number, category: string | null, obtain: string): void {
  run(
    "UPDATE items SET ai = ?, ai_keep = ?, score = ?, category = ?, obtain = ? WHERE id = ?",
    ai,
    keep,
    score,
    category,
    obtain,
    id,
  );
}

/** AI 判定统计：总体分布 + 分类分布 + 队列状态 + 最近样本。 */
export function aiStats() {
  const totals = get<{ kept: number; rejected: number; pending: number }>(
    `SELECT
       SUM(CASE WHEN ai_keep = 1 THEN 1 ELSE 0 END) AS kept,
       SUM(CASE WHEN ai_keep = 0 THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN ai IS NULL THEN 1 ELSE 0 END) AS pending
     FROM items WHERE status = 'active'`,
  );
  const byCategory = all<{ category: string; n: number }>(
    `SELECT COALESCE(category,'other') AS category, COUNT(*) AS n
     FROM items WHERE status = 'active' AND ai_keep = 1
     GROUP BY category ORDER BY n DESC`,
  );
  const recent = all<{
    id: number;
    source_id: string;
    title: string;
    score: number;
    obtain: string | null;
    ai: string;
  }>(
    `SELECT id, source_id, title, score, obtain, ai FROM items
     WHERE ai IS NOT NULL ORDER BY last_seen_at DESC LIMIT 15`,
  );
  return {
    kept: totals?.kept ?? 0,
    rejected: totals?.rejected ?? 0,
    pending: totals?.pending ?? 0,
    queue: aiQueueStats(),
    byCategory,
    recent: recent.map((r) => {
      let v: { keep?: boolean; reason?: string; category?: string; obtain?: string; quality?: number } = {};
      try {
        v = JSON.parse(r.ai) as typeof v;
      } catch {
        v = {};
      }
      return {
        id: r.id,
        sourceId: r.source_id,
        title: r.title,
        score: r.score,
        keep: v.keep ?? null,
        reason: v.reason ?? "",
        category: v.category ?? "",
        obtain: v.obtain ?? r.obtain ?? "free",
        quality: typeof v.quality === "number" ? v.quality : null,
      };
    }),
  };
}

export type BackfillMode = "pending" | "recent" | "rejected";

/**
 * 手动补审 / 重审：
 * - pending：仅审还没有 AI 结论的条目（默认）
 * - recent：用最新提示词/偏好重审近期入库条目（校准分类、获取方式与质量分）
 * - rejected：复核近期被 AI 拦截的非福利条目（防止误杀）
 */
export async function backfillAi(
  limit = 200,
  mode: BackfillMode = "pending",
): Promise<{ reviewed: number; rejected: number; scanned: number; mode: BackfillMode; error?: string }> {
  const s = getAiSettings();
  if (!aiReady(s)) return { reviewed: 0, rejected: 0, scanned: 0, mode, error: "AI 未启用或未配置" };

  const safeLimit = Math.min(Math.max(Math.round(limit), 1), 2000);
  const whereExtra =
    mode === "rejected"
      ? "AND ai_keep = 0"
      : mode === "recent"
        ? ""
        : "AND ai IS NULL";

  const rows = all<{
    id: number;
    source_id: string;
    external_id: string;
    title: string;
    summary: string | null;
    url: string;
    score: number;
    category: string | null;
    published_at: string | null;
    expires_at: string | null;
  }>(
    `SELECT id, source_id, external_id, title, summary, url, score, category, published_at, expires_at
     FROM items WHERE status = 'active' ${whereExtra}
     ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`,
    safeLimit,
  );
  if (!rows.length) return { reviewed: 0, rejected: 0, scanned: 0, mode };

  let reviewed = 0;
  let rejected = 0;
  const CHUNK = Math.max(s.batchSize * s.concurrency, 24);

  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const raws = chunk.map((r) => ({
      externalId: r.external_id,
      url: r.url,
      title: r.title,
      summary: r.summary ?? "",
    }));
    let map;
    try {
      map = await reviewItems(raws as never, { ...s, maxItems: chunk.length });
    } catch {
      continue;
    }
    if (!map) continue;
    for (let i = 0; i < chunk.length; i += 1) {
      const row = chunk[i]!;
      const v = map.get(i);
      if (!v) continue;
      reviewed += 1;
      if (!v.keep) rejected += 1;
      const ai = JSON.stringify(v);
      const keep = v.keep ? 1 : 0;
      const obtain = v.obtain ?? guessObtain(row.title, row.summary ?? "");
      // 重审时重算一次基础分再校准，避免多次叠加乘除失真
      const baseEnriched = enrichItem(
        {
          externalId: row.external_id,
          url: row.url,
          title: row.title,
          summary: row.summary ?? "",
          publishedAt: row.published_at,
          expiresAt: row.expires_at,
        },
        row.source_id,
      );
      const baseScore = baseEnriched ? baseEnriched.score : row.score;
      const score = calibrateScoreByObtain(baseScore, obtain, v.keep, v.quality);
      const category = isCategory(v.category) ? v.category : row.category;
      updateAi(row.id, ai, keep, score, category, obtain);
    }
  }

  return { reviewed, rejected, scanned: rows.length, mode };
}

export { publicAiSettings, saveAiSettings, testAiConnection, DEFAULT_PROMPT, aiReady, getAiSettings, feedbackStats };
export type { AiSettings };

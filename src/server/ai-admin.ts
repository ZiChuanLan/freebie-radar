import { all, get, run } from "./db.ts";
import { calibrateScoreByObtain } from "./enrich/alias.ts";
import { enrichItem, FREEBIE_ONLY_SOURCES, isCategory, resolveKind } from "./enrich/index.ts";
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

function updateAi(
  id: number,
  ai: string,
  keep: number,
  score: number,
  category: string | null,
  obtain: string,
  kind: string,
  quality: number | null,
): void {
  run(
    "UPDATE items SET ai = ?, ai_keep = ?, score = ?, category = ?, obtain = ?, kind = ?, ai_quality = COALESCE(?, ai_quality) WHERE id = ?",
    ai,
    keep,
    score,
    category,
    obtain,
    kind,
    quality,
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
  const byKind = all<{ kind: string; n: number }>(
    `SELECT COALESCE(kind,'freebie') AS kind, COUNT(*) AS n
     FROM items WHERE status = 'active'
     GROUP BY kind ORDER BY n DESC`,
  );
  const recent = all<{
    id: number;
    source_id: string;
    title: string;
    score: number;
    obtain: string | null;
    kind: string | null;
    ai: string;
  }>(
    `SELECT id, source_id, title, score, obtain, kind, ai FROM items
     WHERE ai IS NOT NULL ORDER BY last_seen_at DESC LIMIT 15`,
  );
  return {
    kept: totals?.kept ?? 0,
    rejected: totals?.rejected ?? 0,
    pending: totals?.pending ?? 0,
    queue: aiQueueStats(),
    byCategory,
    byKind,
    recent: recent.map((r) => {
      let v: { keep?: boolean; kind?: string; reason?: string; category?: string; obtain?: string; quality?: number } = {};
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
        kind: v.kind ?? r.kind ?? (v.keep === false ? "noise" : "freebie"),
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
      const category = isCategory(v.category) ? v.category : row.category;
      const quality =
        typeof v.quality === "number" && Number.isFinite(v.quality)
          ? Math.min(5, Math.max(1, Math.round(v.quality)))
          : null;
      const kind = resolveKind(v.kind, v.keep, {
        title: row.title,
        summary: row.summary ?? "",
        sourceId: row.source_id,
        category,
        obtain,
        isFree: baseEnriched?.isFree ?? false,
        price: baseEnriched?.price ?? null,
        freebieOnlySource: FREEBIE_ONLY_SOURCES.has(row.source_id),
      });
      const effectiveKeep = kind === "noise" ? false : v.keep;
      const keep = effectiveKeep ? 1 : 0;
      const ai = JSON.stringify({ ...v, keep: effectiveKeep, kind });
      const score = calibrateScoreByObtain(baseScore, obtain, effectiveKeep, quality, kind);
      updateAi(row.id, ai, keep, score, category, obtain, kind, quality);
    }
  }

  return { reviewed, rejected, scanned: rows.length, mode };
}

/**
 * 零 Token 存量分类重整：用最新关键词规则重算 active 条目的 category（以及未 AI 审核条目的 kind / obtain）。
 * scope = "other"：仅挽救落入 other/null 的条目；scope = "all"：全量 active 按新规则刷新（已 AI 审核的只刷新 category=other 的漏网条目）。
 */
export function reclassifyStoredItems(scope: "other" | "all" = "other"): {
  scanned: number;
  updated: number;
  movedFromOther: number;
  scope: "other" | "all";
} {
  const cond = scope === "other" ? "status = 'active' AND (category = 'other' OR category IS NULL)" : "status = 'active'";
  const rows = all<{
    id: number;
    source_id: string;
    external_id: string | null;
    url: string;
    title: string;
    summary: string | null;
    category: string | null;
    kind: string | null;
    obtain: string | null;
    ai_keep: number | null;
    published_at: string | null;
    expires_at: string | null;
  }>(
    `SELECT id, source_id, external_id, url, title, summary, category, kind, obtain, ai_keep, published_at, expires_at
       FROM items WHERE ${cond} ORDER BY id DESC LIMIT 6000`,
  );

  let updated = 0;
  let movedFromOther = 0;
  for (const r of rows) {
    const e = enrichItem(
      {
        externalId: r.external_id ?? String(r.id),
        url: r.url,
        title: r.title,
        summary: r.summary ?? "",
        publishedAt: r.published_at,
        expiresAt: r.expires_at,
      },
      r.source_id,
    );
    if (!e) continue;
    // 已人工/AI 审核过的非 other 条目不随意覆盖其 AI 分类，只修复 other 或未审条目
    const nextCat = r.ai_keep !== null && r.category && r.category !== "other" ? r.category : e.category;
    const nextKind = r.ai_keep === null ? e.kind : (r.kind ?? e.kind);
    const fallbackObtain = guessObtain(r.title, r.summary ?? "");
    const nextObtain = r.ai_keep === null ? fallbackObtain : (r.obtain ?? fallbackObtain);

    if (nextCat !== r.category || nextKind !== r.kind || nextObtain !== r.obtain) {
      run(
        "UPDATE items SET category = ?, kind = ?, obtain = ? WHERE id = ?",
        nextCat,
        nextKind,
        nextObtain,
        r.id,
      );
      updated += 1;
      if ((r.category === "other" || !r.category) && nextCat !== "other") {
        movedFromOther += 1;
      }
    }
  }
  return { scanned: rows.length, updated, movedFromOther, scope };
}

export { publicAiSettings, saveAiSettings, testAiConnection, DEFAULT_PROMPT, aiReady, getAiSettings, feedbackStats };
export type { AiSettings };

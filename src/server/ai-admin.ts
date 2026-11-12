import { all, get, run } from "./db.ts";
import { guessObtain } from "./enrich/obtain.ts";
import {
  aiReady,
  DEFAULT_PROMPT,
  getAiSettings,
  publicAiSettings,
  saveAiSettings,
  testAiConnection,
  type AiSettings,
} from "./enrich/ai-settings.ts";
import { reviewItems } from "./enrich/ai-settings.ts";

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

/** AI 判定统计：总体分布 + 分类分布 + 最近样本。 */
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
  const recent = all<{ id: number; title: string; score: number; ai: string }>(
    `SELECT id, title, score, ai FROM items
     WHERE ai IS NOT NULL ORDER BY last_seen_at DESC LIMIT 12`,
  );
  return {
    kept: totals?.kept ?? 0,
    rejected: totals?.rejected ?? 0,
    pending: totals?.pending ?? 0,
    byCategory,
    recent: recent.map((r) => {
      let v: { keep?: boolean; reason?: string; category?: string } = {};
      try {
        v = JSON.parse(r.ai) as { keep?: boolean; reason?: string; category?: string };
      } catch {
        v = {};
      }
      return { id: r.id, title: r.title, score: r.score, keep: v.keep ?? null, reason: v.reason ?? "", category: v.category ?? "" };
    }),
  };
}

/** 手动补审：把还没有结论的条目批量送审，返回统计。 */
export async function backfillAi(limit = 200): Promise<{ reviewed: number; rejected: number; scanned: number; error?: string }> {
  const s = getAiSettings();
  if (!aiReady(s)) return { reviewed: 0, rejected: 0, scanned: 0, error: "AI 未启用或未配置" };

  const rows = all<{
    id: number;
    source_id: string;
    external_id: string;
    title: string;
    summary: string | null;
    url: string;
    score: number;
    category: string | null;
  }>(
    `SELECT id, source_id, external_id, title, summary, url, score, category
     FROM items WHERE status = 'active' AND ai IS NULL
     ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`,
    Math.min(Math.max(limit, 1), 2000),
  );
  if (!rows.length) return { reviewed: 0, rejected: 0, scanned: 0 };

  let reviewed = 0;
  let rejected = 0;
  const CHUNK = 20;

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
      map = await reviewItems(raws as never, s);
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
      const score = v.keep ? row.score : Math.round(row.score * 0.5);
      const category = v.category || row.category;
      const obtain = v.obtain ?? guessObtain(row.title, row.summary ?? "");
      updateAi(row.id, ai, keep, score, category, obtain);
    }
  }

  return { reviewed, rejected, scanned: rows.length };
}

export { publicAiSettings, saveAiSettings, testAiConnection, DEFAULT_PROMPT, aiReady, getAiSettings };
export type { AiSettings };

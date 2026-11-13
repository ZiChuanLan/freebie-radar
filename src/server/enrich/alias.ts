import { all, get, run } from "../db.ts";
import { extractMergeKeys } from "./dedup.ts";

/**
 * 结合 title_aliases 字典把单条标题映射到统一的 canonical title_key。
 * 当遇到包含中英双名（如《斗阵骑士 Knightica》）的条目时，
 * 自动建立中文别名 -> 英文主名映射，并把库里既有同中文名条目合并过来。
 */
export function resolveDbMergeKey(title: string): string {
  const keys = extractMergeKeys(title);
  if (!keys.length) return "";

  try {
    if (keys.length === 1) {
      const k = keys[0]!;
      const mapped = get<{ canonical: string }>("SELECT canonical FROM title_aliases WHERE alias = ?", k);
      return mapped?.canonical ?? k;
    }

    const placeholders = keys.map(() => "?").join(",");
    const existing = all<{ alias: string; canonical: string }>(
      `SELECT alias, canonical FROM title_aliases WHERE alias IN (${placeholders})`,
      ...keys,
    );
    const canonical = existing[0]?.canonical ?? keys[0]!;
    for (const k of keys) {
      if (k === canonical) continue;
      run(
        "INSERT INTO title_aliases (alias, canonical) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET canonical = excluded.canonical",
        k,
        canonical,
      );
      run("UPDATE items SET title_key = ? WHERE title_key = ?", canonical, k);
    }
    return canonical;
  } catch {
    return keys[0]!;
  }
}

/** 按获取方式对基础评分做保守校准：付费与限时试玩/引流低于永久白嫖。 */
export function calibrateScoreByObtain(score: number, obtain: string | null | undefined, aiKeep: boolean | null): number {
  let out = score;
  if (aiKeep === false) out = Math.round(out * 0.5);
  if (obtain === "paid") out = Math.min(out, 25);
  else if (obtain === "trial" || obtain === "promo") out = Math.round(out * 0.8);
  return Math.max(0, Math.min(100, out));
}

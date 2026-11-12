import { all, get } from "./src/server/db.ts";

const dist = all<{ m: string; n: number }>(
  "SELECT COALESCE(obtain,'?') AS m, COUNT(*) n FROM items WHERE status='active' GROUP BY m ORDER BY n DESC",
);
console.log("全部 obtain:", dist.map((r) => r.m + "=" + r.n).join("  "));

const kept = all<{ m: string; n: number }>(
  "SELECT COALESCE(obtain,'?') AS m, COUNT(*) n FROM items WHERE status='active' AND ai_keep=1 GROUP BY m ORDER BY n DESC",
);
console.log("真福利 obtain:", kept.map((r) => r.m + "=" + r.n).join("  "));

const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
const now = new Date().toISOString();
const q = get<{ n: number }>(
  `SELECT COUNT(*) n FROM items WHERE status='active' AND ai_keep=1 AND COALESCE(obtain,'free')='free'
   AND ((expires_at IS NOT NULL AND expires_at > ?) OR (expires_at IS NULL AND COALESCE(published_at, first_seen_at) >= ?))`,
  now,
  cutoff,
);
console.log("真福利精选(7天内+free+未过期):", q?.n ?? 0);

const old = get<{ n: number }>(
  "SELECT COUNT(*) n FROM items WHERE status='active' AND ai_keep=1 AND COALESCE(published_at, first_seen_at) < ?",
  cutoff,
);
console.log("被 7 天窗口挡掉的真福利:", old?.n ?? 0);

for (const mode of ["lottery", "trial", "promo", "conditional"]) {
  const rows = all<{ title: string }>(
    "SELECT title FROM items WHERE status='active' AND ai_keep=1 AND obtain=? LIMIT 4",
    mode,
  );
  if (rows.length) {
    console.log("\n[" + mode + "]");
    for (const r of rows) console.log("   ", r.title.slice(0, 58));
  }
}

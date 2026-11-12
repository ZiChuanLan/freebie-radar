import { all, get } from "./src/server/db.ts";

const rows = all<{
  id: number;
  source_id: string;
  title: string;
  summary: string | null;
  score: number;
  ai: string | null;
  ai_keep: number | null;
  obtain: string | null;
  is_free: number | null;
  price: number | null;
  pushed_at: string | null;
  first_seen_at: string;
}>(
  `SELECT id, source_id, title, summary, score, ai, ai_keep, obtain, is_free, price, pushed_at, first_seen_at
   FROM items WHERE title LIKE '%Proxy001%' ORDER BY id DESC LIMIT 4`,
);

for (const r of rows) {
  console.log("--- id", r.id, "| 源:", r.source_id, "| 分:", r.score);
  console.log("标题:", r.title.slice(0, 90));
  console.log("摘要:", (r.summary ?? "").slice(0, 120));
  console.log("ai:", r.ai);
  console.log("ai_keep:", r.ai_keep, "| obtain:", r.obtain, "| is_free:", r.is_free, "| price:", r.price);
  console.log("推送时间:", r.pushed_at, "| 抓取:", r.first_seen_at);
}

console.log("\n=== v2ex-promotions 源整体表现 ===");
const promoStats = get<{ n: number; kept: number; pushed: number }>(
  `SELECT COUNT(*) n,
          SUM(CASE WHEN ai_keep = 1 THEN 1 ELSE 0 END) kept,
          SUM(CASE WHEN pushed_at IS NOT NULL THEN 1 ELSE 0 END) pushed
   FROM items WHERE source_id = 'v2ex-promotions'`,
);
console.log(promoStats);

console.log("\n=== 各源按 obtain 分布（只看 free 但源带推广属性） ===");
const bySource = all<{ source_id: string; obtain: string; n: number }>(
  `SELECT source_id, COALESCE(obtain,'?') obtain, COUNT(*) n
   FROM items WHERE ai_keep = 1 AND status='active'
   GROUP BY source_id, obtain ORDER BY n DESC LIMIT 20`,
);
for (const r of bySource) console.log(r.source_id.padEnd(24), r.obtain.padEnd(12), r.n);

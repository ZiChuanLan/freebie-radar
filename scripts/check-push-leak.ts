import { all, run } from "./src/server/db.ts";
import { getPushSettings, obtainAllowed, passesPushFilters } from "./src/server/push.ts";

const s = getPushSettings();
console.log("当前 obtainModes:", JSON.stringify(s.obtainModes));
console.log("onlyAiKeep:", s.onlyAiKeep, "| maxPrice:", s.maxPrice, "| categories:", JSON.stringify(s.categories));

// 拿那条 Proxy001 复现推送判定
const row = all<{
  id: number;
  source_id: string;
  title: string;
  summary: string | null;
  score: number;
  codes: string;
  price: number | null;
  is_free: number;
  obtain: string | null;
  ai: string | null;
}>(`SELECT id, source_id, title, summary, score, codes, price, is_free, obtain, ai FROM items WHERE title LIKE '%Proxy001%' LIMIT 1`)[0];

if (!row) {
  console.log("没找到样本");
} else {
  const aiKeep = row.ai ? (JSON.parse(row.ai) as { keep?: boolean }).keep ?? null : null;
  const fresh = {
    title: row.title,
    score: row.score,
    codes: JSON.parse(row.codes || "[]") as string[],
    price: row.price,
    isFree: row.is_free === 1,
    aiKeep,
    category: "cloud",
    obtain: row.obtain,
  };
  console.log("\n样本:", row.title.slice(0, 60));
  console.log("obtain:", row.obtain, "| aiKeep:", aiKeep);
  console.log("obtainAllowed(free 白名单):", obtainAllowed(row.obtain, s.obtainModes));
  console.log("passesPushFilters 整体:", passesPushFilters(fresh, s));
}

// 各源被推送的情况：找出还在漏的广告源
console.log("\n=== 24h 内推送过的条目按源 ===");
const pushed = all<{ source_id: string; n: number; obt: string }>(
  `SELECT source_id, COALESCE(obtain,'?') obt, COUNT(*) n FROM items
   WHERE pushed_at IS NOT NULL AND pushed_at >= ?
   GROUP BY source_id, obt ORDER BY n DESC`,
  new Date(Date.now() - 86400000).toISOString(),
);
for (const r of pushed) console.log(r.source_id.padEnd(26), String(r.n).padStart(3), r.obt);

console.log("\n=== v2ex-promotions 全部条目 ===");
for (const r of all<{ title: string; obtain: string | null; ai_keep: number | null; score: number }>(
  "SELECT title, obtain, ai_keep, score FROM items WHERE source_id='v2ex-promotions' ORDER BY score DESC",
)) {
  console.log(String(r.score).padStart(3), String(r.ai_keep).padStart(4), (r.obtain ?? "?").padEnd(12), r.title.slice(0, 54));
}

import { all, get, run } from "./src/server/db.ts";
import { getPushSettings, priceAllowed, passesPushFilters, obtainAllowed } from "./src/server/push.ts";

// 1) 关掉纯广告源（SEEDS 的 enabled 只在首次插入生效，存量要单独改）
const before = get<{ enabled: number }>("SELECT enabled FROM sources WHERE id = 'v2ex-promotions'");
run("UPDATE sources SET enabled = 0 WHERE id = 'v2ex-promotions'");
const after = get<{ enabled: number }>("SELECT enabled FROM sources WHERE id = 'v2ex-promotions'");
console.log("v2ex-promotions enabled:", before?.enabled, "->", after?.enabled);

// 2) 验证 paid 条目不再通过「只推白嫖」
const s = getPushSettings();
console.log("maxPrice:", s.maxPrice, "obtainModes:", JSON.stringify(s.obtainModes));
const paidRow = all<{ title: string; price: number | null; is_free: number; obtain: string | null }>(
  "SELECT title, price, is_free, obtain FROM items WHERE obtain='paid' AND is_free=1 LIMIT 3",
);
console.log("\n是否还有 is_free=1 但 obtain=paid 的条目:", paidRow.length);
for (const r of paidRow) {
  const ok = priceAllowed({ price: r.price, isFree: r.is_free === 1, obtain: r.obtain }, s.maxPrice);
  console.log("  priceAllowed =", ok, "|", r.title.slice(0, 52));
}

// 3) 现在 24h 内真正会通过全套筛选的候选里，obtain 分布如何
const cands = all<{
  title: string;
  score: number;
  codes: string;
  price: number | null;
  is_free: number;
  obtain: string | null;
  ai: string | null;
  category: string | null;
}>(
  `SELECT title, score, codes, price, is_free, obtain, ai, category FROM items
   WHERE status='active' AND pushed_at IS NULL AND COALESCE(published_at, first_seen_at) >= ?
   ORDER BY score DESC LIMIT 300`,
  new Date(Date.now() - 7 * 86400000).toISOString(),
);
const pass: Record<string, number> = {};
for (const r of cands) {
  const aiKeep = r.ai ? (JSON.parse(r.ai) as { keep?: boolean }).keep ?? null : null;
  const ok = passesPushFilters(
    {
      title: r.title,
      score: r.score,
      codes: JSON.parse(r.codes || "[]"),
      price: r.price,
      isFree: r.is_free === 1,
      aiKeep,
      category: r.category,
      obtain: r.obtain,
    },
    s,
  );
  if (ok) pass[r.obtain ?? "?"] = (pass[r.obtain ?? "?"] ?? 0) + 1;
}
console.log("\n通过全套推送筛选的候选 obtain 分布:", JSON.stringify(pass));

// 4) 确认没有任何非 free 的能进来
const leak = Object.keys(pass).filter((k) => k !== "free");
console.log("非 free 泄漏:", leak.length ? leak.join(",") : "无");

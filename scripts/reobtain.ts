import { all, run } from "./src/server/db.ts";
import { reviewItems } from "./src/server/enrich/ai-settings.ts";
import { guessObtain } from "./src/server/enrich/obtain.ts";

// 老条目的 ai JSON 里没有 obtain 字段（提示词是后加的），只能靠关键词猜，质量很差。
// 这里只对「已判定为真福利」的条目用新提示词重跑一次，成本很小（约 700 条 ≈ 35 批）。
const rows = all<{ id: number; external_id: string; title: string; summary: string | null; url: string; score: number; category: string | null }>(
  `SELECT id, external_id, title, summary, url, score, category
   FROM items WHERE status = 'active' AND ai_keep = 1
   ORDER BY score DESC`,
);
console.log("待重审真福利:", rows.length);

const dist: Record<string, number> = {};
let reviewed = 0;
const CHUNK = 20;

for (let start = 0; start < rows.length; start += CHUNK) {
  const chunk = rows.slice(start, start + CHUNK);
  const raws = chunk.map((r) => ({ externalId: r.external_id, url: r.url, title: r.title, summary: r.summary ?? "" }));
  let map;
  try {
    map = await reviewItems(raws as never);
  } catch (e) {
    console.log("批次失败:", String(e).slice(0, 80));
    continue;
  }
  if (!map) continue;
  for (let i = 0; i < chunk.length; i += 1) {
    const row = chunk[i]!;
    const v = map.get(i);
    if (!v) continue;
    const obtain = v.obtain ?? guessObtain(row.title, row.summary ?? "");
    dist[obtain] = (dist[obtain] ?? 0) + 1;
    run(
      "UPDATE items SET ai = ?, ai_keep = ?, obtain = ?, score = ?, category = ? WHERE id = ?",
      JSON.stringify(v),
      v.keep ? 1 : 0,
      obtain,
      v.keep ? row.score : Math.round(row.score * 0.5),
      v.category || row.category,
      row.id,
    );
    reviewed += 1;
  }
  process.stdout.write(".");
}

console.log("");
console.log("重审完成:", reviewed);
console.log("obtain 分布:", JSON.stringify(dist));

for (const mode of ["lottery", "trial", "promo", "conditional"]) {
  console.log("\n" + mode + ":");
  for (const r of all<{ title: string }>("SELECT title FROM items WHERE obtain = ? AND ai_keep = 1 LIMIT 5", mode)) {
    console.log("  ", r.title.slice(0, 62));
  }
}
console.log("\nfree 抽样:");
for (const r of all<{ title: string }>("SELECT title FROM items WHERE obtain = 'free' AND ai_keep = 1 ORDER BY score DESC LIMIT 8")) {
  console.log("  ", r.title.slice(0, 62));
}

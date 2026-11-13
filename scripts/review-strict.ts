import { all, run } from "./src/server/db.ts";
import { reviewItems, getAiSettings } from "./src/server/enrich/ai-settings.ts";

// 只重审当前被判为「福利」的条目：prompt 收紧后，这批里应该掉一批假福利。
const rows = all<{ id: number; title: string; summary: string | null }>(
  "SELECT id, title, summary FROM items WHERE ai_keep = 1 AND status = 'active' ORDER BY id DESC",
);
console.log("待重审:", rows.length, "条（当前判为福利的）");

const s = getAiSettings();
let flipped = 0;
let kept = 0;
let failed = 0;
const BATCH = 6;

for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const raws = chunk.map((r) => ({
    externalId: String(r.id),
    url: "https://example.com/" + r.id,
    title: r.title,
    summary: r.summary ?? "",
  })) as never[];

  let map;
  try {
    map = await reviewItems(raws, s);
  } catch {
    failed += chunk.length;
    continue;
  }
  if (!map) {
    failed += chunk.length;
    continue;
  }

  for (const [idx, v] of map) {
    const row = chunk[idx];
    if (!row) continue;
    run("UPDATE items SET ai = ?, ai_keep = ? WHERE id = ?", JSON.stringify(v), v.keep ? 1 : 0, row.id);
    if (v.keep) kept += 1;
    else {
      flipped += 1;
      if (flipped <= 15) console.log(`  撤销 | ${row.title.slice(0, 46)} | ${v.reason}`);
    }
  }
  if (i % 60 === 0) console.log(`  进度 ${i}/${rows.length}`);
}

console.log("");
console.log(`结果：仍判福利 ${kept} 条，撤销 ${flipped} 条，失败 ${failed} 条`);
const now = all<{ ai_keep: number | null; n: number }>(
  "SELECT ai_keep, COUNT(*) n FROM items WHERE status='active' GROUP BY ai_keep",
);
console.log("当前分布:", JSON.stringify(now));
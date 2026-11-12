import { all, run } from "./src/server/db.ts";
import { guessObtain } from "./src/server/enrich/obtain.ts";

// 给存量数据补 obtain（AI 还没判过的走关键词兜底）
const rows = all<{ id: number; title: string; summary: string | null; ai: string | null }>(
  "SELECT id, title, summary, ai FROM items WHERE obtain IS NULL",
);
console.log("待补:", rows.length);

let changed = 0;
const dist: Record<string, number> = {};
for (const r of rows) {
  let fromAi: string | null = null;
  if (r.ai) {
    try {
      const v = JSON.parse(r.ai) as { obtain?: string };
      fromAi = v.obtain ?? null;
    } catch {
      fromAi = null;
    }
  }
  const mode = fromAi ?? guessObtain(r.title, r.summary ?? "");
  dist[mode] = (dist[mode] ?? 0) + 1;
  run("UPDATE items SET obtain = ? WHERE id = ?", mode, r.id);
  changed += 1;
}

console.log("已写入:", changed);
console.log("分布:", JSON.stringify(dist));
console.log("\n抽奖样例:");
for (const r of all<{ title: string }>("SELECT title FROM items WHERE obtain = 'lottery' LIMIT 6")) {
  console.log("  ", r.title.slice(0, 60));
}
console.log("\n试用样例:");
for (const r of all<{ title: string }>("SELECT title FROM items WHERE obtain = 'trial' LIMIT 5")) {
  console.log("  ", r.title.slice(0, 60));
}
console.log("\n推广样例:");
for (const r of all<{ title: string }>("SELECT title FROM items WHERE obtain = 'promo' LIMIT 5")) {
  console.log("  ", r.title.slice(0, 60));
}

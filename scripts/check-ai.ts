import { all } from "./src/server/db.ts";

const dist = all<{ k: number; n: number }>(
  "SELECT json_extract(ai,'$.keep') AS k, COUNT(*) AS n FROM items WHERE ai IS NOT NULL GROUP BY k",
);
console.log("=== AI 判定分布 ===");
for (const d of dist) console.log(d.k === 1 ? "KEEP  " : "REJECT", d.n);

console.log("\n=== 被判非福利的抽样 20 条（人工核对是否误杀）===");
for (const r of all<{ title: string; reason: string; category: string }>(
  `SELECT title, json_extract(ai,'$.reason') reason, category FROM items
   WHERE json_extract(ai,'$.keep') = 0 ORDER BY RANDOM() LIMIT 20`,
)) {
  console.log("-", r.title.slice(0, 52).padEnd(54), "|", r.reason);
}

console.log("\n=== 被判福利的抽样 15 条 ===");
for (const r of all<{ title: string; reason: string; category: string }>(
  `SELECT title, json_extract(ai,'$.reason') reason, category FROM items
   WHERE json_extract(ai,'$.keep') = 1 ORDER BY RANDOM() LIMIT 15`,
)) {
  console.log("+", r.title.slice(0, 52).padEnd(54), "|", r.reason);
}

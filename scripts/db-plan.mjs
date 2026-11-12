import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("/data/radar.db");
console.log("=== 索引 ===");
for (const r of db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
  console.log(" ", r.name);
}

console.log("\n=== 关键查询计划 ===");
const plan = db
  .prepare(
    "EXPLAIN QUERY PLAN SELECT * FROM items WHERE status='active' AND ai_keep=1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY score DESC LIMIT 40",
  )
  .all(new Date().toISOString());
for (const p of plan) console.log(" ", p.detail);

console.log("\n=== 计时 ===");
const t0 = Date.now();
const rows = db
  .prepare(
    "SELECT id FROM items WHERE status='active' AND ai_keep=1 AND (expires_at IS NULL OR expires_at > ?) ORDER BY score DESC LIMIT 40",
  )
  .all(new Date().toISOString());
console.log("  ", rows.length, "行", Date.now() - t0, "ms");

const t1 = Date.now();
const cnt = db
  .prepare("SELECT COUNT(*) AS n FROM items WHERE status='active' AND ai_keep=1 AND (expires_at IS NULL OR expires_at > ?)")
  .get(new Date().toISOString());
console.log("   count", cnt.n, Date.now() - t1, "ms");

const t2 = Date.now();
db.prepare("ANALYZE").run();
console.log("  ANALYZE", Date.now() - t2, "ms");

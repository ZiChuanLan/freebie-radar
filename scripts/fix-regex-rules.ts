import { all, get, run } from "./src/server/db.ts";

const OLD = "^(请问|求助|有没有|求推荐|求一个)";
const NEW = ["请问", "求助", "有没有", "求推荐", "求一个"];

const old = get<{ id: number }>("SELECT id FROM block_rules WHERE pattern = ?", OLD);
if (old) {
  run("DELETE FROM block_rules WHERE id = ?", old.id);
  console.log("已删除正则规则:", OLD);
}
const now = new Date().toISOString();
for (const p of NEW) {
  run(
    "INSERT INTO block_rules (pattern, mode, scope, enabled, created_at) VALUES (?, 'keyword', 'all', 1, ?) ON CONFLICT(pattern, scope) DO UPDATE SET enabled = 1",
    p,
    now,
  );
}
console.log("已写入关键词规则:", NEW.join(" / "));

console.log("\n当前规则:");
for (const r of all<{ pattern: string; mode: string }>("SELECT pattern, mode FROM block_rules ORDER BY id")) {
  console.log(" ", r.mode.padEnd(8), r.pattern);
}

import { all, run } from "./src/server/db.ts";
import { mergeKey } from "./src/server/enrich/index.ts";

// 回填 title_key：入库时才开始写入 mergeKey 指纹，历史数据全是旧算法或 null。
const rows = all<{ id: number; title: string }>("SELECT id, title FROM items");
console.log("待回填:", rows.length);

let changed = 0;
for (const r of rows) {
  const key = mergeKey(r.title);
  if (key) {
    run("UPDATE items SET title_key = ? WHERE id = ?", key, r.id);
    changed += 1;
  }
}
console.log("已写入:", changed);

// 看看效果：哪些 key 覆盖了多个源
const top = all<{ title_key: string; n: number; srcs: number }>(
  `SELECT title_key, COUNT(*) n, COUNT(DISTINCT source_id) srcs
     FROM items WHERE status='active' AND title_key IS NOT NULL AND title_key != ''
       AND first_seen_at >= datetime('now','-7 days')
     GROUP BY title_key HAVING n > 1 ORDER BY srcs DESC, n DESC LIMIT 12`,
);
console.log("");
console.log("合并效果（7 天内，同一福利跨源报道 TOP 12）:");
for (const t of top) console.log(`  ${t.title_key.slice(0, 40).padEnd(40)} ${t.n} 条 / ${t.srcs} 源`);

const before = all<{ n: number }>(
  `SELECT COUNT(*) n FROM items WHERE status='active' AND first_seen_at >= datetime('now','-7 days')`,
)[0]!.n;
const after = all<{ n: number }>(
  `SELECT COUNT(*) n FROM items WHERE status='active' AND first_seen_at >= datetime('now','-7 days')
     AND (title_key IS NULL OR title_key='' OR id = (SELECT MIN(x.id) FROM items x WHERE x.title_key = items.title_key AND x.status='active'))`,
)[0]!.n;
console.log("");
console.log(`7 天内 active: ${before} 条 -> 合并后 ${after} 条（少 ${before - after} 条重复展示）`);

#!/bin/bash
docker exec freebie-radar-radar-1 node --input-type=module -e "
const { all } = await import('./src/server/db.ts');

console.log('=== Epic / 免费游戏相关条目（最近 7 天）===');
const rows = all(\`
  SELECT id, source_id, substr(title,1,44) t, title_key, substr(first_seen_at,1,16) seen
  FROM items
  WHERE status='active'
    AND (title LIKE '%Epic%' OR title LIKE '%epic%' OR title LIKE '%喜加一%' OR title LIKE '%免费游戏%')
  ORDER BY id DESC LIMIT 25
\`);
for (const r of rows) console.log('  ' + r.id, r.source_id.padEnd(22), r.seen, '|', r.t);

console.log('');
console.log('=== title_key 重复分布（active，7 天内）===');
const dup = all(\`
  SELECT title_key, COUNT(*) n, COUNT(DISTINCT source_id) srcs
  FROM items
  WHERE status='active' AND first_seen_at >= datetime('now','-7 days')
  GROUP BY title_key HAVING n > 1
  ORDER BY n DESC LIMIT 10
\`);
for (const d of dup) console.log('  x' + d.n, '跨' + d.srcs + '源 |', String(d.title_key).slice(0, 60));

console.log('');
const tot = all(\`
  SELECT COUNT(*) total, COUNT(DISTINCT title_key) uniq
  FROM items WHERE status='active' AND first_seen_at >= datetime('now','-7 days')
\`);
console.log('7 天内 active:', JSON.stringify(tot[0]));
"

#!/bin/bash
docker exec freebie-radar-radar-1 node --input-type=module -e "
const { all } = await import('./src/server/db.ts');
const rows = all(\"SELECT id, source_id, category, title_key, substr(title,1,46) t, status FROM items WHERE title_key='knightica' ORDER BY id\");
console.log('knightica 组:', rows.length, '条');
for (const r of rows) console.log('  ', r.id, r.category.padEnd(8), r.source_id.padEnd(24), r.status.padEnd(8), '|', r.t);
const cats = all(\"SELECT category, COUNT(*) n FROM items WHERE title_key='knightica' GROUP BY category\");
console.log('  category 分布:', JSON.stringify(cats));
"

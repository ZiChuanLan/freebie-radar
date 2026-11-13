#!/bin/bash
echo "=== 直接看合并后的 knightica 在列表里出现几次 ==="
docker exec freebie-radar-radar-1 node --input-type=module -e "
const { all } = await import('./src/server/db.ts');
const rows = all(\`
  SELECT items.id, items.id = (SELECT MIN(x.id) FROM items x WHERE x.title_key = items.title_key AND x.status='active') AS is_keeper,
         (SELECT COUNT(*) FROM items d WHERE d.title_key = items.title_key AND d.status='active'
            AND LENGTH(items.title_key) >= 6 AND items.category IN ('game','goods')) AS dup_count
  FROM items WHERE title_key='knightica' AND status='active' ORDER BY id
\`);
for (const r of rows) console.log('  id=' + r.id, 'is_keeper=' + r.is_keeper, 'dup_count=' + r.dup_count);
console.log('');
console.log('应保留: 1 条（id=570），其余 8 条被合并');
"

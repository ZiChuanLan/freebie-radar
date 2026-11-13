#!/bin/bash
cd /opt/freebie-radar || exit 1
echo "=== flaresolverr.ts 是否含 session 复用（f3c4a1a 的改动）==="
grep -c "ensureSession\|dropSession" src/server/flaresolverr.ts || echo "  0"

echo ""
echo "=== 重建镜像 ==="
docker compose up -d --build 2>&1 | tail -3
sleep 30

echo ""
echo "=== 健康检查 ==="
curl -s -o /dev/null -w "  /health -> %{http_code}  %{time_total}s\n" http://127.0.0.1:8788/health

echo ""
echo "=== 数据还在吗（bind mount 生效）==="
docker exec freebie-radar-radar-1 node --input-type=module -e "
const { all } = await import('./src/server/db.ts');
const t = all('SELECT COUNT(*) n FROM items')[0];
const d = all(\"SELECT ai_keep, COUNT(*) n FROM items WHERE status='active' GROUP BY ai_keep\");
console.log('  条目总数:', t.n);
console.log('  ai_keep 分布:', JSON.stringify(d));
"

echo ""
echo "=== 新功能自检：列表 dupCount + 合并 ==="
curl -s -H 'Authorization: Bearer Zichuanlan0829' "http://127.0.0.1:8788/api/items?limit=200&sort=oldest" | python3 -c '
import sys, json
d = json.load(sys.stdin)
print("  total =", d["total"])
merged = [(i["id"], i.get("dupCount"), i["title"][:38]) for i in d["items"] if (i.get("dupCount") or 1) > 1]
print("  合并组条目数:", len(merged))
for m in merged[:4]: print("   ", m)
'

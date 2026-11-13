#!/bin/bash
H='Authorization: Bearer Zichuanlan0829'
echo "=== 合并组主条目（knightica id=570）的 dupCount ==="
curl -s -H "$H" "http://127.0.0.1:8788/api/items?limit=200&sort=oldest" | python3 -c '
import sys, json
d = json.load(sys.stdin)
for i in d["items"]:
    if (i.get("dupCount") or 1) > 1:
        print("  id=%s dupCount=%s | %s" % (i["id"], i["dupCount"], i["title"][:44]))
'

echo ""
echo "=== /api/items/570/related 展开 ==="
curl -s -H "$H" "http://127.0.0.1:8788/api/items/570/related" | python3 -c '
import sys, json
d = json.load(sys.stdin)
print("  其他来源报道:", len(d["items"]), "条")
for i in d["items"][:12]:
    print("   ", (i.get("sourceName") or i["source_id"])[:26].ljust(26), "|", i["title"][:50])
'

echo ""
echo "=== 推送预览：看是否只保留一条 knightica ==="
curl -s -H "$H" "http://127.0.0.1:8788/api/push/preview" | python3 -c '
import sys, json
d = json.load(sys.stdin)
items = d.get("items") or d.get("candidates") or []
print("  预览条数:", len(items))
n = [i for i in items if "nightica" in json.dumps(i, ensure_ascii=False).lower()]
print("  其中 knightica 相关:", len(n))
' 2>/dev/null || echo "  (预览接口结构不同，跳过)"

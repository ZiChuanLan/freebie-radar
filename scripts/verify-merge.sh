#!/bin/bash
H='Authorization: Bearer Zichuanlan0829'
echo "=== 列表总数：合并开 vs 关 ==="
for m in 0 1; do
  N=$(curl -s -H "$H" "http://127.0.0.1:8788/api/items?merge=$m&limit=1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
  echo "  merge=$m -> total=$N"
done

echo ""
echo "=== 抽查 knightica 是否合并成一条 ==="
curl -s -H "$H" "http://127.0.0.1:8788/api/items?limit=200&sort=newest" | python3 -c '
import sys, json
d = json.load(sys.stdin)
dup = [(i["id"], i.get("dupCount"), i["title"][:44]) for i in d["items"] if (i.get("dupCount") or 1) > 1]
print("  列表里 dupCount>1 的条目数:", len(dup))
for x in dup[:10]: print("   ", x)
k = [i for i in d["items"] if "nightica" in i["title"] or "斗阵骑士" in i["title"]]
print("  knightica/斗阵骑士 在列表中出现:", len(k), "条")
for i in k: print("    -", i["id"], "dupCount=" + str(i.get("dupCount")), i["title"][:40])
'

echo ""
echo "=== claude 类条目是否被误合并（应保持独立）==="
curl -s -H "$H" "http://127.0.0.1:8788/api/items?limit=200&sort=newest" | python3 -c '
import sys, json
d = json.load(sys.stdin)
c = [i for i in d["items"] if "laude" in i["title"]]
print("  claude 条目在列表中出现:", len(c), "条")
for i in c[:5]: print("    -", i["id"], "dupCount=" + str(i.get("dupCount")), "|", i["category"], "|", i["title"][:38])
'

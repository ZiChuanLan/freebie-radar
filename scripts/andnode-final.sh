#!/bin/bash
echo "=== 触发 linux.do 采集，看耗时和新 prompt 生效 ==="
R=$(curl -s -X POST -H 'Authorization: Bearer Zichuanlan0829' --max-time 120 \
  'http://127.0.0.1:8788/api/sources/linuxdo-welfare/collect')
echo "$R" | python3 -c 'import sys,json; d=json.load(sys.stdin)["summary"]; print("  duration=%dms fetched=%d inserted=%d status=%s" % (d["durationMs"], d["fetched"], d["inserted"], d["status"]))' 2>/dev/null || echo "$R" | head -c 200

echo ""
echo "=== 等队列二审 ==="
sleep 45
docker logs --tail 40 freebie-radar-radar-1 2>&1 | grep -E '待审队列|\[ai\] batch|\[ai\] 放弃' | tail -6

echo ""
echo "=== 版本确认 ==="
cd /opt/freebie-radar && git log --oneline -1
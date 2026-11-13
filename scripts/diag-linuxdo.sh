#!/bin/bash
echo "=== linux.do 采集的详细日志 ==="
docker logs --tail 80 freebie-radar-radar-1 2>&1 | grep -A4 -E 'linuxdo-welfare' | tail -25
echo ""
echo "=== 直接测 RSS 三条路径 ==="
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
for u in "https://linux.do/c/welfare/36.rss" "https://linux.do/latest.rss"; do
  T0=$(date +%s%3N)
  code=$(curl -s -o /tmp/r.xml -w '%{http_code}' --max-time 20 -A "$UA" "$u")
  T1=$(date +%s%3N)
  echo "  直连 $u -> $code  $((T1-T0))ms  $(wc -c < /tmp/r.xml)B  items=$(grep -c '<item>' /tmp/r.xml)"
done
echo ""
echo "=== FlareSolverr session 状态 ==="
curl -s -X POST -H 'Content-Type: application/json' -d '{"cmd":"sessions.list"}' http://172.17.0.1:8191/v1
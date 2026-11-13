#!/bin/bash
echo "=== 容器里有没有 curl ==="
docker exec freebie-radar-radar-1 which curl 2>/dev/null || echo "  无 curl"
echo ""
echo "=== 容器基础镜像 ==="
docker exec freebie-radar-radar-1 cat /etc/os-release 2>/dev/null | head -2
echo ""
echo "=== 容器内 node fetch 直连测试 ==="
docker exec freebie-radar-radar-1 node -e "
fetch('https://linux.do/c/welfare/36.rss', { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } })
  .then(r => r.text().then(t => console.log('  node fetch ->', r.status, t.length + 'B', t.slice(0, 60).replace(/\n/g,' '))))
  .catch(e => console.log('  node fetch 失败:', e.message));
"
echo ""
echo "=== 容器内 curl 直连测试 ==="
docker exec freebie-radar-radar-1 sh -c "curl -s -o /tmp/t.xml -w '  curl -> %{http_code} %{time_total}s ' --max-time 15 -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' https://linux.do/c/welfare/36.rss && wc -c < /tmp/t.xml" 2>/dev/null || echo "  (curl 不可用)"
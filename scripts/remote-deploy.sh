#!/bin/bash
cd /opt/freebie-radar || exit 1
echo "=== 拉最新 ==="
git fetch origin main 2>&1 | tail -1
cp docker-compose.yml /tmp/dc2.bak
git stash push -u -m "preserve compose bind mount" 2>&1 | tail -1
git merge --ff-only origin/main 2>&1 | tail -2
cp /tmp/dc2.bak docker-compose.yml
grep -n "data:/data" docker-compose.yml
git log --oneline -2

echo ""
echo "=== 重建（要装 curl，会慢一些）==="
docker compose up -d --build 2>&1 | tail -2
sleep 35

echo ""
echo "=== curl 是否装进容器 ==="
docker exec freebie-radar-radar-1 which curl && docker exec freebie-radar-radar-1 curl --version | head -1

echo ""
echo "=== 健康检查 ==="
curl -s -o /dev/null -w "  /health -> %{http_code}\n" http://127.0.0.1:8788/health
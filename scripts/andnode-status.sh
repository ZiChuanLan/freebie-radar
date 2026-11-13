#!/bin/bash
cd /opt/freebie-radar || exit 1
echo "=== git 状态 ==="
git log --oneline -3
echo "--- 未提交改动 ---"
git status --short | head -20
echo ""
echo "=== 远程地址 ==="
git remote -v | head -2
echo ""
echo "=== 后台重审任务是否还在跑 ==="
pgrep -af "rs.ts" | head -3 || echo "  (无 rs.ts 进程)"
tail -3 /tmp/restrict.log 2>/dev/null
echo ""
echo "=== 容器状态 ==="
docker ps --filter name=freebie-radar --format '{{.Names}} {{.Status}}'

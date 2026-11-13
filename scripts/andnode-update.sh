#!/bin/bash
set -e
cd /opt/freebie-radar || exit 1

echo "=== 1. 备份 docker-compose.yml（bind mount 是环境差异，远程没有）==="
cp docker-compose.yml /tmp/dc.bak
grep -n "data:/data" /tmp/dc.bak

echo ""
echo "=== 2. stash 工作区改动（内容已全部在远程 commit 里）==="
git stash push -u -m "scp-overwritten working copy, already in origin/main" 2>&1 | tail -2

echo ""
echo "=== 3. 快进到 origin/main ==="
git merge --ff-only origin/main 2>&1 | tail -3
git log --oneline -3

echo ""
echo "=== 4. 恢复 docker-compose.yml 的 bind mount ==="
cp /tmp/dc.bak docker-compose.yml
grep -n "data:/data" docker-compose.yml

echo ""
echo "=== 5. 清理一次性脚本 ==="
rm -f diag-ai.ts fix-ld.ts rs.ts tp.ts
git status --short | head -10
echo "(以上若为空即工作区干净)"
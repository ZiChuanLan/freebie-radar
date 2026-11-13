#!/bin/bash
cd /opt/freebie-radar || exit 1
echo "=== docker-compose.yml 的改动（环境相关，不能丢）==="
git diff docker-compose.yml
echo ""
echo "=== 本地 origin/main 里的最新 commit ==="
git fetch origin main 2>&1 | tail -3
git log --oneline origin/main -3

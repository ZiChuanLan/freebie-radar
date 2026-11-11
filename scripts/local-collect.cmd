@echo off
rem freebie-radar local collector: 采集知乎/小红书/小黑盒并回传服务器
cd /d H:\WorkSpace\freebie-radar
set HEADLESS=1
if not exist logs mkdir logs
node scripts\pw-collect.mjs %* >> logs\local-collect.log 2>&1

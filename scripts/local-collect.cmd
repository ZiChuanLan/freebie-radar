@echo off
rem freebie-radar 登录态采集：抓取知乎 / 小红书 / 小黑盒并回传服务器
rem
rem 必需：INGEST_TOKEN（与服务器端一致）
rem 可选：SERVER_URL（默认 http://127.0.0.1:8788）
rem       PROFILE_DIR（登录态目录，首次运行会打开浏览器让你登录）
rem       HEADLESS=1 无头运行（默认开启，便于定时任务）
cd /d "%~dp0.."
set HEADLESS=1
if not exist logs mkdir logs
node scripts\pw-collect.mjs %* >> logs\local-collect.log 2>&1

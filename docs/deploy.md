# 部署与运维指南

## Docker Compose 一键部署（推荐）

本项目使用 `node:24-alpine` 单容器运行（成品镜像 ~340 MB），内置 Node.js 原生 `node:sqlite`（WAL 模式），无需外接 PostgreSQL / Redis，且设置了 V8 堆与 SQLite 缓存限制，主服务容器实测常驻内存约 **80–100 MiB**。

```bash
git clone https://github.com/ZiChuanLan/freebie-radar.git
cd freebie-radar

# 可选：复制并编辑环境变量（配置 ADMIN_TOKEN / Telegram 推送 / 代理等）
cp .env.example .env

# 启动主服务（不建 .env 也可直接启动，会自动建表并初始化 63 个内置源）
docker compose up -d --build
```

验证健康检查：

```bash
curl http://127.0.0.1:8788/health
```

### 可选：拉起 FlareSolverr 过 Cloudflare 护盾

大多数数据源（包括 `linux.do` RSS、OpenRouter、Epic、Steam、GamerPower、NodeSeek RSS 等）均可由容器内 `curl` / `fetch` 直连。如果你开启了需要复杂 Cloudflare 挑战的站点，可启用内置的 `cf` profile：

```bash
# 在 .env 中添加：FLARESOLVERR_URL=http://flaresolverr:8191
docker compose --profile cf up -d --build
```

> 服务已内置会话空闲 **90 秒** 自动销毁释放浏览器内存的机制，避免空闲时长期占用数百 MB RAM。

## 反向代理（Nginx / Caddy）

建议使用 Caddy 或 Nginx 配置 HTTPS 反代并设置强 `ADMIN_TOKEN`：

```caddyfile
radar.example.com {
    reverse_proxy 127.0.0.1:8788
}
```

## 常用运维命令

```bash
cd freebie-radar

# 查看实时采集与推送日志
docker compose logs -f --tail 50

# 手动全量采集一次 / 或采集指定源
docker compose exec radar node --no-warnings src/server/cli.ts collect
docker compose exec radar node --no-warnings src/server/cli.ts collect linuxdo-welfare

# 批量 AI 补审或重审（pending | recent | rejected）
docker compose exec radar node --no-warnings src/server/cli.ts ai-review 100 pending

# 重新生成今日精选（--dry-run 只预览不写入/推送）
docker compose exec radar node --no-warnings src/server/cli.ts daily --dry-run

# 升级到最新版本（数据保存在 ./data/radar.db 不会丢失）
git pull origin main
docker compose up -d --build
```

## 登录态站点接入（知乎 / 小红书 / 小黑盒）

这三类站点要求浏览器会话与前端动态签名，采用 **零 Cookie 上传** 方案：

1. 在你自己的桌面电脑或带图形界面的环境运行回环助手：
   ```bash
   SERVER_URL=https://your-radar-domain.com INGEST_TOKEN=your_token node scripts/pw-collect.mjs serve
   ```
2. 打开雷达网页「数据源运维」，点击对应源的 **「扫码登录」** 按钮：会跳往本地 `http://127.0.0.1:18789/login` 弹窗扫码；登录成功后自动采集一轮公开帖子推入 `/api/ingest`，**立即关闭浏览器释放全部内存并跳回雷达页面**。
3. 不想安装 Node / Playwright 的用户，也可在「数据源运维 → 登录态接入」中一键复制 **Tampermonkey 油猴脚本**，直接在日常浏览器里触发回传。

# Cloudflare 部署（本 fork 的默认形态）

本 fork 是 **CF-only 分叉**：整个应用（HTTP 路由 + SQLite + 调度 + 攒批推送）
住在一个单例 Durable Object（`RadarDO`）里，Worker 只做两件事：

- `/api/*`、`/health` → 转发给 DO
- 其余路径 → Workers Static Assets（`dist/web`，SPA fallback）
- Cron Trigger 每分钟调 `DO.tick()`；哪些源真跑仍由 `sources.interval_sec` 决定

## 前置

- Workers **Paid** 计划（Durable Objects 不在免费额度内，约 $5/月 + 用量）
- `pnpm install`

## 部署

```bash
pnpm build          # vite build → dist/web
wrangler deploy     # 首次部署会自动建 DO 类 + sqlite storage
```

密钥走 secrets（不要写进 wrangler.toml）：

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put TELEGRAM_BOT_TOKEN   # 可选
wrangler secret put AI_API_KEY           # 可选
wrangler secret put GITHUB_TOKEN         # 可选
wrangler secret put INGEST_TOKEN         # 可选，pw-collect 回传用
```

非密钥配置在 `wrangler.toml` 的 `[vars]`。`PUSH_CHANNEL=telegram` +
上述两个 TG 变量即启用推送。

## 本地开发

```bash
pnpm dev            # wrangler dev（miniflare 本地 DO + sqlite）
pnpm dev:web        # vite 前端热更（/api 已代理到 wrangler dev 的 8787）
curl http://127.0.0.1:8787/__scheduled   # --test-scheduled 时手动触发 tick
pnpm test           # node:test，走 node:sqlite 适配器（tests/sqlite-adapter.ts）
```

## 与上游的差异（维护用）

| 上游（Node 版） | 本 fork |
|---|---|
| `node:sqlite` + WAL 文件 | DO `storage.sql`（同步 API，`tests/sqlite-adapter.ts` 给测试注入 node:sqlite） |
| `PRAGMA user_version` | `__migrations` 表（DO 禁该 PRAGMA） |
| `is_zh(title)` SQLite UDF | `items.is_zh` 列，入库时由 JS 写（v17 迁移含回填） |
| `setInterval` 三套调度 | `DO.tick()`：collect / push flush / daily / cleanup / flare 会话回收 |
| `spawn curl`（TLS 指纹绕盾） | 已删——Workers 无子进程，linux.do 类源只能走外挂 FlareSolverr |
| undici `HTTP_PROXY`/`TELEGRAM_PROXY` | 已删——Workers 无出口代理 |
| `@hono/node-server` + serveStatic | Worker fetch + `[assets]` binding |
| `cli.ts`/`index.ts`/`migrate.ts`/`local/`、Dockerfile | 已删（CF-only） |

已知边界：

- **DO 单点**：单例对象串行处理，与原版单进程 SQLite 语义一致；攒批队列在内存里，
  DO 回收即丢（原版进程重启同样丢）。
- **cron 粒度 1 分钟**：linux.do 的 90s 间隔实际按 60–120s 触发，够近。
- **手动全量采集**（管理端「立即采集」）可能跑几分钟——DO 请求没有 30s 响应墙，
  但单次 RPC/fetch 仍受 worker 单次执行时限约束；超时先按源分批触发。
- FlareSolverr / `pw-collect` 保持外挂：`/api/ingest` 端点签名未变，
  脚本把目标地址换成 workers.dev 域名即可。

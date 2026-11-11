# 白嫖雷达 Freebie Radar

多源聚合「免费 / 可领取 / 限时开放注册」类福利信息：定时采集 → 归一化去重打分 → SQLite → Web 站浏览筛选 → 每日精选（可推 Telegram）。

## 现在能抓什么

| 源 | 入口 | 说明 |
|---|---|---|
| LINUX DO 福利羊毛 / 资源荟萃 | `linux.do/c/36`、`c/14` JSON | 需过 Cloudflare，走 FlareSolverr |
| V2EX 免费赠送 | `v2ex.com/api/topics/show.json?node_name=free` | 需墙外出口，走 FlareSolverr 或直连 |
| GitHub 免费清单 | `api.github.com` contents | free-for-dev 等 awesome 仓库，零登录 |
| 福利吧 / 吾爱破解 / 什么值得买 | RSS | 直连；52pojie 为 GBK 编码 |
| Telegram 频道 | `t.me/s/<channel>` | 逻辑已实现，需自己填频道名 |

实测（2026-11-11，境外机器）：7 源 / 190 条 / 0 失败，全程约 10 秒（FlareSolverr session 复用后 linux.do 单板块 1-2s）。

## 快速开始（本地）

```bash
pnpm install
cp .env.example .env      # 按需改端口与 FLARESOLVERR_URL
pnpm migrate
pnpm collect              # 采集全部启用的源
pnpm build                # 构建前端到 dist/web
pnpm start                # http://127.0.0.1:8788
```

开发时前后端分开：

```bash
pnpm dev        # API :8788
pnpm dev:web    # Vite :5173，/api 代理到 8788
```

## 快速开始（Docker）

```bash
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:8788/health
```

数据落在命名卷 `radar-data`（容器内 `/data/radar.db`）。手动触发一次采集：

```bash
docker compose exec radar node --no-warnings node_modules/tsx/dist/cli.mjs src/server/cli.ts collect
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8788 | 监听端口（8787 常被 PixPin 占用） |
| `DATABASE_PATH` | ./data/radar.db | SQLite 路径，Docker 内用 /data/radar.db |
| `FLARESOLVERR_URL` | 空 | 例如 `http://172.17.0.1:8191`；留空则 linux.do 直连（会 403） |
| `HTTP_PROXY` / `HTTPS_PROXY` | 空 | 本机无墙外出口时指向代理 |
| `ENABLED_SOURCES` | 空 | 逗号分隔的源 id，留空=全部启用 |
| `MAX_ITEMS_PER_RUN` | 50 | 单源单次上限 |
| `GITHUB_TOKEN` | 空 | 可选，把 GitHub 限额从 60/h 提到 5000/h |
| `COLLECT_CRON` | `0 */2 * * *` | 采集周期 |
| `DAILY_CRON` | `30 8 * * *` | 每日精选生成时间 |
| `ENABLE_SCHEDULER` | true | 关掉后只能手动跑 |
| `PUSH_CHANNEL` | none | none=只落库；telegram=推送 |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | 空 | 推送凭据 |
| `TELEGRAM_PROXY` | 空 | 推送单独走代理（本机直连不上 api.telegram.org） |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 空 | 可选 AI 二审，走 OpenAI 兼容 `/chat/completions` |

## 常用命令

```bash
pnpm collect                              # 全部启用的源
node --no-warnings node_modules/tsx/dist/cli.mjs src/server/cli.ts collect v2ex-free   # 单个源
... cli.ts sources                        # 看源状态与游标
... cli.ts enable tg-channels             # 启用/禁用
... cli.ts config tg-channels '{"channels":["somechannel"]}'   # 改源配置
... cli.ts daily --dry-run                # 只打印今日精选，不落库
... cli.ts daily                          # 生成并记录（PUSH_CHANNEL=none 时不外发）
... cli.ts digests                        # 最近日报记录
pnpm test                                 # 14 个单测
```

## 采集登录态站点（知乎 / 小红书 / 小黑盒）

这三站需要浏览器登录态和前端签名，服务器上抓不了，改由本机 `ego-browser` 采集后回传：

```bash
# 1. 确保 ego-browser 已登录对应站点（小红书需扫码一次）
bash -lc "cd /h/WorkSpace/freebie-radar && ego-browser nodejs < scripts/local-collect.mjs"
```

脚本依次抓知乎 3 个关键词、小红书、小黑盒 2 个关键词，去重后 POST 到 `SERVER/api/ingest`。
顶部 `SERVER` / `TOKEN` / 关键词列表可直接改；设 `ONLY = "zhihu"` 只跑单站；服务器需配置同名 `INGEST_TOKEN`。

## 加一个新源

1. 在 `src/server/collectors/` 新建文件，实现 `Collector`（`kind` + `collect(ctx)`，返回 `{ items, cursor?, degraded? }`）。
2. 在 `src/server/collectors/index.ts` 注册到 `COLLECTORS`，并在 `SEEDS` 加一条源定义。
3. 重跑采集即可；去重键是 `(source_id, external_id)` + 规范化 URL。

已有 kind：`linuxdo` / `v2ex` / `github-readme` / `rss` / `telegram` / `mock`。纯 RSS 源不用写代码，直接 `cli.ts config` 加 feed 即可。

## 已知限制

- **知乎 / 小红书 / 小黑盒**：走本机 ego-browser（复用已登录会话）采集，脚本 `scripts/local-collect.mjs`，结果 POST 到服务器的 `/api/ingest`。知乎（47 条）与小黑盒（20 条）已实测打通；小红书需在 ego-browser 里扫码登录一次。服务器端无法直采这三站——它们依赖用户登录态与前端签名。
- **Telegram 频道**：抓取逻辑已用 `t.me/s/durov` 验证可用（20 条消息），但没有可确认长期更新的中文羊毛频道清单，源默认 disabled。
- **TG 推送**：本机网络直连不上 `api.telegram.org`，需要 `TELEGRAM_PROXY` 或部署在墙外机器；未配 token 时只落库不外发。
- **RSSHub 公共实例 / hostloc / 线报酷**：实测不可用（403 / 非 RSS / 超时），见 `docs/data-sources.md`。
- **FlareSolverr 首次冷启动慢**：首次解 Cloudflare 约 1-2 分钟，之后复用 session 降到 1-2 秒。

## 结构

```
src/server/        API、采集器、打分、日报、调度
src/web/           React + Tailwind 单页
tests/             分类与规范化单测
docs/              数据源侦察、分类抽样、截图
```

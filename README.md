# 白嫖雷达 · Freebie Radar

聚合全网「免费领取 / 限时白嫖 / 注册就送」福利信息的自建雷达：定时采集 → 归一化去重打分 → AI 二审 → SQLite → Web 站筛选浏览 → 每日精选 + Telegram 即时推送。

目标是**真的能拿到手**，而不是让一堆广告、抽奖、试用和新闻混进来。为此系统有三层过滤：关键词规则 → AI 二审 → 获取方式（obtain）分级。

## 特性

- **57 个源**：LINUX DO、V2EX、NodeSeek、什么值得买、吾爱破解、GitHub awesome 仓库、GamerPower、Epic 官方接口、Reddit、Bluesky、Telegram 频道，以及知乎 / 小红书 / 小黑盒（登录态采集，本地或远程均可）
- **获取方式分级**：区分「直接白嫖 / 有条件 / 抽奖 / 试用 / 推广 / 需付费」，抽奖和广告不会混进真福利
- **AI 二审**：任意 OpenAI 兼容网关，判定「到底能拿到什么」，网页可改端点、模型、提示词、送审上限，改完立即生效
- **低延迟**：分源采集间隔（热门源 90 秒）+ 采集后即时推送，从发帖到 Telegram 约 2 分钟
- **兑换码提取**：自动从正文抽出邀请码/激活码/兑换码，前端一点即复制
- **屏蔽词防火墙**：关键词或正则、全局或单源，同时作用于列表、日报和推送
- **价格与预算筛选**：完全白嫖 / ≤5 / ≤10 / ≤30 / ≤100 元，宁可不抽也不抽错
- **运维面板**：开关源、改采集间隔、立即采集、看错误原因、加任意 RSS

## 架构

```
采集器 (collectors/*)          →  RawItem
  ↓ enrich/normalize           归一化、URL 去重、关键词分类、打分、价格抽取
  ↓ enrich/ai                  AI 二审（keep + category + obtain + reason）
  ↓ collectors persist         SQLite（items / sources / settings / push_logs）
  ↓ routes.ts                  Hono REST API
  ↓ src/web                    React + Vite 单页应用
  ↓ push.ts / digest.ts        Telegram 即时推送、攒批、每日精选
```

| 目录 | 职责 |
|---|---|
| `src/server/collectors/` | 每个源一个采集器，统一 `RawItem` 契约 |
| `src/server/enrich/` | 归一化、打分、价格抽取、关键词规则、AI 二审、获取方式判定 |
| `src/server/push.ts` | 推送策略：阈值、静默时段、语言、分类、价格、obtain、去重 |
| `src/server/digest.ts` | 每日精选生成 |
| `src/server/routes.ts` | 全部 REST 端点 |
| `src/web/src/` | 前端：资源流 / 每日精选 / 订阅与屏蔽 / 推送规则 / AI 引擎 / 数据源运维 |
| `scripts/pw-collect.mjs` | 登录态站点采集（知乎、小红书、小黑盒），本地或远程部署均可，需人工触发 |

## 快速开始

```bash
pnpm install
cp .env.example .env      # 按需改端口、代理、Telegram
pnpm migrate              # 建表 + 写入源定义
pnpm collect              # 采集全部启用的源
pnpm build                # 构建前端到 dist/web
pnpm start                # http://127.0.0.1:8788
```

开发时前后端分开跑：

```bash
pnpm dev        # API :8788
pnpm dev:web    # Vite :5173，/api 代理到 8788
```

### Docker

```bash
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:8788/health
```

数据落在命名卷 `radar-data`（容器内 `/data/radar.db`）。

## 配置

配置分两层：

- **`.env`**：进程级参数（端口、代理、数据库路径、推送凭据）。改完要重启。
- **网页设置**：推送策略、屏蔽词、各源采集间隔、AI 二审配置都存 `settings` / `sources` 表，改完**立即生效**，不用重启。

AI 二审在「AI 引擎」页配置，只填端点、模型、Key 三项即可；不配置则只走关键词规则。

## 部署注意事项

### 出网要求

公开源（linux.do / V2EX / Reddit / Epic / GamerPower 等）从国内家庭宽带会超时，采集服务要放在**能直连境外**的机器上，并且需要一台常驻的 [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) 过 Cloudflare。也可以把 `HTTP_PROXY` 指向一个境外出口。

### 登录态站点（知乎 / 小红书 / 小黑盒）

这三个站要登录态和前端签名，抓取由 `scripts/pw-collect.mjs` 用**持久化 Chrome profile** 完成。脚本本身不关心运行在哪，只认两个环境变量：`PROFILE_DIR`（登录态所在目录）和 `SERVER_URL`（结果回传到哪里）。

**本地跑** —— profile 在你自己的机器上，第一次运行会打开浏览器让你登录一次，登录态留在本地磁盘：

```bash
scripts\local-collect.cmd
```

**远程跑** —— 把 profile 目录放到服务器上（或第一次在服务器上登录一次），定时任务照常跑：

```bash
PROFILE_DIR=/data/profile SERVER_URL=http://127.0.0.1:8788 HEADLESS=1 INGEST_TOKEN=xxx node scripts/pw-collect.mjs
```

两种方式的结果都走 `POST /api/ingest`，带 `INGEST_TOKEN` 鉴权，服务端按 `(source_id, external_id)` 去重写入。

### 数据边界

无论哪种部署方式，回传的只有**公开帖子的标题、链接、摘要**。服务端不保存 cookie、账号密码或任何登录凭据——登录态始终只存在于 `PROFILE_DIR` 这个本地目录里，删掉即失效。数据库里也没有用户身份字段。

## CLI

```bash
pnpm tsx src/server/cli.ts sources              # 列出所有源与状态
pnpm tsx src/server/cli.ts collect [sourceId]   # 采集（不传则全部）
pnpm tsx src/server/cli.ts enable <id...>       # 启用源
pnpm tsx src/server/cli.ts disable <id...>      # 禁用源
pnpm tsx src/server/cli.ts reclassify           # 重跑关键词分类与打分
pnpm tsx src/server/cli.ts ai-review [limit]    # 历史条目补审
pnpm tsx src/server/cli.ts obtain [--all]       # 重算获取方式
pnpm tsx src/server/cli.ts diagnose             # 推送体检：确认没有非白嫖条目漏出
```

## 数据源

完整清单、入口 URL、访问要求见 [`docs/data-sources.md`](docs/data-sources.md)。
已探测但不可用的源（Cloudflare、签名、已下线）也记录在里面，省得重复踩坑。

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/data-sources.md`](docs/data-sources.md) | 全部数据源与可达性实测 |
| [`docs/obtain.md`](docs/obtain.md) | 获取方式分级：怎么区分白嫖与抽奖/试用/推广 |
| [`docs/ai.md`](docs/ai.md) | AI 二审的提示词设计、判定口径与误判处理 |
| [`docs/push.md`](docs/push.md) | 推送三层分流、静默时段时区、去重 |
| [`docs/timing.md`](docs/timing.md) | 时效性优化：分源间隔、即时推送、正文快照 |
| [`docs/deploy.md`](docs/deploy.md) | 部署与运维 |
| [`docs/classification-review.md`](docs/classification-review.md) | 分类规则复盘 |
| [`DESIGN.md`](DESIGN.md) / [`PRODUCT.md`](PRODUCT.md) | 前端设计语言与产品定位 |

## 已知限制

- 抽奖 / 试用 / 推广靠 AI + 关键词判定，边界情况仍会误判，页面上可以按获取方式单独查看和核对
- 老帖没有截止时间，靠发布时间算保鲜期（默认 14 天，真福利精选 7 天）
- 偶发几十秒的接口尖峰来自采集调度器与读请求争抢同一个 SQLite，与查询写法无关
- `会员免费`（如 Prime 会员看 Kindle）按当前口径算「需付费」，不计入白嫖

## 免责

本项目只做公开信息的聚合与去重，不存储、不传播任何受版权保护的内容，也不提供账号共享。抓取频率已按各站实际情况限流，请自行遵守目标站点的使用条款。

## License

[MIT](LICENSE)

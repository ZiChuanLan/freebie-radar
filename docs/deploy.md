# 部署记录

## 结论

代码已在本机开发验证，并部署到 **RN / racknerd（Easytier `10.144.144.6`，公网 `192.129.128.178`）** 的 Docker 上常驻运行。

- 本机访问：<http://10.144.144.6:8788>（实测 health 200 / 首页 200）
- 容器：`freebie-radar-radar-1`（镜像 `freebie-radar:latest`，326MB）
- 数据：命名卷 `freebie-radar_radar-data` → `/data/radar.db`
- 调度：容器内 cron 已启动 `collect="0 */3 * * *"` `daily="30 8 * * *"`

## 为什么不是 andnode

用户指定的 andnode 公网地址 `43.251.117.74` 用本机两把 SSH 私钥（`mg-aliyun`、`mg_prod_ed25519`）均返回 `Permission denied (publickey,password)`，且 Easytier 内网没有对应节点。当前可达的两台是：

| 主机 | Easytier | 出墙 | Docker |
|---|---|---|---|
| racknerd-3088ede | 10.144.144.6 | ✅ linux.do / V2EX / Telegram 可达 | ✅ |
| hcss-ecs-4492（华为云） | 10.144.144.8 | ❌ 境外站全部 000 | ❌ |

RN 上已有常驻 FlareSolverr 容器，因此选它作为采集出口。若确认 andnode 的地址与凭证，把 `/opt/freebie-radar` 拷过去、改 `.env` 的 `FLARESOLVERR_URL` 即可平移。

## 实测输出

容器内全量采集：

```
[github-free-for-dev] parsed 60 entries   -> fetched=60 inserted=60 status=ok duration=969ms
[linuxdo-resource]  -> fetched=30 inserted=30 status=ok duration=1996ms
[linuxdo-welfare]   -> fetched=30 inserted=30 status=ok duration=1034ms
[rss-52pojie]       -> fetched=20 inserted=20 status=ok duration=1149ms
[rss-fuliba]        -> fetched=20 inserted=20 status=ok duration=98ms
[rss-smzdm]         -> fetched=20 inserted=20 status=ok duration=898ms
[v2ex-free]         -> fetched=10 inserted=10 status=ok duration=1205ms
[collect] done: 7 sources, 0 failed, 190 inserted
```

`/api/stats`：`{"total":190,"active":188,"expired":2,"last24h":162}`

## 全新目录从零跑通

按 README 在 `/tmp/fresh-radar` 复制一份、改端口 8799、`docker compose -p freshradar up -d --build`：

```
fresh health:  {"ok":true,"version":"0.1.0",...}
fresh collect: [v2ex-free] fetched=10 inserted=10 status=ok duration=2016ms
fresh stats:   {"total":10,"active":10,...}
```

验证后已 `docker compose -p freshradar down -v` 并删除临时目录。

## 本机开发环境

本机无墙外出口，开发时通过 RN 的 FlareSolverr（`FLARESOLVERR_URL=http://10.144.144.6:8191`）取 linux.do / V2EX。RN 上的容器则用 `http://172.17.0.1:8191`（容器内已验证可达）。

## 审计修复记录（第二轮）

针对独立审计驳回的四点，逐项修复并留证：

| 审计意见 | 修复 | 证据 |
|---|---|---|
| 日报线上为空、前端无入口 | 新增 `/api/digests/:date` 返回完整 items；前端加「每日精选」tab（日期 chips + 正文预览 + 条目卡片）；服务器执行 `cli.ts daily` 生成当日日报 | `/api/digests` 返回 `2026-11-11` 12 条；截图 `docs/ui-digest.png` |
| 三个登录态源 `last_run_at` 为 null、未纳入定时 | `ingestItems()` 现在同时写 `runs` 记录并更新 `sources.last_run_at/last_status`；新增 Windows 计划任务 `freebie-radar-local`（每日 09:30，headless），包装脚本 `scripts/local-collect.cmd` | `/api/sources` 三个源 last_run_at 均有值；`schtasks /query` 显示 Next Run 2026/11/12 9:30；计划任务实跑日志三站均 `status: 200` |
| README 陈旧（ego-browser / local-collect.mjs） | 全部改为 Playwright + `scripts/pw-collect.mjs` | README 内已无 ego 相关描述 |
| 前端缺详情视图、SOURCE_LABEL 缺新源、token 硬编码 | 新增 `ItemDetail` 弹窗（摘要/时间/标签/收藏/忽略/原文）；补齐 5 个源的显示名；`pw-collect.mjs` 改为从 `.env` 读 `INGEST_TOKEN`，缺失即退出 | `pnpm build` 通过；`node --check scripts/pw-collect.mjs` 通过 |

### 第三轮修复（针对第二次审计驳回）

| 审计意见 | 修复 | 验证 |
|---|---|---|
| 登录态失效时不标 degraded、不写 /status | 新增 `POST /api/ingest/failed`（Bearer 鉴权）+ `markSourceFailure()`；`pw-collect.mjs` 在「需要登录 / 0 条 / 抓取异常」三条路径上报 degraded/failed | 实测：`{"ok":true,"status":"degraded"}`，`/api/sources` 中 zhihu-search 变为 `degraded` 且 `last_error=测试登录态失效`；随后真实采集恢复为 `ok` |
| 服务器调度把 ingest 源当不支持的源 | `runAll()` 只取 `kind` 有注册 collector 的源，ingest 源不参与服务器调度 | 实测 `ENABLED_SOURCES=zhihu-search collect` → `[collect] done: 0 sources, 0 failed`，不再出现 `no collector registered` |
| 每日精选里的详情/收藏/忽略按钮无操作 | `DigestPanel` 接收真实 `onPatch` / `onOpen`，与资源流共用同一套 handler | `tsc` 通过，构建产物含「查看详情」「打开原文」 |
| 日报截图显示「推送关」，与推送声明不一致 | 用 Playwright 重新截图线上 `#digest` | `docs/ui-digest.png` 现在显示「推送 telegram」「2026-11-11 已推送」「12 条 · 已推送 Telegram」 |
| 精选含「豆包月卡不够用了」「维修被收 2800」等非福利内容 | `pickDaily()` 加三道门槛：`MIN_DIGEST_SCORE=55`、`DEAL_HINT`（必须有免费/领取/额度等福利信号）、`NOISE_TITLE`（排除请问/怎样/求推荐/不够用/评测等讨论帖）；数量不足时只放宽分数，不放宽关键词 | 治理后当日 12 条全部为福利（Grok 免费一个月、Qwen 注册送 10$、网易云会员、BLG 免费领皮肤、邀请码…），无一条讨论/维修/评测帖 |
| `.env.example` 仍引用 local-collect.mjs | 改为 Playwright 脚本 | 文件内已无 ego/local-collect 字样 |
### 采集失败重试

计划任务首次运行出现 zhihu / xhs 的 `TypeError: fetch failed`（Easytier 链路瞬时抖动，同批 xiaoheihe 成功）。已给 `push()` 加 3 次重试 + 60s 单次超时 + 打印 `err.cause`，重跑计划任务三站全部 200。

## 运维

```bash
cd /opt/freebie-radar
docker compose logs -f --tail 50          # 采集与调度日志
docker compose restart
docker compose exec radar node --no-warnings node_modules/tsx/dist/cli.mjs src/server/cli.ts collect
docker compose exec radar node --no-warnings node_modules/tsx/dist/cli.mjs src/server/cli.ts daily --dry-run
```

## 未完成项（需用户输入）

1. **Telegram 推送已实发**：RN 的 `.env` 已配置 `PUSH_CHANNEL=telegram` + `TELEGRAM_BOT_TOKEN`（@museailan_bot）+ `TELEGRAM_CHAT_ID=970259783`。`cli.ts daily` 实跑输出 `[daily] 2026-11-11 已推送 12 条到 Telegram`，`digests.pushed_at` 写入时间戳；另用 `sendMessage` 单独验证返回 `{"ok":true,"result":{"message_id":9,...}}`。每日 08:30（容器 cron）自动推送，Web「每日精选」页会标注「已推送 Telegram」。
2. **Telegram 羊毛频道清单**：抓取逻辑验证可用（`t.me/s/durov` 抓到 20 条消息），缺真实频道名，源保持 disabled。
3. **知乎 / 小红书 / 小黑盒已全部接入**：Playwright 驱动持久化 Chrome profile（`%LOCALAPPDATA%\freebie-radar-chrome`，登录一次持久化），采集后回传 `/api/ingest`。实测一批：知乎 47 条、小红书 74 条（全部新增）、小黑盒 20 条。脚本 `scripts/pw-collect.mjs`，支持 `node scripts/pw-collect.mjs xhs` 跑单站。

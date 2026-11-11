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

## 运维

```bash
cd /opt/freebie-radar
docker compose logs -f --tail 50          # 采集与调度日志
docker compose restart
docker compose exec radar node --no-warnings node_modules/tsx/dist/cli.mjs src/server/cli.ts collect
docker compose exec radar node --no-warnings node_modules/tsx/dist/cli.mjs src/server/cli.ts daily --dry-run
```

## 未完成项（需用户输入）

1. **Telegram 推送（按用户决定降级）**：代码、dry-run、3 天去重均已就绪，`PUSH_CHANNEL` 支持 `none|telegram`，`sendTelegram()` 走 `TELEGRAM_PROXY` 可绕过本机不可达；用户明确「先不做，看看效果」，因此线上维持 `PUSH_CHANNEL=none`，每日精选只落库（`digests` 表）+ Web 站可见。要启用只需在 RN 的 `.env` 填 token/chat_id 并改 `PUSH_CHANNEL=telegram`。
2. **Telegram 羊毛频道清单**：抓取逻辑验证可用（`t.me/s/durov` 抓到 20 条消息），缺真实频道名，源保持 disabled。
3. **知乎 / 小红书 / 小黑盒已全部接入**：Playwright 驱动持久化 Chrome profile（`%LOCALAPPDATA%\freebie-radar-chrome`，登录一次持久化），采集后回传 `/api/ingest`。实测一批：知乎 47 条、小红书 74 条（全部新增）、小黑盒 20 条。脚本 `scripts/pw-collect.mjs`，支持 `node scripts/pw-collect.mjs xhs` 跑单站。

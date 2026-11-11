# 数据源侦察报告

> 实测时间：2026-11-10 / 2026-11-11。所有结论都来自真实请求输出，原始数据见 `docs/probe-results.json`、`docs/probe2-results.json`、`docs/fs-test.json`。

## 0. 网络拓扑（决定了整个架构）

| 位置 | 出口 | 能访问 | 不能访问 |
|---|---|---|---|
| 本机 Windows (H:/WorkSpace) | 国内家宽 | GitHub API、52pojie、什么值得买、知乎/小红书/小黑盒页面 | **linux.do、V2EX、Telegram、rsshub.app、github.com(raw)** 全部连接超时 |
| RN / racknerd `192.129.128.178`（Easytier `10.144.144.6`） | 美国 | linux.do（CF 挑战）、V2EX、Telegram、GitHub、RSS | 部分国内站偶发 RST（fuliba 首测 ECONNRESET，复测 200） |
| 华为云 `10.144.144.8` | 国内 | 国内站 | 墙外站全部 000 |

本机实测（`node scripts/probe.mjs`）：

```
linuxdo_latest_json  -> ERR UND_ERR_CONNECT_TIMEOUT
v2ex_api_free_node   -> ERR UND_ERR_CONNECT_TIMEOUT
gh_api_rate          -> 200   (api.github.com)
gh_commits_atom      -> ERR UND_ERR_CONNECT_TIMEOUT   (github.com 主站)
rsshub_zhihu_hotlist -> ERR UND_ERR_CONNECT_TIMEOUT
telegram_api         -> ERR UND_ERR_CONNECT_TIMEOUT
xhs_explore          -> 200 -> 302 /login
zhihu_home           -> 200 -> 302 /signin
52pojie_rss          -> 200
smzdm_rss            -> 200
```

> 用户明确要求：**本机不允许开启 Clash 代理**。因此凡是被墙的源，一律通过 RN 出网。

### 关键能力：FlareSolverr

RN 上已有常驻容器 `fs`（`flaresolverr/flaresolverr:latest`，监听 `0.0.0.0:8191`，Easytier 内网可直连）。它成功解掉 linux.do 的 Cloudflare「Just a moment」。

```
POST http://10.144.144.6:8191/v1  {"cmd":"request.get","url":"https://linux.do/latest.json"}
-> {"status":"ok","message":"Challenge solved!", "solution":{"status":200,...}}
```

注意：`solution.response` 对 JSON 接口会被包进 `<html><body><pre>{...}</pre>`，取 `<pre>` 内容再 `JSON.parse`；HTML 页面请求 60s 超时（`c/36.json` 这类 JSON 接口稳定成功，页面渲染不稳定）。

## 1. 源矩阵

| # | 源 | 入口 | 可达性（实测） | 登录态 | 首版 | 价值 |
|---|---|---|---|---|---|---|
| 1 | **LINUX DO 福利羊毛** `c/36` | `https://linux.do/c/36/l/latest.json?order=created`（经 FlareSolverr） | 200 / 85200B / 30 topics | 否 | ✅ 主力 | ★★★★★ |
| 2 | **LINUX DO 资源荟萃** `c/14` | `https://linux.do/c/14/l/latest.json?order=created` | 同上机制 | 否 | ✅ 主力 | ★★★★ |
| 3 | **V2EX 免费赠送** `node=free` | `https://www.v2ex.com/api/topics/show.json?node_name=free` | 200 / 22395B / JSON 数组 | 否 | ✅ 主力 | ★★★★★ |
| 4 | **GitHub free-for-dev** | `https://api.github.com/repos/ripienaar/free-for-dev/contents/README.md` | 200 / 383539B / base64 | 否 | ✅ | ★★★★ |
| 5 | GitHub 其它 awesome 仓库 | `https://api.github.com/search/repositories?q=...` | 200 | 否 | ✅ | ★★★ |
| 6 | **福利吧 fuliba** | `https://fuliba.net/feed` | 200 / 213938B / RSS 20+ | 否 | ✅ | ★★★★ |
| 7 | **Telegram 频道** | `https://t.me/s/<channel>` | 200 / 146819B（RN 直连） | 否 | ✅ | ★★★★★ |
| 8 | 吾爱破解 52pojie | `https://www.52pojie.cn/forum.php?mod=rss` | 200 / 9214B（**GBK 编码**） | 否 | ⚠️ 可选 | ★★ |
| 9 | 什么值得买 | `https://www.smzdm.com/rss/` | 200 / 32017B | 否 | ⚠️ 可选 | ★★（多为评测资讯） |
| 10 | 知乎 | `api/v4/search_v3` → 401 `身份未经过验证`；首页 302 `/signin` | 不可匿名 | 是（cookie + `x-zse-96`） | ⏸ 二期 | ★★★★ |
| 11 | 小红书 | `/explore` → 302 `/login`；页面仅 SPA 外壳 | 不可匿名 | 是（cookie + `x-s`） | ⏸ 二期 | ★★★★ |
| 12 | 小黑盒 | `api.xiaoheihe.cn/bbs/app/api/web/feeds` → 404；首页 3918B SPA 外壳 | 需签名 | 是 | ⏸ 二期 | ★★★ |
| 13 | RSSHub 公共实例 | `rsshub.app` → **403 Cloudflare**（RN 同样 403）；`rsshub.rssforever.com` → 503 | 不可用 | - | ❌ 降级 | - |
| 14 | hostloc | `forum.php?mod=rss` → 200 但返回 HTML（CF 拦截页），无 XML | 不可用 | - | ❌ 降级 | - |
| 15 | 线报酷 linebaoku | `/feed` → 000 超时 | 不可达 | - | ❌ 降级 | - |

### 样本（真实抓取，2026-11-10）

linux.do `c/36` 福利羊毛：

```
#3152335 mlh联合Grok Premium 免费一个月
#3152067 【双十一抽奖】拿出 600 美刀额度，请 22 位佬友用模型
#3151806 【快跑AI】 Qwen Audio 系列多款音频模型 72 折 已上线 注册送10$
#3151437 云栖Emby 此次开放注册150人
```

52pojie（GBK 解码后）：

```
锁定解锁文件夹工具v20261110
全新PC微信实用小工具
求芝士架构系统架构设计师2026年最新资料
```

## 2. 首版落地范围

**纳入**：linux.do(36/14)、V2EX free、GitHub(free-for-dev + awesome 搜索)、fuliba、Telegram 频道、52pojie、smzdm。

**降级/二期**：知乎、小红书、小黑盒 —— 三者都需要登录态 + 请求签名，且采集端在墙外服务器上没有用户浏览器会话。二期方案（已与用户确认方向）：本机已登录浏览器（CDP）抓取后 POST 到服务端 ingest 接口。

**不纳入**：RSSHub 公共实例、hostloc、线报酷（实测不可用）。

## 3. 采集约束

- 限速：同一源最小间隔 2s；linux.do 走 FlareSolverr 时串行，单次 maxTimeout 60s。
- 凭据：FlareSolverr 地址、GitHub token（可选，把 60/h 提到 5000/h）、Telegram 频道清单全部走环境变量。
- 增量：按 `(source, external_id)` 唯一键去重；适配器返回 `cursor`（如 linux.do 的 `more_topics_url`）用于翻页。
- 失败隔离：单源异常写入 `runs` 表 status=failed + 错误摘要，不影响其它源。

## 4. 待办（进入实现前已确认）

1. 部署目标机待最终确认：RN（`192.129.128.178`，已验证墙外可达 + 有 FlareSolverr）或用户所说 andnode（`43.251.117.74`，SSH 凭证未知）。代码不绑定机器，先在本机开发。

## 5. 实际采集结果（2026-11-11 本机实测）

| 源 id | adapter | 条数 | 耗时 | 结果 |
|---|---|---|---|---|
| linuxdo-welfare | linuxdo (c/36) | 30 | 109.8s（首次建 session） | ok |
| linuxdo-resource | linuxdo (c/14) | 30 | 7.6s（复用 session） | ok |
| v2ex-free | v2ex (node=free) | 10 | 2.1s | ok |
| github-free-for-dev | github-readme | 60 | 2.4s | ok |
| rss-52pojie | rss (GBK) | 20 | 0.18s | ok |
| rss-smzdm | rss | 20 | 0.25s | ok |
| rss-fuliba | rss | 20 | 0.79s | ok |
| tg-channels | telegram | 0 | — | **blocked：缺真实频道清单** |

入库后分布：linuxdo-welfare 均分 56、v2ex-free 均分 63、linuxdo-resource 42、52pojie 39、fuliba 36、github 33、smzdm 26。

### 结论与后续

- **linux.do 可以跑**：FlareSolverr 复用命名 session 后，第二次起从 ~110s 降到 ~8s。首次仍需耐心（Chromium 冷启动 + 解挑战）。
- **v2ex 可以跑**：同样的 fs 通道，2s 返回 10 条 JSON。
- **GitHub / 52pojie / smzdm / fuliba 直连可用**：无需任何登录或代理。52pojie 的 GBK 编码靠 Content-Type + XML 声明双重探测解出。
- **tg-channels 仍 blocked**：`t.me/s/<channel>` 抓取逻辑已验证可用（用 `durov` 测到 20 条消息），但手上没有可确认存在且持续更新的中文羊毛频道清单，源保持 disabled，等用户给频道名后 `cli.ts config tg-channels '{"channels":[...]}'` 一行即可启用。
- **知乎 / 小红书 / 小黑盒**：维持二期（需登录态 + 签名），在 `/status` 中以 blocked 呈现。
2. Telegram 推送用户已明确「先不急做这个」，首版只落本地日报，接口预留。

## 6. 三个登录态站点（Playwright + 持久化 profile，2026-11-11 实测打通）

三站都需要用户登录态；小黑盒还额外要求前端签名。最终方案：**Playwright 驱动一个持久化的 Chrome profile**（`%LOCALAPPDATA%\freebie-radar-chrome`），登录一次写进磁盘，之后任意次运行都带着登录态。

实现：`scripts/pw-collect.mjs`，结果 POST 到 `SERVER_URL/api/ingest`（Bearer token）。

| 站 | 抓法 | 实测 |
|---|---|---|
| 知乎搜索 | `/search?type=content&q=`，读 `.SearchResult-Card` 的 `h2 a` + `.RichText` | ✅ 3 关键词去重后 47 条（inserted=3，其余已存在） |
| 小红书搜索 | `/search_result?keyword=`，滚动 3 屏后读 `section.note-item` 的 `.title span` + `a.cover` | ✅ 3 关键词去重后 74 条，全部新增 |
| 小黑盒搜索 | `/app/bbs/home` → 填 `.el-input__inner` + Enter → 监听 `general/search` 响应 | ✅ 2 关键词去重后 20 条（inserted=7） |

### 小黑盒为什么必须走浏览器

搜索接口 `https://api.xiaoheihe.cn/bbs/app/api/general/search/v1` 需要 `hkey` / `_time` / `nonce` / `_rnd` 四个签名参数，由前端 JS 生成，直接 HTTP 请求无法复现。因此用 Playwright 监听 `page.on("response")`，让页面自己发签名请求，脚本只负责填关键词、回车、读拦截到的 JSON。

附带发现：小黑盒 web 端没有独立搜索路由，`/app/bbs/search` 会被重写成 `/app/bbs/home` 且丢弃关键词；只有 UI 输入框触发的 SPA 跳转 `/app/search/list?q=...` 才会真正调签名接口。

### 走过的弯路（记录以免重犯）

1. **ego-browser**：知乎可用（复用用户日常浏览器登录态），但小红书在该实例里始终未登录，且 `taskSpace` 会被用户接管导致脚本报 `already exists and belongs to the user`。
2. **独立 Chrome + CDP**：用户在该 profile 扫码登录成功，但 CDP 手写客户端要自己处理等待与选择器；改为 Playwright 后同一 profile 直接可用，`launchPersistentContext` 一行拿到登录态。
3. Playwright 用 `channel: "chrome"` 复用系统 Chrome，与已有 profile 完全兼容，无需 `playwright install`。

### 去重验证

- 知乎第二次：`received=47 inserted=3 skipped=44`
- 小黑盒第二次：`received=20 inserted=7 skipped=13`

同一资源不会重复入库，只有标题/摘要变化的会更新。

## 7. 第二批源（游戏与海外福利，2026-11-11 实测）

用户反馈「白嫖内容不够、游戏方面太少」。新增 8 个源，全部实测入库：

| 源 id | 采集器 | 入口 | 实测 |
|---|---|---|---|
| `gamerpower` | gamerpower (JSON) | `gamerpower.com/api/giveaways?type=game` | ✅ 14 条（Epic/Steam/GOG/itch.io/IndieGala/DRM-Free 全平台聚合，含 worth 与 end_date） |
| `epic-free` | epic (JSON) | `store-site-backend-static-ipv4.../freeGamesPromotions` | ✅ 3 条（本周免费 2 + 即将免费 1，带原价与起止时间） |
| `rss-reddit-freegames` | rss | `reddit.com/r/FreeGameFindings/hot.rss` | ✅ 25 条 |
| `rss-reddit-efreebies` | rss | `reddit.com/r/efreebies/hot.rss` | ✅ 25 条 |
| `rss-reddit-gamedeals` | rss | `reddit.com/r/GameDeals/hot.rss` | ✅ 25 条 |
| `rss-slickdeals` | rss | `slickdeals.net/newsearch.php?rss=1` | ✅ 25 条 |
| `rss-heyitsfree` | rss | `heyitsfree.net/feed` | ✅ 20 条 |
| `rss-keylol` | rss | `keylol.com/forum.php?mod=rss`（中文 Steam 社区） | ✅ 20 条 |

结果：游戏类条目从 23 → **102**，全站在库 710 条 / 18 个有数据的源。

### 踩到的两个坑

1. **Reddit 的 atom feed 触发 XML 实体展开上限**：`Entity expansion limit exceeded: 1028 > 1000`。fast-xml-parser 默认展开实体并限制 1000 次，Reddit 的单条 feed 就超了。解法：`processEntities: false`，实体交给后面的 `cleanText` / `decodeEntities` 统一处理。
2. **Reddit 连续请求 429**：同一 IP 连抓 3 个子版会被限流（HTTP 429），隔 45 秒重试即可通过。当前三个 Reddit 源分属不同 `source_id`，服务器定时批次里会连续触发，因此把它们的采集间隔留给统一限速（`MIN_REQUEST_GAP_MS`）+ 失败重试自然恢复；单轮失败会被记为 failed 并在下一轮补上。

### 探测后放弃的源

| 目标 | 状态 | 原因 |
|---|---|---|
| old.reddit.com JSON | 403 | IP 被封，只有 .rss 可用 |
| GOG 免费列表 API | 400 | `/games/ajax/filtered?price=free` 已改接口 |
| freestufffinder.com | 403 | Cloudflare |
| NGA 福利版 | 403 | 反爬 |
| nitter.net | 410 | 实例已下线 |
| steamdb.info/upcoming/free | 403 | Cloudflare |
| x.com/EpicGames | 200 HTML | 能打开但内容是 JS 渲染 + 登录墙，单页解析不稳定；tg/reddit 已覆盖同类信息，暂不接入 |

## 8. 第三批源（全量铺开，2026-11-11）

按「能找到的全加」的要求，又探测约 50 个候选，落地 13 个新源：

| 源 id | 实测 |
|---|---|
| `rss-reddit-freebies` / `-apphookup` / `-freeebooks` / `-googleplay` | 各 25 条（App 限免、免费电子书、Google Play 折扣） |
| `rss-giveawayoftheday` | 10 条（每日一款正版软件限免） |
| `rss-appinn`（小众软件） | 10 条 |
| `rss-sspai`（少数派） | 10 条 |
| `rss-ithome`（IT之家） | 25 条 |
| `rss-producthunt` | 25 条 |
| `rss-hnrss`（HN 100+ 分） | 16 条 |
| `rss-freebieshark` | 23 条 |
| `rss-9to5toys` | 25 条 |
| `steam-free` | 1 条（`search/results?maxprice=free&specials=1`，当前只有 1 个 100% off） |
| `gog-free` | **已禁用**，见下 |

全站在库 1051 条 / 31 个有数据的源，游戏类 111 条。

### Reddit 限流（关键约束）

Reddit 对同一 IP 的 `.rss` 请求限制极严：并发 4 路会全 429，串行 9 秒间隔仍会有 6/9 失败。因此：

- 新增 `SOURCE_GAP_MS`（默认 3000）在 `runAll()` 的源之间插入间隔；
- Reddit 各子版拆成独立 `source_id`，单源失败只标记自己 failed，不牵连其它源，下一轮自动补；
- 实测同源重试 1 次即成功（`freeebooks` 首次 429，20 秒后 ok）。

### GOG 为什么放弃

`catalog.gog.com/v1/catalog` 的 `price=free` / `priceBetween=0,0` / `discount=100` 三个参数**实测都不生效**：返回 48 个普通折扣游戏（-10% / -50% / -90%），没有一个是 0 元。GOG 真正的免费（GOG Giveaway）通过首页 banner 发放，商店页是 Angular SSR，解析成本高而单周通常只有 0-1 个。源保留但 `enabled=false`。

### Steam 的一个正则坑

`<a href=".../app/...">` 上挂了超长的 `onmouseover` / `data-ds-*` 属性，从 `href` 到 `<span class="title">` 实际有 1-2KB。最初限制 800 字符，结果 0 条；放宽到 3000 后正常。

### 前端不再写死源名

`App.tsx` 改为启动时拉 `/api/sources`，用后端 `name` 覆盖内置表（`SOURCE_NAMES`）。以后加源只需改 `SEEDS`，前端零改动。

### 探测后仍不可用

`bensbargains` / `hunt4freebies` / `greenmangaming` / `epic_free_page` / `steamgifts` 均 403；`xbox_gwg` 404；`sampleaday` / `free_app_watch` 域名不可解析；`humblebundle` API 403、页面需 JS；`fanatical` API 返回 249KB 但结构为混合页面数据，未找到免费列表字段；`itch.io` 无 JSON 接口（`/games/free.json` 404）。

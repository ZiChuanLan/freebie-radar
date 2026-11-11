# UI 与功能改造（2026-11-11 晚）

## 1. 新增 25 个源（57 个源 / 3040 条）

### 游戏喜加一与史低

| 源 | 实现 | 实测 |
|---|---|---|
| `cheapshark-free` | CheapShark API `deals?upperPrice=1`，覆盖 Steam/Epic/GOG/Fanatical/Humble 等 15 家商店 | 38 条（含 `$0.00` 免费与 `$1` 内白菜价） |
| `rss-isthereanydeal` | ITAD 官方 giveaways RSS | 14 |
| `rss-indiegamebundles` | 独立游戏免费分类 | 20 |
| `rss-ggdeals` | GG.deals 动态（免费与评测） | 24 |
| `rss-reddit-freegamesonsteam` | r/FreeGamesOnSteam | 25 |
| `tg-freegames` | TG @FreeGamesInfo + @freegamesnews | 41 |
| `bsky-gamedeals` | Bluesky 六个游戏大号（FreeGameFindings / Wario64 / CheapAssGamer / DekuDeals / SteamDB / FreeGameAlert） | 56 |

### 国内社区

`v2ex-deals` / `v2ex-share` / `v2ex-promotions` / `v2ex-cloud`（各 9-10 条）、`rss-nodeseek`（29）、`tg-cn-deals`（TG @nodeseekc + @zaihuapd + @vps_offers，79）

### 软件 / AI / 开源

`rss-sharewareonsale`（20）、`rss-tickcoupon`（5）、`rss-iplaysoft`（25）、`rss-iapps`（10）、`github-public-apis`（40）、`github-awesome-ai`（40）、`github-selfhosted`（40）

### 综合羊毛

`rss-vonbeau`（30）、`rss-hip2save`（30）、`rss-ozbargain`（20）、`rss-lowendbox`（20）、`rss-ruanyifeng`（3）

### 关键发现：Bluesky 是 X 的免费替代

X 本身打不开（`syndication.twitter.com` 429、nitter 实例全挂：451/403/500），但**游戏圈和羊毛圈的大号几乎都在 Bluesky 有镜像**。`public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed` 免登录、免 key、返回 JSON、零反爬，一次拉 10 条。这是本项目接入"社交平台信息流"最省事的路径。

### 探测失败清单

`gg.deals/freebies`、`steamgifts`、`lowendtalk`、`nodeseek.com` 全站、`hostloc` 均被 Cloudflare 挡（FlareSolverr 也拿不到有效内容，返回的是 challenge 页）；`dealabs/hotukdeals/mydealz` 的免费分类 RSS 路径 404；`x.com` 与各 nitter 实例全部不可用。

---

## 2. UI 重写

| 改动 | 说明 |
|---|---|
| 侧栏分组 | 源按「国内社区与线报 / 游戏喜加一与史低 / 软件·AI·开源 / 综合羊毛与优惠」四组折叠，默认收起子项，一眼看清每类体量 |
| 四种 tab | 资源流 / 每日精选 / 订阅与屏蔽 / 运维，支持 `#rules`、`#ops` 直接分享（含 `hashchange` 监听，浏览器前进后退可用） |
| 双视图 | 卡片视图（默认，含摘要与标签）与紧凑视图（一行一条，80 条一屏扫完） |
| 新筛选 | 只看未读、只看含兑换码、按价格排序（`price_asc`，免费排最前） |
| 已读态 | 点开原文自动标已读，已读卡片半透明，`read_at` 落库 |
| 兑换码 | 黄色胶囊，点击复制并弹 toast，不再需要进原帖翻 |
| 快捷屏蔽 | 每张卡片上的 🚫 图标 → 弹窗自动把标题切成候选词（去掉【】与标点），点一下即可加入全局或仅本源屏蔽 |
| 导出 | `/api/export` 按当前筛选导出 Markdown（含码），可 `format=json` |

### 踩的坑：hooks 嵌套导致整站白屏

用 `insert` 把 `hashchange` 的 `useEffect` 插到了另一个 `useEffect` 的回调里，React 直接抛 `Minified React error #321`（Invalid hook call），整棵树不渲染。**表现是页面全黑、`/health` 和 API 都 200，很容易误判成网络问题。** 定位方式：本地起静态服务 + `page.on("pageerror")` 抓真实报错，因为无头 Chrome 连 Easytier 虚拟网卡时请求会挂起，直接连远程看到的只有超时。

### 踩的坑：静态资源缓存

`serveStatic` 的 `root`/`path` 相对 `process.cwd()`，之前传绝对路径靠运气工作；且未设 `Cache-Control`，发版后浏览器可能拿旧 `index.html` 去请求已删除的旧 JS → 白屏。现在 `/assets/*` 走 `immutable` 长缓存，`index.html` 走 `no-store`。

---

## 3. 屏蔽词防火墙

### 数据模型（v5 迁移）

```sql
CREATE TABLE block_rules (
  id, pattern, mode('keyword'|'regex'), scope('all'|source_id), enabled, created_at
);
ALTER TABLE items ADD COLUMN read_at TEXT;
```

### 三个作用点

1. **列表**：keyword 规则直接下推成 SQL `NOT LIKE`（索引友好），regex 规则先全表求 id 再 `NOT IN`；
2. **每日精选**：`pickDaily()` 先过 `isBlocked()`；
3. **即时推送**：`pushInstant()` 先过 `isBlocked()`，屏蔽的内容不会再吵你。

### 可观测

- `/api/block-rules` 返回每条规则的 `hits`（当前命中多少条）和 `totalBlocked`；
- 「订阅与屏蔽」页底部可一键抽查「被屏蔽的条目」，防止误杀好资源；
- 规则停用/删除后条目立刻恢复（原数据从未删除）。

### 预设噪音词

一键导入 12 条：`避坑 / 测评 / 横评 / 怎么选 / 值得买吗 / 致歉 / 股价 / 油价 / 漏电 / 研学 / 冠军阵容 / ^(请问|求助|有没有|求推荐|求一个)`。

实测导入后拦截 **49 条**（如「暖风机和取暖器差在哪」「低成本DDR4装机主板横评」「长白山ClubMed开村在即：带娃滑雪家庭测评」），全站 2990 → 2941。

---

## 4. 运维页

- 表格列出全部源：启用开关、采集间隔下拉（60 秒~6 小时，改完立即生效）、条目数、最近采集时间、状态徽章、错误信息；
- 每个源「立即采集」按钮，直接看抓取/新增条数；
- 顶部可**添加任意 RSS/Atom 源**（填名称 + URL + 间隔），保存即试采一次并回报结果；
- 「发一条 Telegram 测试消息」按钮，验证推送链路；
- 采集记录表按时间倒序显示最近 40 条。

---

## 5. 修复

- **Telegram 采集器 0 条**：之前无条件走 FlareSolverr，拿回的是人机校验页。改为直连优先、解析不到才降级。`tg-freegames` 从 0 → 41 条。
- **`database is locked`**：调度器与手动 CLI 是两个进程共用一个 SQLite 文件，`busy_timeout` 从 5 秒提到 20 秒。
- **价格误判**：`free shipping` / `免运费` 不再让整条被判为白嫖（`FAKE_FREE` 先剥离）；「注册送 $5」「抽 200 份 49 元」这类"送/抽/奖"前缀的金额不再当成售价，价格已知条目 619 → 1242 更准。
- **GitHub 清单支持 Markdown 表格**：`public-apis` 用表格而非列表，之前解析出 0 条，现在 40 条。同时过滤 shields.io 徽章链接。


# 时效性改造（2026-11-11）

> 目标：把「送码帖出现」到「你手机上看到」的延迟从几小时压到 2 分钟以内。

**问题**：送码 / 送邀请码的帖子，码通常 1 分钟内被抢光甚至被脚本爬走。原来的「每 3 小时采集 + 每天 8:30 一份日报」在时间尺度上完全不够。

### 四层改造

1. **每源独立采集间隔**（`sources.interval_sec`）
   - `linuxdo-welfare` **90 秒**、`v2ex-free` **120 秒**、`linuxdo-resource` 180 秒
   - GamerPower 15 分钟、Reddit/Slickdeals 30 分钟、Epic 1 小时、GitHub 6 小时
   - 调度器 `startIntervalScheduler()` 每 30 秒 tick 一次，按 `last_run_at + interval_sec <= now()` 挑出到期的源，串行执行。
   - 实测日志：`linuxdo-welfare` 每 90 秒一轮，单轮 ~5 秒。

2. **即时推送**（`src/server/instant.ts`）
   - 采集后立刻判断新条目：**含兑换码** / **含「先到先得/限量/名额/兑换码」** / **评分 ≥ 70** → 立即发 Telegram，不等日报。
   - 限流：每小时最多 24 条，单轮最多 5 条，发送成功才写 `items.pushed_at`。
   - 实测：`[instant] linuxdo-welfare 即时推送 1 条`。

3. **兑换码抽取**（`src/server/enrich/codes.ts`）
   - 三类规则：显式标注（`邀请码/兑换码/激活码/code` 后紧跟的 token）、分段码（`XXXX-XXXX-XXXX`）、超长大写串（10-40 位）。
   - 排除纯数字（多为价格）、常见英文词（FREE/WINNER/STEAM…）、URL 片段。
   - 前端把码渲染成可点击复制的黄色胶囊，详情弹窗里也能复制。

4. **正文快照**
   - `linuxdo-welfare` 开启 `fetchContent`：抓最新 5 帖的 `/t/{id}.json`，把首帖正文存进 `items.content`（实测 2 秒/帖）。
   - 原帖被编辑或删除后，改了什么、码是什么，站内仍有留档。

### 数据库迁移 v3

```sql
ALTER TABLE sources ADD COLUMN interval_sec INTEGER NOT NULL DEFAULT 10800;
ALTER TABLE items ADD COLUMN content TEXT;
ALTER TABLE items ADD COLUMN codes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE items ADD COLUMN pushed_at TEXT;
```

已有源的 `interval_sec` 通过 `scripts/fix-interval.mjs` 一次性写入（`ON CONFLICT` 不会覆盖，避免重启把用户改过的值冲掉）。

### 实测

- 采集频率：90s / 120s / 180s 三轮全 ok，单轮 1-5 秒。
- 即时推送：构造一条含 `VERIFY-TEST-9001` 的条目，函数返回 `pushed: 1`，TG 收到「⚡ 新羊毛 · 含兑换码」。
- 全站 1223 条 / 31 个有数据的源。


## 10. 价格筛选（2026-11-11）

需求：「我最高能付 5 块钱」或「完全想白嫖」。

### 抽取规则（`src/server/enrich/pricing.ts`）

**只在高可信模式命中时记录价格**，避免把「省 30 块」「200 元耳机怎么选」当成售价：

| 模式 | 例子 |
|---|---|
| 符号前置 | `¥3.5`、`￥5` |
| 最低/仅需/只需 | `最低 3 元`、`低至 0.03 元` |
| 价格+动词 | `3 元起`、`5 元入手`、`9.9 元带走` |
| 美元符号 | `$4.66`（Slickdeals） |

排除：数字前 8 个字符内出现 `省|贵|涨|降|价值|原价|满|返|抵|券|股价|市值` 时忽略（这些是描述性金额，不是要付的钱）。USD 按 7.2 折算成人民币统一比较。

「完全白嫖」判定：**只看标题**里的 `免费|白嫖|0元|零元|限免|白送|免单|不要钱|免费领|free`。摘要不参与——否则「京东 plus 看着福利很多其实没价值」这种会被误标成白嫖。

### 前端

左侧栏「我能付多少」六个按钮：不限 / 完全白嫖 / ≤5 元 / ≤10 元 / ≤30 元 / ≤100 元，下方实时显示「白嫖 423 · ≤5 元 18」。卡片上直接打绿色 `白嫖` 徽章或 `N 元内` 徽章。

### API

```bash
curl '.../api/items?freeOnly=1'      # 完全白嫖
curl '.../api/items?maxPrice=5'      # ≤5 元（含免费）
curl '.../api/stats'                 # price: {free, under5, under10, known}
```

### 实测

- 全站 1662 条，其中 `is_free` 423 条、≤5 元 18 条、≤10 元 14 条，价格已知 619 条。
- 抽样核对：`最低3元` → 3 元；`领 ¥3.5 体验额` → 3.5 元；`$4.66` → 33.5 元；`省30块` 不入库（被排除词拦掉）。

### 踩的坑：`codes` 是字符串不是数组

后端 `items.codes` 存的是 JSON 字符串（`'["ABC"]'`），`shape()` 里解析了 `tags` 和 `ai` 却漏了 `codes`，前端直接 `item.codes.map(...)` 抛 `(h.codes ?? []).map is not a function`，整棵 React 树崩溃变成白屏。修法是 `shape()` 里补 JSON 解析并用 `Array.isArray` 兜底。教训：**新增 JSON 列必须同步改 `shape()`**，否则前端拿到字符串。


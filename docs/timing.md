
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


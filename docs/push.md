# 推送系统重构（2026-11-11 深夜）

之前推送是硬编码：`score >= 70` 立即推、每小时最多 24 条、中英文混推、不分时段。全部改成可配置 + 分级 + 分语言。

## 1. 设置持久化（v6 迁移）

```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE push_log (id, kind, item_ids, text, count, ok, error, created_at);
ALTER TABLE items ADD COLUMN title_key TEXT;   -- 跨源去重用的标题指纹
```

14 个设置项存在 `settings` 表里，网页上改完立刻生效，不用重启：

| 设置 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 推送总开关 |
| `instantScore` | 70 | **立即推送**阈值 |
| `batchScore` | 60 | **进攒批**阈值 |
| `instantOnCodes` | true | 含兑换码/邀请码立即推（不看分数） |
| `instantOnUrgent` | true | 标题含「先到先得/限量 N/送 N 个」立即推 |
| `maxPerHour` | 24 | 每小时总上限 |
| `maxPerInstant` | 5 | 单次最多几条 |
| `batchIntervalMin` | 30 | 攒批间隔；0 = 关闭攒批 |
| `maxPerBatch` | 8 | 一批最多合并几条 |
| `quietHours` | 23:30-08:00 | 静默时段 |
| `timezone` | Asia/Shanghai | **静默按哪个时区算** |
| `langMode` | all | all / zh / en |
| `includePrice` | true | 推送里带价格 |
| `includeDeadline` | true | 推送里带截止时间 |
| `dedupeByTitle` | true | 跨源标题去重 |

## 2. 三级分流

```
新条目 → 屏蔽词过滤 → 语言过滤 → 标题去重
         ├─ 含码 / 手慢无 / ≥instantScore ──→ ⚡ 立即单发
         ├─ ≥batchScore 且标题带福利信号 ──→ 📦 攒批队列（每 30 分钟合并一条）
         └─ 其余 ──→ 只入库，不打扰
```

静默时段内，**本要立即发的也降级进攒批**，早上一起发。

## 3. 中英文处理

`detectLang()` 按标题里 CJK 字符占比判断（>15% 算中文）。三种模式：

- **全部**：中英文都推，英文条目在推送里标 `EN`
- **只要中文**：跳过英文源（CheapShark / Reddit / Slickdeals / OzBargain 等）
- **只要英文**：跳过中文源

价格统一折算成人民币显示（`约 ¥35`），美元按 7.2 换算，所以英文条目也能一眼看出贵不贵。

## 4. 静默时区的坑

容器默认 **UTC**。用户设「23:30-08:00」是想北京时间夜里别吵，但服务器按 UTC 判断，实际静默的是北京时间 07:30-16:00 —— **正好把白天静音、半夜推送**。

修法：`inQuietHoursZoned()` 用 `Intl.DateTimeFormat(..., { timeZone })` 取目标时区时分，设置里有 `timezone` 字段，网页可选北京时间/东京/UTC/美东/伦敦。

实测：容器 UTC 20:xx（北京 04:xx）→ `/api/push` 返回 `inQuiet=true`，正确。

## 5. 噪音过滤（真实事故）

上线后第一次真实推送推出去的是：

> ⚡ 新羊毛 · 限量/限时
> 看台冲突致球迷头部受伤送医：直接动手者、组织方、俱乐部…

**原因**：`URGENT` 正则里有裸的 `送` 字，「送医」被当成「送码」。而且即时推送完全没过噪音过滤。

三处修复：

1. 新建 `enrich/noise.ts` 共享 `NOISE_TITLE` / `DEAL_HINT` / `URGENT`，digest 和 push 用同一套；
2. `URGENT` 收紧：`送\s*\d+\s*(个|份|张|枚|次)`、`送码`、`送体验金`，删掉裸 `送`、`抢`、`限时`、`最后`；
3. 即时推送与攒批都要过 `NOISE_TITLE`，攒批还要 `DEAL_HINT`（标题里必须真有福利信号）。

`NOISE_TITLE` 补充：`致歉|股价|油价|冲突|送医|受伤|事故|判刑|被捕|辞职|解散|阵容|转会|投诉|维权|涨价|降价|跌破|市值|财报|营收|裁员|上市|权益价|万元|车型|发布会`。

修完效果（同一批数据）：

```
修复前                             修复后
看台冲突致球迷受伤送医     ✗        —（不再出现）
长安 Lumin 上市 4.99 万起  ✗        —（不再出现）
                                    【OxWork】抽 200 份 Plus 会员 ✓
                                    Super Duolingo 两个月会员 ✓
                                    【福利】送五个 500M 动态IP测试 ✓
                                    Epic 额外隐藏免费游戏 ✓
```

## 6. 推送记录与预览

- `push_log` 表记录每次推送：类型（instant/batch）、条数、完整文本、成功与否、错误信息；
- 「推送」页底部列出最近 40 条，失败标红并显示错误；
- **推送预览**：按当前设置算一遍「如果现在推会推什么」，不真发。调阈值后点一下就能看到效果，不用等真推送来验证。

## 7. API

```bash
curl .../api/push                          # 设置 + 统计 + 是否静默
curl -X PATCH .../api/push -H 'content-type: application/json' -d '{"instantScore":80,"langMode":"zh"}'
curl '.../api/push/preview?limit=6'        # 预览
curl '.../api/push/log?limit=30'           # 推送记录
curl -X POST .../api/push/flush            # 立刻发攒批队列
curl -X POST .../api/push/test             # 发一条测试消息
```

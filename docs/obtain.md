# 获取方式（obtain）：把「不算完全白嫖」的东西单独隔离

## 为什么要这个维度

价格维度（`is_free` / `price`）只回答「要不要钱」，回答不了「能不能确定拿到」。
「抽 200 份会员」「免费试用 7 天」「免费体验我们的服务」在价格上都写 0 元，
但一个是抽签、一个到期收费、一个是广告——混在「真福利」里会让人白高兴。

所以加了一个正交维度 `obtain`：

| 值 | 含义 | 例子 |
| --- | --- | --- |
| `free` | 点开就能领，不需要任何附加动作 | Epic 本周免费游戏、Termini 永久 Pro 限免 |
| `conditional` | 要回帖/盖楼/转发/关注/邀请/实名/绑卡 | 「回帖送 $1 体验金」、邀请官送会员卡 |
| `lottery` | 抽名额/开奖/随机送，不一定轮到你 | 「抽 200 份 Plus 会员」、Instagram Giveaway |
| `trial` | 免费试用 N 天或首月免费，到期收费 | Azure 12 个月免费额度、7 天免费体验 |
| `promo` | 商家推广自家服务的引流钩子 | 「注册送 $5，充值才用」、Walgreens 免费照片 |
| `paid` | 要实付钱 | 需付费的折扣商品 |

## 判定链路

1. **AI 二审**（`src/server/enrich/ai.ts`）：提示词里加了 obtain 字段，
   并明确「免费体验我们的服务」「注册送体验金但充值才用」算 trial/promo，不算 free。
2. **关键词兜底**（`src/server/enrich/obtain.ts` 的 `guessObtain`）：
   AI 没结论或老数据用它，顺序是 抽奖 > 推广 > 试用 > 有条件 > free。
   顺序有意为之——「免费体验我们的服务」既匹配免费也匹配推广，必须判 promo。

## 生效位置

| 位置 | 行为 |
| --- | --- |
| 真福利精选 | 只留 `obtain = free` + AI 判定是福利 + 7 天内 + 未过期 |
| 完全白嫖 | 只留 `obtain = free` + 价格 0 元 + 14 天内 |
| 左侧「获取方式」 | 可单选查看 直接白嫖 / 有条件 / 抽奖 / 试用 / 推广 |
| 条目徽章 | 非 free 的条目在价格标签旁显示彩色徽章 |
| Telegram 推送 | `push.obtainModes` 默认 `["free"]`，抽奖/试用/推广不推 |
| 每日精选 | 同样走 `passesPushFilters`，受 `applyToDigest` 控制 |

## 保鲜期：28 天前的老帖为什么会出现

原来 `unexpired` 只判断 `expires_at`。论坛帖大多没有截止时间，
于是 28 天前的「美团单车 7 天卡，免费送，先到先得」被当成现役福利一直挂着。

现在 `unexpired=1` 是两层条件：

1. `COALESCE(published_at, first_seen_at) >= now - maxAgeDays`（默认 14 天，真福利精选 7 天）
2. `expires_at IS NULL OR expires_at > now`

推送候选 SQL 也补了 7 天窗口，否则「一键发攒批」会把早抢完的老帖再推一遍。

## 性能教训

第一版把条件写成 `((expires_at IS NOT NULL AND expires_at > ?) OR (expires_at IS NULL AND COALESCE(...) >= ?))`，
`OR` + `COALESCE` 叠加让索引整体失效，列表从 1.3 秒退化到 8-13 秒。修法：

- 拆成两个独立 AND 条件，不要用 `(A OR B)` 包住不同列
- `obtain` 用 `obtain IN (...)` 而不是 `COALESCE(obtain,'free') IN (...)`，否则 `idx_items_obtain` 用不上
- 加表达式索引 `idx_items_effective_time ON items(COALESCE(published_at, first_seen_at))`

修复后：真福利精选 ~1s、全部收录 1.7-2.4s、抽奖 ~2.8s。
偶发的几十秒尖峰是采集调度器抢占单节点线程，与查询写法无关。

## 当前数据分布

```
全部     free 5702  conditional 217  paid 127  lottery 75  promo 57  trial 29
真福利   free 450   conditional 80   lottery 45  trial 20  promo 13  paid 6
```

即真福利里有 164 条（27%）其实不是完全白嫖，现在被隔离出去了。
真福利精选从 533 条降到 322 条，被 7 天窗口挡掉 149 条、被 obtain 挡掉约 60 条。

## 已知误判

- 老数据的 `obtain` 有一部分来自关键词兜底（AI 提示词后加，历史 ai JSON 里没这个字段），
  对 `ai_keep = 1` 的条目已用新提示词重跑过一次。
- 关键词仍会误伤：「Double 击飞手法、配队和抽取建议」这类游戏攻略因为含「抽取」被判 lottery；
  它们大多 `ai_keep = 0`，不在真福利里，影响有限。
- AI 二审本身仍有漏网：PowerShell 7.7 发布、WindTerm 开源实现这类技术分享偶尔被判 keep=true。

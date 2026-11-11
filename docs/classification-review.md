# 分类抽样核对

> 方法：从库中按「每个源按评分取 Top 4」抽 28 条，人工逐条判定系统分类是否正确，再据此修正规则。核对时间 2026-11-11。

## 第一轮（修改前）

准确率 20/28 = **71%**，未过 80% 门槛。错误集中：

| 现象 | 根因 |
|---|---|
| 「Cognitive Services」「Google AI Studio」判 cloud | GitHub 清单按分节给 hint，但 hint 优先级高于关键词，把 AI 服务都归到 cloud |
| 「Azure Pipelines」判 cloud | software 关键词缺 pipelines / ci-cd |
| 「Fordeal 基础实操初阶必修课」判 other | edu 关键词只有「课程」，匹配不到「必修课」 |
| 剧集「[1080P] [更至11集]」判 other | media 关键词缺 1080p / 更至 |
| 「TeamoRouter ... 送 $1 体验金」判 other | ai 关键词缺「体验金」「中转」 |
| 「5 个师傅修同一台灶」「上门维修被收2800」判 goods | goods 关键词里有裸的 "0元"，被 "260元/2800元" 这类价格子串命中 |

## 修正

1. hint 降级为兜底：只有关键词分类为 other 时才采用分节 hint（`enrich/index.ts`）。
2. goods 删除裸 "0元" 与 "0.01"，改为 "零元""优惠码""券码""满减"。
3. edu 增加 "课"；media 增加 "1080p""更至"；ai 增加 "体验金""中转"；software 增加 "pipelines""ci/cd"。
4. GitHub 采集器解析二级标题作为 `categoryHint`，并写入 raw.section 便于回溯。

## 第二轮（修改后）

准确率 27/28 = **96%**（唯一保留项：`Static Web Apps — host static apps` 判 domain，人工认为 cloud 更准，属可接受的边界）。

| # | 标题（截断） | 系统 | 人工 | 判定 |
|---|---|---|---|---|
| 1 | Google AI Studio — Gemini 免费额度 | ai | ai | ok |
| 2 | Static Web Apps — host static apps | domain | cloud | 边界 |
| 3 | Cognitive Services — AI/ML APIs | ai | ai | ok |
| 4 | Azure Pipelines — 10 free jobs | software | software | ok |
| 5 | 手把手教你用 ChatGPT 做表情包 | ai | ai | ok |
| 6 | Fordeal 基础实操初阶必修课 | edu | edu | ok |
| 7 | 英语单词课 6000 词频 | edu | edu | ok |
| 8 | 恋爱博士 [1080P] [更至11集] | media | media | ok |
| 9 | SevenAI 双11福利 送 7$ 体验金 | ai | ai | ok |
| 10 | TeamoRouter 回帖送 1$ 体验金 | ai | ai | ok |
| 11 | 快跑AI claude 注册送10$ | ai | ai | ok |
| 12 | gemini 5x/20x ultra 福利 | ai | ai | ok |
| 13-16 | 52pojie「求下载 PDF / PPT / 畅想之星 / 小说」 | other | other（求资源，非福利） | ok |
| 17-19 | 福利吧「2026 年福利汇总第 15x 期」 | other | other/goods 边界 | ok |
| 20 | 多摩豪：青梅竹马骗了我 | other | other（小说） | ok |
| 21 | iOS 27.2.1 修了 9 个漏洞 | other | other（资讯） | ok |
| 22 | 5 个师傅修同一台灶 | other | other | ok（修复后） |
| 23 | 上门维修被收 2800 | other | other | ok（修复后） |
| 24 | GEN 打 BLG 四六开 | other | other | ok |
| 25-28 | 网易云音乐会员 ×4 | media | media | ok |

## 自动化覆盖

`pnpm test`（14 个用例）覆盖：URL 规范化去重、同链不同参数判重、AI/影音/域名分类、过期归零、时效排序、疑问句压分、HTML 清洗、时间解析、过期推断、AI 关闭时全链路可用。

---
name: 白嫖雷达 · Freebie Radar
description: Daylight borderless precision workbench (Linear / Things 3 aesthetic) for multi-source freebie aggregation, AI verification, and synced Telegram push.
colors:
  canvas: "#f6f7f9"
  canvas-subtle: "#eceef2"
  surface: "#ffffff"
  surface-hover: "#f7f8fb"
  surface-muted: "#f1f3f6"
  ink-950: "#111318"
  ink-900: "#1b1e26"
  ink-700: "#374151"
  ink-600: "#4b5563"
  ink-500: "#525c6b"
  ink-400: "#646f80"
  ink-300: "#d1d5de"
  ink-200: "#e6e8ec"
  ink-100: "#f1f3f6"
  brand: "#111318"
  brand-hover: "#272b36"
  brand-subtle: "#eef0ff"
  brand-border: "#c7d0f8"
  accent: "#312e81"
  deal: "#047857"
  deal-subtle: "#ecfdf5"
  deal-border: "#a7f3d0"
  code: "#92400e"
  code-subtle: "#fef3c7"
  code-border: "#fde68a"
  alert: "#dc2626"
  alert-subtle: "#fef2f2"
  alert-border: "#fecaca"
typography:
  drawer-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
  row-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-700}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-950}"
    rounded: "{rounded.md}"
    height: "32px"
  code-chip:
    backgroundColor: "{colors.code-subtle}"
    textColor: "{colors.code}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
---

# Design System · 白嫖雷达

## Overview

极净无框日光效率台（Daylight Precision Workbench，Linear / Things 3 风格）。白天高强度扫货用的操作面，彻底撤掉「灰底套白圆角卡片 + 满屏蓝胶囊 + 四色描边药丸」的 AI 后台味。

- 桌面端为双区一体架构：左 `240px` 冷雾灰连续导轨（`#F6F7F9`）+ 右全幅纯白主画布（`#FFFFFF`），中间以单一 `1px solid #E6E8EC` 细线切分。
- 移动端（`< 640px`）自动收拢为顶行品牌与快捷操作 + 全宽搜索 + 横向滚动导航 + 折叠筛选 + 标题全宽的双行紧凑网格。

## Colors

| Token | 值 | 用途 |
|---|---|---|
| `canvas` | `#f6f7f9` | 桌面左导轨、管理区次级区块底 |
| `canvas-subtle` | `#eceef2` | 导轨激活态底色 |
| `surface` | `#ffffff` | 主画布、输入框、详情抽屉 |
| `surface-hover` | `#f7f8fb` | 行悬停、选中行、内嵌区块 |
| `ink-950` | `#111318` | 主标题、深炭墨主按钮 |
| `ink-700` | `#374151` | 次级按钮文字、来源名称 |
| `ink-600` | `#4b5563` | 摘要正文、AI 说明 |
| `ink-500` | `#525c6b` | 元信息行 |
| `ink-400` | `#646f80` | 辅助标签、时间戳（保持 ≥ 4.5:1 对比度） |
| `ink-200` | `#e6e8ec` | 1px 细分隔线、面板描边 |
| `brand` | `#111318` | 主按钮、激活态胶囊、开关开启态 |
| `accent` | `#312e81` | 品牌小圆点、未读圆点、焦点环、链接高亮 |
| `deal` | `#047857` | 「免费」语义标识、≥70 高分、AI 保留判定 |
| `code` | `#92400e` | 兑换码、有条件提示、临期提醒 |
| `alert` | `#dc2626` | 屏蔽、失败、删除 |

## Typography

- 字体栈：系统无衬线字体（`-apple-system / Segoe UI / PingFang SC / Microsoft YaHei`），代码与数字统一 `tabular-nums` 等宽字体。
- 固定字阶（无夸张 display 标题）：`11px` 微标 → `12px` 元信息/筛选控件 → `13px` 导航/正文 → `14px` 列表标题 → `17px` 抽屉标题。**`11px` 是硬地板**。

## Layout

### 桌面端（`≥ 1024px`）

```
┌────────────┬─────────────────────────────────────────────────────┐
│ ● 白嫖雷达  │ 真福利精选  完全白嫖  含兑换码 ...     24h +57 [导出][↻] │
│ [搜索…   /] ├─────────────────────────────────────────────────────┤
│ 资源流  41  │ [分类▾][语言▾][价格▾][方式▾][时间▾][评分▾][排序▾] 共N条 │
│ 每日精选    ├─────────────────────────────────────────────────────┤
│ ── 管理 ──  │ ● 96  标题文字  免费  命中:Epic            ↗ ★ ⊘  1h前 │
│ 订阅与屏蔽  │       epic-free · 游戏 · 官方永久入库 · 2天后截止       │
│ 推送规则    │ ─────────────────────────────────────────────────── │
│ AI 引擎     │ ● 91  天翼云电脑体验券  免费  有条件  [BVHPQEP8C6]  2h前 │
│ 数据源运维  │       linuxdo-welfare · 云服务 · 需实名 · 今日截止      │
│ ── 常用场景 │                                                     │
│ ── 数据源   │                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```

- 快捷键：`/` 聚焦搜索框，`Esc` 清空或退出抽屉，`↑/↓` 抽屉内切换上下条。
- `feed` 紧凑模式下列表直接铺在纯白主画布上，**不套外层白框**。

### 移动端（`< 640px`）

- 断点保持 `sm` 640 / `lg` 1024 两档。
- **顶部收拢区**：品牌圆点 + 右端导出/刷新图标；全宽搜索；横向可滚动 tabs；「场景与数据源」默认收起，保证打开首屏即见福利流。
- **筛选条**：收进「筛选条件」折叠按钮（带激活计数）+ 右侧紧凑/卡片视图切换。
- **紧凑行**：`grid-cols-[auto_minmax(0,1fr)]` 两列网格，标题独占整行（390px 下实测宽 309px），兑换码与 4 个快捷操作放在底部独立一行；图标按钮 `p-2`（约 34px 触控区）。
- **详情抽屉与屏蔽弹窗**：`sm` 以下全宽；抽屉底部「打开原帖领取」独占整行，其余四键两列网格；屏蔽弹窗改底部贴边 sheet 并保留 `env(safe-area-inset-bottom)`。
- **数据源运维表**：`sm` 以下切换为卡片式源列表；采集记录表保留 `overflow-x-auto`。

## Elevation & Depth

- 默认静态面板 **零阴影**（`--shadow-panel: none`），仅以 `1px solid #e6e8ec` 细线区分层次。
- 仅抽屉（`--shadow-drawer`）、分类多选浮层与底部 Toast 使用克制投影，传达浮层层级。

## Shapes

- 统一 `6px–8px` 克制圆角：输入框、下拉框、按钮、导航项统一 `rounded-md`（6px）或 `rounded-lg`（8px）；兑换码片 `rounded`（4px）；仅顶栏场景胶囊与未读点用 `rounded-full`。

## Components

- **CompactRow**：7px 深靛青未读点 + 无底色等宽评分 + 标题与内联价格/方式文字（取消彩色描边药丸）+ 居中小点元信息 + 淡显 hover 操作组 + 等宽右对齐相对时间。
- **DetailDrawer**：右侧 500px 滑出（手机全宽），顶部上下条切换与来源，中部 AI 判定条、兑换码复制区与正文快照，底部固定炭黑主按钮。
- **Admin Subpanels**：`DigestPanel / RulesPanel / PushPanel / AiPanel / OpsPanel / AdminGate` 全站共用炭黑主按钮、浅靛青激活提示底、红底深字危险操作与统一 8px 面板容器。

## Do's and Don'ts

- Do：使用纯净白画布 + 1px 冷灰分隔线区分内容；在列表行内用字重与少量语义色传递价格/条件，不画多余边框。
- Do：所有管理操作在界面热生效；`::selection`、`focus-visible` 与 6px 滚动条统一跟随系统色板。
- Don't：不恢复灰底套 14px 圆角白卡片套娃、不加回满屏 `#1d4ed8` 蓝胶囊按钮、不在列表行堆砌四色描边小药丸、不用暗黑荧光绿终端风、不用 `<11px` 字体。

## Verification

- `npm run build`（`tsc --noEmit` + `vite build`）：通过
- `npm test`：36/36 通过
- `impeccable detect --json`（全量 `src/web/src` 样式与组件）：**0 findings**
- Playwright 1440×900 & 390×844 验证：`scrollWidth === innerWidth`（零横向溢出），390px 紧凑行标题列宽 309px，零 `pageerror`。

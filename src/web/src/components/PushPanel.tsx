import { useEffect, useState } from "react";
import {
  BellRing,
  Bot,
  Check,
  Clock,
  Eye,
  Filter,
  Languages,
  ListOrdered,
  Loader2,
  Moon,
  RotateCcw,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import { CATEGORY_LABEL, OBTAIN_LABEL } from "../lib/sources.ts";
import { KIND_LABEL, KIND_ORDER } from "../lib/sources.ts";
import type {
  AiFallbackMode,
  PushLogItem,
  PushPayload,
  PushPreview,
  PushSettings,
  PushSourceMode,
  Source,
} from "../types.ts";

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink-200 bg-surface-hover px-3.5 py-2.5 text-left transition-colors hover:border-ink-300"
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink-900">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-ink-500">{hint}</div>}
      </div>
      <span
        className={
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " +
          (value ? "bg-brand" : "bg-ink-300")
        }
      >
        <span
          className={
            "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform " +
            (value ? "translate-x-4.5" : "translate-x-0.5")
          }
        />
      </span>
    </button>
  );
}

/** 支持拖动滑杆（松手提交）与直接输入精确数值（失焦/回车提交）。 */
function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onCommit,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const clampAndCommit = (raw: number) => {
    const clamped = Math.min(Math.max(Number.isFinite(raw) ? Math.round(raw) : value, min), max);
    setDraft(clamped);
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div className="rounded-lg border border-ink-200 bg-surface-hover px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-900">{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(e) => setDraft(Number(e.target.value))}
            onBlur={(e) => clampAndCommit(Number(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") clampAndCommit(Number((e.target as HTMLInputElement).value));
            }}
            className="w-16 rounded-md border border-ink-200 bg-surface px-1.5 py-0.5 text-right font-mono text-[12.5px] font-semibold tabular-nums text-brand outline-none focus:border-brand"
          />
          {suffix && <span className="text-[12px] text-ink-500">{suffix}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(Math.max(draft, min), max)}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => clampAndCommit(draft)}
        onKeyUp={() => clampAndCommit(draft)}
        className="mt-2 w-full accent-brand"
      />
      {hint && <div className="mt-1 text-[11px] leading-snug text-ink-500">{hint}</div>}
    </div>
  );
}

const PRICE_CAPS: { label: string; value: number | null }[] = [
  { label: "不限价格", value: null },
  { label: "只推白嫖", value: 0 },
  { label: "≤ 5 元", value: 5 },
  { label: "≤ 10 元", value: 10 },
  { label: "≤ 30 元", value: 30 },
  { label: "≤ 100 元", value: 100 },
];

const AGE_OPTIONS: { label: string; hours: number }[] = [
  { label: "24 小时内", hours: 24 },
  { label: "72 小时内（默认）", hours: 72 },
  { label: "7 天内", hours: 168 },
  { label: "30 天内", hours: 720 },
  { label: "不限时间", hours: 0 },
];

const REJECT_LABELS: { key: string; label: string }[] = [
  { key: "blocked", label: "屏蔽词" },
  { key: "duplicate", label: "跨源去重" },
  { key: "stale", label: "超新帖时效" },
  { key: "source", label: "数据源限制" },
  { key: "lang", label: "语言不符" },
  { key: "kind", label: "内容形态" },
  { key: "category", label: "分类不符" },
  { key: "price", label: "超价格上限" },
  { key: "ai", label: "AI 审核拦截" },
  { key: "obtain", label: "获取方式" },
  { key: "route", label: "未命中路由" },
  { key: "lowScore", label: "低于推送分" },
];

type PushSubTab = "filters" | "timing" | "logs";

export function PushPanel({
  payload,
  preview,
  logs,
  sources,
  onSave,
  onPreview,
  onFlush,
  onTest,
}: {
  payload: PushPayload | null;
  preview: PushPreview | null;
  logs: PushLogItem[];
  sources: Source[];
  onSave: (patch: Partial<PushSettings>) => Promise<void>;
  onPreview: () => Promise<void>;
  onFlush: () => Promise<void>;
  onTest: () => Promise<void>;
}) {
  const [subTab, setSubTab] = useState<PushSubTab>("filters");
  const [busy, setBusy] = useState<string | null>(null);
  const s = payload?.settings;
  const stats = payload?.stats;

  const [quietFrom, setQuietFrom] = useState("23:30");
  const [quietTo, setQuietTo] = useState("08:00");
  const [customHeaderDraft, setCustomHeaderDraft] = useState("");
  const [customPriceDraft, setCustomPriceDraft] = useState("");

  useEffect(() => {
    if (!s) return;
    if (s.quietHours) {
      const [a, b] = s.quietHours.split("-");
      if (a) setQuietFrom(a);
      if (b) setQuietTo(b);
    }
    setCustomHeaderDraft(s.customHeader ?? "");
    setCustomPriceDraft(s.maxPrice !== null && ![0, 5, 10, 30, 100].includes(s.maxPrice) ? String(s.maxPrice) : "");
  }, [s?.quietHours, s?.customHeader, s?.maxPrice]);

  const save = async (patch: Partial<PushSettings>) => {
    setBusy("save");
    try {
      await onSave(patch);
    } finally {
      setBusy(null);
    }
  };

  if (!s) return <div className="panel p-6 text-[13px] text-ink-500">正在加载推送规则…</div>;

  const toggleCategory = (cat: string) => {
    const exists = s.categories.includes(cat);
    const next = exists ? s.categories.filter((c) => c !== cat) : [...s.categories, cat];
    void save({ categories: next });
  };

  const toggleSourceId = (id: string) => {
    const exists = s.sourceIds.includes(id);
    const next = exists ? s.sourceIds.filter((x) => x !== id) : [...s.sourceIds, id];
    void save({ sourceIds: next });
  };

  const enabledSources = sources.filter((src) => src.enabled);

  return (
    <div className="space-y-4">
      {/* 总开关 + 实时状态条 */}
      <section className="panel flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <div className={`grid h-10 w-10 place-items-center rounded-lg ${s.enabled ? "bg-deal-subtle text-deal" : "bg-ink-100 text-ink-500"}`}>
              <BellRing size={18} />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-ink-950">Telegram 自动推送</div>
              <div className="text-[12px] text-ink-500">
                {s.enabled
                  ? payload?.quiet
                    ? `开启中 · 处于免打扰时段（${s.quietAction === "drop" ? "直接跳过" : "转攒批队列"}）`
                    : `实时监控中 · ${s.pushTiming === "wait_ai" ? "先过 AI 再推" : "极速抢码先推后审"}`
                  : "已暂停推送，仅本地收集入库"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5 border-l border-ink-200 pl-6 text-[12px]">
            <div>
              <span className="block font-mono text-[15px] font-semibold tabular-nums text-ink-950">
                {stats?.pushedLastHour ?? 0}/{s.maxPerHour}
              </span>
              <span className="text-ink-500">1小时已推</span>
            </div>
            <div>
              <span className="block font-mono text-[15px] font-semibold tabular-nums text-ink-950">
                {stats?.pushedLast24h ?? 0}
              </span>
              <span className="text-ink-500">24小时已推</span>
            </div>
            <div>
              <span className="block font-mono text-[15px] font-semibold tabular-nums text-brand">
                {stats?.queued ?? 0}
              </span>
              <span className="text-ink-500">攒批队列</span>
            </div>
            {(stats?.failures ?? 0) > 0 && (
              <div>
                <span className="block font-mono text-[15px] font-semibold tabular-nums text-alert">
                  {stats?.failures ?? 0}
                </span>
                <span className="text-ink-500">推送失败</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {payload?.defaults && (
            <button
              type="button"
              onClick={() => void save(payload.defaults)}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[12px] font-medium text-ink-600 hover:bg-ink-100"
              title="恢复全部推送规则为默认值"
            >
              <RotateCcw size={13} /> 恢复默认
            </button>
          )}
          <button
            type="button"
            onClick={() => save({ enabled: !s.enabled })}
            className={
              "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-medium transition-colors " +
              (s.enabled
                ? "border-deal-border bg-deal-subtle text-deal hover:bg-emerald-100"
                : "border-ink-200 bg-ink-100 text-ink-600 hover:bg-ink-200")
            }
          >
            <Settings2 size={14} /> {s.enabled ? "推送已开启（点击暂停）" : "推送已关闭（点击开启）"}
          </button>
        </div>
      </section>

      {!payload?.ready && (
        <div className="rounded-lg border border-code-border bg-code-subtle p-3.5 text-[12.5px] text-amber-900">
          服务端尚未配置 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID（或 PUSH_CHANNEL=none），这里的设置会提前保存，配好凭据后立即生效。
        </div>
      )}

      {/* 子页签导航 */}
      <div className="panel flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: "filters" as PushSubTab, label: "推送时机与筛选", icon: Filter },
            { key: "timing" as PushSubTab, label: "阈值、格式与免打扰", icon: Clock },
            { key: "logs" as PushSubTab, label: `试算预览与记录 (${logs.length})`, icon: Sparkles },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              className={
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors " +
                (subTab === t.key ? "bg-brand text-white" : "text-ink-600 hover:bg-ink-100")
              }
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-ink-500">
          {busy === "save" ? "保存中…" : "改动即时热生效（无需重启服务）"}
        </span>
      </div>

      {subTab === "filters" && (
        <div className="space-y-4">
          {/* 1. AI 协同与推送时机（统一归属到推送规则中） */}
          <section className="panel space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
                <Bot size={15} className="text-brand" /> 推送时机与 AI 协同策略
              </div>
              <span className="text-[11.5px] text-ink-500">
                模型连接、规则初筛与提示词请在「AI 引擎」页配置
              </span>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => save({ pushTiming: "wait_ai" })}
                className={
                  "rounded-lg border px-3.5 py-2.5 text-left transition-colors " +
                  (s.pushTiming === "wait_ai"
                    ? "border-brand bg-brand-subtle text-brand"
                    : "border-ink-200 bg-surface-hover text-ink-700 hover:bg-ink-100")
                }
              >
                <div className="text-[13px] font-semibold">推送前先过 AI（推荐）</div>
                <div className="mt-0.5 text-[11.5px] font-normal text-ink-500">
                  新条目先同步等待 AI 验真再发 Telegram，多等 1~3 秒，精准拦掉新闻/更新公告
                </div>
              </button>
              <button
                type="button"
                onClick={() => save({ pushTiming: "instant_first" })}
                className={
                  "rounded-lg border px-3.5 py-2.5 text-left transition-colors " +
                  (s.pushTiming === "instant_first"
                    ? "border-brand bg-brand-subtle text-brand"
                    : "border-ink-200 bg-surface-hover text-ink-700 hover:bg-ink-100")
                }
              >
                <div className="text-[13px] font-semibold">极速抢码先推后审</div>
                <div className="mt-0.5 text-[11.5px] font-normal text-ink-500">
                  高分/兑换码 0 延迟立刻发出，AI 随后在后台异步补齐结论与分类
                </div>
              </button>
            </div>

            {s.pushTiming === "wait_ai" && (
              <NumberField
                label="推送前同步等待审核条数上限"
                hint="单轮采集最多同步等多少条过 AI 后立刻判定推送；超出条数转入后台队列，审完后按下方开关决定是否补推"
                value={s.syncPrePushLimit}
                min={5}
                max={60}
                step={1}
                suffix=" 条/轮"
                onCommit={(v) => void save({ syncPrePushLimit: v })}
              />
            )}

            <div>
              <div className="mb-1.5 text-[12px] font-medium text-ink-700">AI 兜底与过滤模式（当某条尚无 AI 结论或被 AI 拒绝时）</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  {
                    key: "strict" as AiFallbackMode,
                    title: "严进模式（宁缺毋滥）",
                    desc: "启用 AI 时必须明确判为真福利才推；超时/未审到不推（AI 未启用时按规则放行）",
                  },
                  {
                    key: "rule_fallback" as AiFallbackMode,
                    title: "均衡兜底（推荐）",
                    desc: "AI 明确拒绝的拦掉；未出结果时，含兑换码或高分福利信号才放行",
                  },
                  {
                    key: "ignore_ai" as AiFallbackMode,
                    title: "仅用规则（忽略 AI）",
                    desc: "不以 AI 结论拦推送，只按屏蔽词、评分、价格与获取方式过滤",
                  },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => save({ aiFallbackMode: opt.key })}
                    className={
                      "rounded-lg border px-3 py-2 text-left transition-colors " +
                      (s.aiFallbackMode === opt.key
                        ? "border-brand bg-brand-subtle text-brand"
                        : "border-ink-200 bg-surface-hover text-ink-700 hover:bg-ink-100")
                    }
                  >
                    <div className="text-[12.5px] font-semibold">{opt.title}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-ink-500">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-3">
              <Toggle
                label="后台补审通过后自动补推"
                hint="超出同步上限或极速模式补审确认真福利时，自动补入推送管道（不会重复推已发条目）"
                value={s.pushAfterBackfill}
                onChange={(v) => save({ pushAfterBackfill: v })}
              />
              <Toggle
                label="订阅命中优先直推"
                hint="命中「我的订阅」关键词立刻单条直发"
                value={s.prioritizeSubscribed}
                onChange={(v) => save({ prioritizeSubscribed: v })}
              />
              <Toggle
                label="同步应用到每日精选"
                hint="每日早报也遵守价格、分类、源与 AI 条件"
                value={s.applyToDigest}
                onChange={(v) => save({ applyToDigest: v })}
              />
            </div>
          </section>

          {/* 2. 多维推送筛选条件 */}
          <section className="panel space-y-4 p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
              <SlidersHorizontal size={15} className="text-brand" /> 推送内容筛选条件
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {/* 最高价格上限 */}
              <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-ink-900">最高推送价格</span>
                  <span className="font-mono text-[12px] text-brand">
                    {s.maxPrice === null ? "不限" : s.maxPrice === 0 ? "完全白嫖" : `≤ ${s.maxPrice} 元`}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {PRICE_CAPS.map((p) => {
                    const active = s.maxPrice === p.value;
                    return (
                      <button
                        key={String(p.value)}
                        type="button"
                        onClick={() => save({ maxPrice: p.value })}
                        className={
                          "rounded-lg border px-2 py-1.5 text-[11.5px] font-medium transition-colors " +
                          (active
                            ? "border-brand bg-brand text-white"
                            : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                        }
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                    value={customPriceDraft}
                    onChange={(e) => setCustomPriceDraft(e.target.value)}
                    placeholder="自定义金额(元)"
                    className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-surface px-2 py-1 font-mono text-[11.5px] text-ink-900 outline-none focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const n = Number(customPriceDraft);
                      if (customPriceDraft.trim() !== "" && Number.isFinite(n) && n >= 0) {
                        void save({ maxPrice: n });
                      }
                    }}
                    className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-700 hover:bg-ink-100"
                  >
                    应用
                  </button>
                </div>
              </div>

              {/* 语言过滤 */}
              <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
                <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-ink-900">
                  <Languages size={14} className="text-ink-500" /> 语言过滤
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { key: "all" as const, label: "中英都推" },
                    { key: "zh" as const, label: "仅中文源" },
                    { key: "en" as const, label: "仅英文源" },
                  ].map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => save({ langMode: o.key })}
                      className={
                        "rounded-lg border px-2 py-1.5 text-[12px] font-medium transition-colors " +
                        (s.langMode === o.key
                          ? "border-brand bg-brand text-white"
                          : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-snug text-ink-500">
                  自动按标题中文占比识别；英文条目可附带 EN 标签并折算人民币价格。
                </p>
              </div>

              {/* 新帖时效上限 */}
              <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-ink-900">新帖时效闸门</span>
                  <span className="font-mono text-[12px] text-brand">
                    {s.maxAgeHours <= 0 ? "不限" : `${s.maxAgeHours}h`}
                  </span>
                </div>
                <select
                  value={AGE_OPTIONS.some((o) => o.hours === s.maxAgeHours) ? s.maxAgeHours : "custom"}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) void save({ maxAgeHours: v });
                  }}
                  className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-900 outline-none focus:border-brand"
                >
                  {AGE_OPTIONS.map((o) => (
                    <option key={o.hours} value={o.hours}>
                      {o.label}
                    </option>
                  ))}
                  {!AGE_OPTIONS.some((o) => o.hours === s.maxAgeHours) && (
                    <option value="custom">自定义：{s.maxAgeHours} 小时内</option>
                  )}
                </select>
                <p className="mt-2 text-[11px] leading-snug text-ink-500">
                  拦截发布时间过久的老帖重复当新羊毛推，避免老论坛顶帖刷屏。
                </p>
              </div>
            </div>

            {/* 内容形态白名单 */}
            <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink-900">只推哪些内容形态（不勾选表示全部有效形态）</span>
                {(s.kinds?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => save({ kinds: [] })}
                    className="text-[12px] font-medium text-brand hover:underline"
                  >
                    恢复全部形态
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {KIND_ORDER.map((key) => {
                  const checked = (s.kinds ?? []).includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        save({
                          kinds: checked ? (s.kinds ?? []).filter((x) => x !== key) : [...(s.kinds ?? []), key],
                        })
                      }
                      className={
                        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] transition-colors " +
                        (checked
                          ? "border-brand bg-brand-subtle font-medium text-brand"
                          : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                      }
                    >
                      {checked && <Check size={12} />}
                      {KIND_LABEL[key]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 分类白名单 */}
            <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink-900">只推哪些分类（不勾选表示全部分类都推）</span>
                {s.categories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => save({ categories: [] })}
                    className="text-[12px] font-medium text-brand hover:underline"
                  >
                    恢复全部分类
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(CATEGORY_LABEL).map(([key, label]) => {
                  const checked = s.categories.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleCategory(key)}
                      className={
                        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] transition-colors " +
                        (checked
                          ? "border-brand bg-brand-subtle font-medium text-brand"
                          : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                      }
                    >
                      {checked && <Check size={12} />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 获取方式白名单 */}
            <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink-900">只推这些获取方式（都不选表示不限制）</span>
                {s.obtainModes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => save({ obtainModes: [] })}
                    className="text-[12px] font-medium text-brand hover:underline"
                  >
                    不限获取方式
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["free", "conditional", "paid", "lottery", "trial", "promo"] as const).map((key) => {
                  const checked = s.obtainModes.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        save({
                          obtainModes: checked ? s.obtainModes.filter((x) => x !== key) : [...s.obtainModes, key],
                        })
                      }
                      className={
                        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] transition-colors " +
                        (checked
                          ? "border-brand bg-brand-subtle font-medium text-brand"
                          : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                      }
                    >
                      {checked && <Check size={12} />}
                      {OBTAIN_LABEL[key]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-ink-500">
                抽奖、试用、推广容易混入营销内容，默认只推「直接白嫖」。
              </p>
            </div>

            {/* 多频道推送路由 */}
            <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[13px] font-medium text-ink-900">多频道专题路由（可选）</span>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    启用任意路由后，将按路由条件分流匹配（可同时推「黑五 VPS」与「开源项目」，未启用路由时走全局筛选）
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      save({
                        routes: [
                          ...(s.routes ?? []),
                          {
                            id: `vps-${Date.now()}`,
                            name: "黑五/VPS 好价",
                            enabled: true,
                            kinds: ["deal", "freebie"],
                            categories: ["cloud", "domain"],
                            obtainModes: ["free", "conditional", "paid"],
                            keywords: ["黑五", "vps", "kvm", "年付"],
                            maxPrice: null,
                            minScore: 55,
                            instant: true,
                            header: "🖥 VPS 好价",
                          },
                        ],
                      })
                    }
                    className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-700 hover:bg-ink-100"
                  >
                    + 黑五/VPS 路由
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      save({
                        routes: [
                          ...(s.routes ?? []),
                          {
                            id: `os-${Date.now()}`,
                            name: "开源项目精选",
                            enabled: true,
                            kinds: ["opensource"],
                            categories: [],
                            obtainModes: [],
                            keywords: [],
                            maxPrice: null,
                            minScore: 60,
                            instant: false,
                            header: "📦 开源雷达",
                          },
                        ],
                      })
                    }
                    className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-700 hover:bg-ink-100"
                  >
                    + 开源项目路由
                  </button>
                </div>
              </div>
              {(s.routes?.length ?? 0) > 0 && (
                <div className="mt-2 space-y-2">
                  {(s.routes ?? []).map((rt, idx) => (
                    <div
                      key={rt.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[12px]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 font-medium text-ink-900">
                          <span>{rt.name}</span>
                          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10.5px] text-ink-600">
                            {rt.instant ? "可即时" : "仅攒批"}
                          </span>
                          <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-600">
                            ≥{rt.minScore}分
                          </span>
                          {rt.keywords.length > 0 && (
                            <span className="text-[11px] font-normal text-ink-500">
                              关键词：{rt.keywords.join("/")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            save({
                              routes: (s.routes ?? []).map((x, i) => (i === idx ? { ...x, enabled: !x.enabled } : x)),
                            })
                          }
                          className={
                            "rounded border px-2 py-0.5 text-[11px] font-medium " +
                            (rt.enabled
                              ? "border-deal-border bg-deal-subtle text-deal"
                              : "border-ink-200 bg-ink-100 text-ink-500")
                          }
                        >
                          {rt.enabled ? "已启用" : "已停用"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            save({
                              routes: (s.routes ?? []).filter((_, i) => i !== idx),
                            })
                          }
                          className="rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-500 hover:text-alert"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 数据源范围控制 */}
            <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink-900">数据源推送范围</span>
                <div className="flex items-center gap-1.5">
                  {[
                    { key: "all" as PushSourceMode, label: "全部启用源" },
                    { key: "include" as PushSourceMode, label: "仅推指定源" },
                    { key: "exclude" as PushSourceMode, label: "排除指定源" },
                  ].map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => save({ sourceMode: m.key })}
                      className={
                        "rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors " +
                        (s.sourceMode === m.key
                          ? "border-brand bg-brand text-white"
                          : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                      }
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {s.sourceMode !== "all" && (
                <div className="mt-2.5 space-y-2">
                  <div className="flex items-center justify-between text-[11.5px] text-ink-500">
                    <span>
                      {s.sourceMode === "include"
                        ? `仅推送已选的 ${s.sourceIds.length} 个数据源`
                        : `跳过已选的 ${s.sourceIds.length} 个数据源（仍在网页收录）`}
                    </span>
                    {s.sourceIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => save({ sourceIds: [] })}
                        className="font-medium text-brand hover:underline"
                      >
                        清空选择
                      </button>
                    )}
                  </div>
                  <div className="flex max-h-[160px] flex-wrap gap-1.5 overflow-auto rounded-lg border border-ink-200 bg-surface p-2">
                    {enabledSources.map((src) => {
                      const active = s.sourceIds.includes(src.id);
                      return (
                        <button
                          key={src.id}
                          type="button"
                          onClick={() => toggleSourceId(src.id)}
                          className={
                            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] transition-colors " +
                            (active
                              ? "border-brand bg-brand-subtle font-medium text-brand"
                              : "border-ink-200 bg-surface-hover text-ink-700 hover:bg-ink-100")
                          }
                        >
                          {active && <Check size={11} />}
                          {src.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {subTab === "timing" && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* 评分阈值与消息内容自定义 */}
          <section className="panel space-y-3 p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
              <Zap size={15} className="text-brand" /> 触发阈值与消息格式
            </div>
            <NumberField
              label="立即单发阈值 ≥"
              hint="达到此分数马上单条发出，不等攒批（松手或回车生效）"
              value={s.instantScore}
              min={0}
              max={100}
              step={5}
              suffix=" 分"
              onCommit={(v) => save({ instantScore: v })}
            />
            <NumberField
              label="攒批合发阈值 ≥"
              hint={`低于立即阈值的先入攒批队列定时合并发（自动 ≤ 立即阈值 ${s.instantScore} 分）`}
              value={s.batchScore}
              min={0}
              max={s.instantScore}
              step={5}
              suffix=" 分"
              onCommit={(v) => save({ batchScore: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Toggle
                label="含兑换码直推"
                value={s.instantOnCodes}
                onChange={(v) => save({ instantOnCodes: v })}
              />
              <Toggle
                label="限量/名额直推"
                value={s.instantOnUrgent}
                onChange={(v) => save({ instantOnUrgent: v })}
              />
            </div>

            <div className="pt-1">
              <div className="mb-1.5 text-[12px] font-medium text-ink-700">消息元素与去重开关</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Toggle label="带价格" value={s.includePrice} onChange={(v) => save({ includePrice: v })} />
                <Toggle label="带截止日" value={s.includeDeadline} onChange={(v) => save({ includeDeadline: v })} />
                <Toggle label="带评分" value={s.includeScore} onChange={(v) => save({ includeScore: v })} />
                <Toggle label="带获取方式" value={s.includeObtain} onChange={(v) => save({ includeObtain: v })} />
                <Toggle label="带 AI 理由" value={s.includeAiReason} onChange={(v) => save({ includeAiReason: v })} />
                <Toggle label="跨源去重" value={s.dedupeByTitle} onChange={(v) => save({ dedupeByTitle: v })} />
              </div>
            </div>

            <label className="block rounded-lg border border-ink-200 bg-surface-hover px-3.5 py-2.5">
              <span className="text-[12.5px] font-medium text-ink-900">自定义消息头前缀（失焦保存，留空用默认）</span>
              <input
                value={customHeaderDraft}
                onChange={(e) => setCustomHeaderDraft(e.target.value)}
                onBlur={() => {
                  if (customHeaderDraft.trim() !== s.customHeader) {
                    void save({ customHeader: customHeaderDraft.trim() });
                  }
                }}
                placeholder="例如：🛰 白嫖雷达 · 精选"
                maxLength={60}
                className="mt-1.5 w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-900 outline-none focus:border-brand"
              />
            </label>
          </section>

          {/* 频率限制与夜间免打扰 */}
          <section className="panel space-y-3 p-5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
              <Clock size={15} className="text-brand" /> 频率控制与夜间免打扰
            </div>
            <NumberField
              label="每小时推送上限"
              hint="含单发与攒批条数总和（1~200）"
              value={s.maxPerHour}
              min={1}
              max={200}
              suffix=" 条"
              onCommit={(v) => save({ maxPerHour: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="单轮最多即时发"
                value={s.maxPerInstant}
                min={1}
                max={10}
                suffix=" 条"
                onCommit={(v) => save({ maxPerInstant: v })}
              />
              <NumberField
                label="单批最多合并发"
                value={s.maxPerBatch}
                min={1}
                max={20}
                suffix=" 条"
                onCommit={(v) => save({ maxPerBatch: v })}
              />
            </div>

            <label className="block rounded-lg border border-ink-200 bg-surface-hover px-3.5 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-ink-900">攒批周期（修改后立即重建定时器）</span>
                <span className="font-mono text-[12px] text-brand">
                  {s.batchIntervalMin === 0 ? "已关闭" : `每 ${s.batchIntervalMin} 分钟`}
                </span>
              </div>
              <select
                value={s.batchIntervalMin}
                onChange={(e) => save({ batchIntervalMin: Number(e.target.value) })}
                className="mt-2 w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-900 outline-none focus:border-brand"
              >
                <option value={0}>关闭攒批</option>
                <option value={5}>每 5 分钟</option>
                <option value={10}>每 10 分钟</option>
                <option value={15}>每 15 分钟</option>
                <option value={30}>每 30 分钟</option>
                <option value={60}>每 1 小时</option>
                <option value={120}>每 2 小时</option>
              </select>
            </label>

            <div className="space-y-2.5 rounded-lg border border-ink-200 bg-surface-hover p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-900">
                  <Moon size={13} className="text-ink-500" /> 夜间免打扰时段
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-[11.5px] font-medium ${payload?.quiet ? "text-amber-700" : "text-ink-500"}`}>
                    {!s.quietEnabled ? "未启用" : payload?.quiet ? "免打扰中" : "正常推送时段"}
                  </span>
                  <button
                    type="button"
                    onClick={() => save({ quietEnabled: !s.quietEnabled })}
                    className={
                      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " +
                      (s.quietEnabled ? "bg-brand" : "bg-ink-300")
                    }
                    title={s.quietEnabled ? "点击关闭夜间免打扰" : "点击开启夜间免打扰"}
                  >
                    <span
                      className={
                        "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform " +
                        (s.quietEnabled ? "translate-x-4.5" : "translate-x-0.5")
                      }
                    />
                  </button>
                </div>
              </div>

              {s.quietEnabled && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      value={quietFrom}
                      onChange={(e) => setQuietFrom(e.target.value)}
                      onBlur={() => {
                        const next = `${quietFrom}-${quietTo}`;
                        if (next !== s.quietHours) void save({ quietHours: next });
                      }}
                      className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
                    />
                    <span className="text-ink-400">至</span>
                    <input
                      type="time"
                      value={quietTo}
                      onChange={(e) => setQuietTo(e.target.value)}
                      onBlur={() => {
                        const next = `${quietFrom}-${quietTo}`;
                        if (next !== s.quietHours) void save({ quietHours: next });
                      }}
                      className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
                    />
                    <select
                      value={s.timezone}
                      onChange={(e) => save({ timezone: e.target.value })}
                      className="ml-auto rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12px] text-ink-800 outline-none focus:border-brand"
                    >
                      <option value="Asia/Shanghai">北京时间 (UTC+8)</option>
                      <option value="Asia/Tokyo">东京时间 (UTC+9)</option>
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">美东时间</option>
                      <option value="Europe/London">伦敦时间</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: "batch" as const, label: "转入攒批早上发" },
                      { key: "drop" as const, label: "静默期直接跳过" },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => save({ quietAction: opt.key })}
                        className={
                          "rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors " +
                          (s.quietAction === opt.key
                            ? "border-brand bg-brand-subtle text-brand"
                            : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {subTab === "logs" && (
        <div className="space-y-4">
          {/* 预览与测试 */}
          <section className="panel space-y-3.5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
                  <Sparkles size={15} className="text-brand" /> 实时效果预览（不会真正发出）
                </div>
                <p className="mt-0.5 text-[12px] text-ink-500">
                  用数据库里未推送的最新 180 条按上述全部筛选条件试算，立刻检查命中和被拦截原因分布。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setBusy("preview");
                    try {
                      await onPreview();
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-brand-hover"
                >
                  {busy === "preview" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} 试算推送预览
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setBusy("flush");
                    try {
                      await onFlush();
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100"
                >
                  {busy === "flush" ? <Loader2 size={13} className="animate-spin" /> : <ListOrdered size={13} />} 立即发攒批
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setBusy("test");
                    try {
                      await onTest();
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100"
                >
                  {busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} 发测试消息
                </button>
              </div>
            </div>

            {preview && (
              <div className="space-y-3 pt-1">
                {preview.rejectedBy && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-ink-200 bg-surface-hover px-3 py-2 text-[11.5px]">
                    <span className="font-medium text-ink-700">
                      扫描 {preview.scanned} 条 · 通过筛选 {preview.matched} 条 · 拦截分布：
                    </span>
                    {REJECT_LABELS.filter((r) => (preview.rejectedBy?.[r.key] ?? 0) > 0).map((r) => (
                      <span key={r.key} className="rounded bg-ink-100 px-2 py-0.5 text-ink-600">
                        {r.label} <span className="font-mono font-medium">{preview.rejectedBy?.[r.key]}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-ink-200 bg-surface-hover p-3">
                    <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-deal">
                      <span>⚡ 立即推送（命中 {preview.instant.length}）</span>
                      <span className="font-mono text-[11px] text-ink-500">
                        符合条件 {preview.matched}/{preview.scanned}
                      </span>
                    </div>
                    <pre className="max-h-[220px] overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-700">
                      {preview.instant.length ? preview.instant.join("\n\n") : "（当前条件下没有触发立即推送的条目）"}
                    </pre>
                  </div>
                  <div className="rounded-lg border border-ink-200 bg-surface-hover p-3">
                    <div className="mb-1.5 text-[12px] font-medium text-brand">
                      📦 攒批队列（本批 {preview.batch.length}，内存中已排队 {preview.queued}）
                    </div>
                    <pre className="max-h-[220px] overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-700">
                      {preview.batch.length ? preview.batch.join("\n\n") : "（当前条件下没有达到攒批阈值的条目）"}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 历史推送记录 */}
          <section className="panel overflow-hidden">
            <div className="border-b border-ink-100 px-5 py-3.5 text-[13.5px] font-semibold text-ink-950">
              最近推送记录（{logs.length}）
            </div>
            <div className="max-h-[420px] divide-y divide-ink-100 overflow-auto">
              {logs.length === 0 && (
                <div className="px-5 py-10 text-center text-[12.5px] text-ink-500">还没有历史推送记录</div>
              )}
              {logs.map((l) => (
                <div key={l.id} className="px-5 py-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px]">
                    <span
                      className={
                        "rounded-md px-2 py-0.5 font-medium " +
                        (l.kind === "instant"
                          ? "bg-code-subtle text-amber-800"
                          : l.kind === "batch"
                            ? "bg-brand-subtle text-brand"
                            : "bg-ink-100 text-ink-700")
                      }
                    >
                      {l.kind === "instant" ? "即时推送" : l.kind === "batch" ? "攒批推送" : l.kind}
                    </span>
                    <span className="font-mono text-ink-500">{l.created_at.replace("T", " ").slice(5, 19)}</span>
                    <span className="text-ink-600">{l.count} 条</span>
                    {l.ok === 0 && <span className="rounded bg-alert-subtle px-1.5 py-0.5 text-alert">发送失败</span>}
                  </div>
                  <pre className="max-h-[72px] overflow-hidden font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-600">
                    {(l.text ?? "").slice(0, 240)}
                    {(l.text ?? "").length > 240 ? "…" : ""}
                  </pre>
                  {l.error && <div className="mt-1 font-mono text-[11px] text-alert">{l.error}</div>}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

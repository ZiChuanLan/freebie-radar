import { useState } from "react";
import {
  BellRing,
  Check,
  Clock,
  Eye,
  Filter,
  Languages,
  ListOrdered,
  Loader2,
  Moon,
  Send,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";
import { CATEGORY_LABEL } from "../lib/sources.ts";
import type { PushLogItem, PushPayload, PushSettings } from "../types.ts";

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
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-200 bg-surface-hover px-3.5 py-2.5 text-left transition-colors hover:border-ink-300"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink-900">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">{hint}</span>}
      </span>
      <span className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${value ? "bg-brand" : "bg-ink-300"}`}>
        <span className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${value ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block rounded-xl border border-ink-200 bg-surface-hover px-3.5 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-900">{label}</span>
        <span className="font-mono text-[13px] font-semibold tabular-nums text-brand">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-brand"
      />
      {hint && <div className="mt-1 text-[11px] leading-snug text-ink-500">{hint}</div>}
    </label>
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

export function PushPanel({
  payload,
  preview,
  logs,
  onSave,
  onPreview,
  onFlush,
  onTest,
}: {
  payload: PushPayload | null;
  preview: { instant: string[]; batch: string[]; queued: number; scanned?: number; matched?: number } | null;
  logs: PushLogItem[];
  onSave: (patch: Partial<PushSettings>) => Promise<void>;
  onPreview: () => Promise<void>;
  onFlush: () => Promise<void>;
  onTest: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const s = payload?.settings;
  const stats = payload?.stats;

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

  return (
    <div className="space-y-5">
      {/* 总开关 + 实时状态条 */}
      <section className="panel flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <div className={`grid h-10 w-10 place-items-center rounded-xl ${s.enabled ? "bg-deal-subtle text-deal" : "bg-ink-100 text-ink-500"}`}>
              <BellRing size={18} />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-ink-950">Telegram 自动推送</div>
              <div className="text-[12px] text-ink-500">
                {s.enabled ? (payload?.quiet ? "开启中 · 当前处于夜间静默时段（转攒批）" : "实时监控推送中") : "已暂停推送，仅本地收集入库"}
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

        <button
          type="button"
          onClick={() => save({ enabled: !s.enabled })}
          className={
            "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-[13px] font-medium transition-colors " +
            (s.enabled
              ? "border-deal-border bg-deal-subtle text-deal hover:bg-emerald-100"
              : "border-ink-200 bg-ink-100 text-ink-600 hover:bg-ink-200")
          }
        >
          <Settings2 size={14} /> {s.enabled ? "推送已开启（点击暂停）" : "推送已关闭（点击开启）"}
        </button>
      </section>

      {!payload?.ready && (
        <div className="rounded-xl border border-code-border bg-code-subtle p-3.5 text-[12.5px] text-amber-900">
          服务端尚未配置 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID（或 PUSH_CHANNEL=none），这里的设置会提前保存，配好凭据后立即生效。
        </div>
      )}

      {/* 核心联动筛选区：价格上限、分类、AI 验真、订阅优先、应用到日报 */}
      <section className="panel space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-950">
            <Filter size={16} className="text-brand" /> 推送筛选条件（与资源流一致）
          </div>
          <span className="text-[12px] text-ink-500">改动即时生效，不需要重启服务</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* 最高价格上限 */}
          <div className="rounded-xl border border-ink-200 bg-surface-hover p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium text-ink-900">我能付多少（最高推送价格）</span>
              <span className="font-mono text-[12px] text-brand">
                {s.maxPrice === null ? "不限" : s.maxPrice === 0 ? "完全白嫖" : `≤ ${s.maxPrice} 元`}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {PRICE_CAPS.map((p) => {
                const active = s.maxPrice === p.value;
                return (
                  <button
                    key={String(p.value)}
                    type="button"
                    onClick={() => save({ maxPrice: p.value })}
                    className={
                      "rounded-lg border px-2 py-1.5 text-[12px] font-medium transition-colors " +
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
            <p className="mt-2 text-[11px] text-ink-500">
              选「只推白嫖」时仅推送明确免费或 0 元资源；选金额上限时过滤超价折扣。
            </p>
          </div>

          {/* 语言筛选 */}
          <div className="rounded-xl border border-ink-200 bg-surface-hover p-3.5">
            <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-ink-900">
              <Languages size={14} className="text-ink-500" /> 语言过滤
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "all" as const, label: "中英文都推" },
                { key: "zh" as const, label: "只看中文源" },
                { key: "en" as const, label: "只看英文源" },
              ].map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => save({ langMode: o.key })}
                  className={
                    "rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors " +
                    (s.langMode === o.key
                      ? "border-brand bg-brand text-white"
                      : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-500">
              自动按标题中文占比判断；英文条目会标示 EN，价格折算成人民币显示。
            </p>
          </div>
        </div>

        {/* 允许推送的分类多选 */}
        <div className="rounded-xl border border-ink-200 bg-surface-hover p-3.5">
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

        <div className="grid gap-2.5 sm:grid-cols-3">
          <Toggle
            label="只推 AI 验真福利"
            hint="拦掉新闻、求问、评测等非福利帖"
            value={s.onlyAiKeep}
            onChange={(v) => save({ onlyAiKeep: v })}
          />
          <Toggle
            label="订阅命中优先直推"
            hint="命中「我的订阅」词条立刻单发"
            value={s.prioritizeSubscribed}
            onChange={(v) => save({ prioritizeSubscribed: v })}
          />
          <Toggle
            label="同步应用到每日精选"
            hint="早报也遵守价格、分类与 AI 条件"
            value={s.applyToDigest}
            onChange={(v) => save({ applyToDigest: v })}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 评分阈值与内容细节 */}
        <section className="panel space-y-3 p-5">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
            <Zap size={15} className="text-brand" /> 触发阈值与消息格式
          </div>
          <NumberField
            label="立即单发阈值 ≥"
            hint="达到此分数马上单条发出，不等攒批"
            value={s.instantScore}
            min={0}
            max={100}
            step={5}
            suffix=" 分"
            onChange={(v) => save({ instantScore: v })}
          />
          <NumberField
            label="攒批合发阈值 ≥"
            hint="够这条线先入攒批队列定时合并发，低于它的只入库不吵"
            value={s.batchScore}
            min={0}
            max={100}
            step={5}
            suffix=" 分"
            onChange={(v) => save({ batchScore: v })}
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
          <div className="grid grid-cols-3 gap-2">
            <Toggle label="带价格" value={s.includePrice} onChange={(v) => save({ includePrice: v })} />
            <Toggle label="带截止日" value={s.includeDeadline} onChange={(v) => save({ includeDeadline: v })} />
            <Toggle label="跨源去重" value={s.dedupeByTitle} onChange={(v) => save({ dedupeByTitle: v })} />
          </div>
        </section>

        {/* 频率限制与夜间免打扰 */}
        <section className="panel space-y-3 p-5">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
            <Clock size={15} className="text-brand" /> 频率控制与夜间免打扰
          </div>
          <NumberField
            label="每小时推送上限"
            value={s.maxPerHour}
            min={1}
            max={60}
            suffix=" 条"
            onChange={(v) => save({ maxPerHour: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="单轮最多发"
              value={s.maxPerInstant}
              min={1}
              max={10}
              suffix=" 条"
              onChange={(v) => save({ maxPerInstant: v })}
            />
            <label className="block rounded-xl border border-ink-200 bg-surface-hover px-3.5 py-2.5">
              <div className="text-[13px] font-medium text-ink-900">攒批周期</div>
              <select
                value={s.batchIntervalMin}
                onChange={(e) => save({ batchIntervalMin: Number(e.target.value) })}
                className="mt-2 w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-900 outline-none focus:border-brand"
              >
                <option value={0}>关闭攒批</option>
                <option value={10}>每 10 分钟</option>
                <option value={15}>每 15 分钟</option>
                <option value={30}>每 30 分钟</option>
                <option value={60}>每 1 小时</option>
                <option value={120}>每 2 小时</option>
              </select>
            </label>
          </div>

          <div className="rounded-xl border border-ink-200 bg-surface-hover p-3.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-900">
                <Moon size={13} className="text-ink-500" /> 夜间免打扰时段
              </span>
              <span className={`text-[12px] font-medium ${payload?.quiet ? "text-amber-700" : "text-ink-500"}`}>
                {payload?.quiet ? "目前免打扰中" : "目前可正常推送"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="time"
                value={s.quietHours.split("-")[0] ?? "23:30"}
                onChange={(e) => save({ quietHours: `${e.target.value}-${s.quietHours.split("-")[1] ?? "08:00"}` })}
                className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
              />
              <span className="text-ink-400">至</span>
              <input
                type="time"
                value={s.quietHours.split("-")[1] ?? "08:00"}
                onChange={(e) => save({ quietHours: `${s.quietHours.split("-")[0] ?? "23:30"}-${e.target.value}` })}
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
            <div className="mt-1.5 text-[11px] text-ink-500">免打扰期间内，即时推送暂存攒批队列，早上统一发出</div>
          </div>
        </section>
      </div>

      {/* 预览与测试 */}
      <section className="panel space-y-3.5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
              <Sparkles size={15} className="text-brand" /> 实时效果预览（不会真正发出）
            </div>
            <p className="mt-0.5 text-[12px] text-ink-500">
              用数据库里未推送的最新 180 条按上述全部筛选条件试算，立刻检查有没有漏网新闻或超价打折。
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
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-brand-hover"
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
              className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100"
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
              className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100"
            >
              {busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} 发测试消息
            </button>
          </div>
        </div>

        {preview && (
          <div className="grid gap-3 pt-1 lg:grid-cols-2">
            <div className="rounded-xl border border-ink-200 bg-surface-hover p-3">
              <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-deal">
                <span>⚡ 立即推送（命中 {preview.instant.length}）</span>
                {typeof preview.matched === "number" && (
                  <span className="font-mono text-[11px] text-ink-500">
                    符合条件 {preview.matched}/{preview.scanned}
                  </span>
                )}
              </div>
              <pre className="max-h-[200px] overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-700">
                {preview.instant.length ? preview.instant.join("\n\n") : "（当前条件下没有触发立即推送的条目）"}
              </pre>
            </div>
            <div className="rounded-xl border border-ink-200 bg-surface-hover p-3">
              <div className="mb-1.5 text-[12px] font-medium text-brand">
                📦 攒批队列（本批 {preview.batch.length}，内存中已排队 {preview.queued}）
              </div>
              <pre className="max-h-[200px] overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-700">
                {preview.batch.length ? preview.batch.join("\n\n") : "（当前条件下没有达到攒批阈值的条目）"}
              </pre>
            </div>
          </div>
        )}
      </section>

      {/* 历史推送记录 */}
      <section className="panel overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-3.5 text-[13.5px] font-semibold text-ink-950">
          最近推送记录（{logs.length}）
        </div>
        <div className="max-h-[380px] divide-y divide-ink-100 overflow-auto">
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
  );
}

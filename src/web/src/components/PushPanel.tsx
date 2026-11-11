import { useState } from "react";
import { BellRing, Clock, Eye, Languages, ListOrdered, Loader2, Moon, Send, Settings2, Zap } from "lucide-react";
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
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-900/50 px-3 py-2 text-left transition-colors hover:border-ink-700"
    >
      <span className="min-w-0">
        <span className="block text-[12.5px] text-ink-200">{label}</span>
        {hint && <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-500">{hint}</span>}
      </span>
      <span className={`h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors ${value ? "bg-lime/70" : "bg-ink-700"}`}>
        <span className={`block h-3 w-3 rounded-full bg-ink-950 transition-transform ${value ? "translate-x-3" : ""}`} />
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
    <label className="block rounded-xl border border-ink-800 bg-ink-900/50 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-ink-200">{label}</span>
        <span className="font-mono text-[12.5px] text-lime">
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
        className="mt-2 w-full accent-lime"
      />
      {hint && <div className="mt-1 text-[10.5px] leading-snug text-ink-500">{hint}</div>}
    </label>
  );
}

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
  preview: { instant: string[]; batch: string[]; queued: number } | null;
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

  if (!s) return <div className="card p-6 text-[13px] text-ink-400">加载推送设置…</div>;

  return (
    <div className="space-y-5">
      {/* 顶部状态 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "1 小时已推", value: stats?.pushedLastHour ?? 0, hint: `上限 ${s.maxPerHour}` },
          { label: "24 小时已推", value: stats?.pushedLast24h ?? 0 },
          { label: "攒批队列", value: stats?.queued ?? 0, hint: `每 ${s.batchIntervalMin} 分钟发一批` },
          { label: "24h 失败", value: stats?.failures ?? 0, warn: (stats?.failures ?? 0) > 0 },
        ].map((c) => (
          <div key={c.label} className="card p-4">
            <div className={`text-xl font-semibold tabular-nums ${c.warn ? "text-red-400" : "text-ink-100"}`}>
              {c.value}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-400">{c.label}</div>
            {c.hint && <div className="mt-1 text-[10.5px] text-ink-500">{c.hint}</div>}
          </div>
        ))}
      </div>

      {!payload?.ready && (
        <div className="card border-amber-500/30 bg-amber-500/5 p-4 text-[12.5px] text-amber-300">
          服务端未启用推送（缺 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 或 PUSH_CHANNEL=none），下面的设置仍然会保存，配好凭据后立即生效。
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 阈值 */}
        <section className="card space-y-3 p-4">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold">
            <Zap size={15} className="text-lime" /> 评分阈值
          </div>
          <NumberField
            label="立即推送 ≥"
            hint="达到这个分数的条目马上发，不等攒批"
            value={s.instantScore}
            min={0}
            max={100}
            step={5}
            suffix=" 分"
            onChange={(v) => save({ instantScore: v })}
          />
          <NumberField
            label="进攒批 ≥"
            hint="分数不够立即推、但够这条线的，攒起来一起发；低于它的直接丢掉不打扰"
            value={s.batchScore}
            min={0}
            max={100}
            step={5}
            suffix=" 分"
            onChange={(v) => save({ batchScore: v })}
          />
          <div className="rounded-lg bg-ink-950/60 px-3 py-2 text-[11px] leading-relaxed text-ink-400">
            当前策略：≥{s.instantScore} 分或含码/限量 → <span className="text-lime">立即单发</span>；≥{s.batchScore} 分 →{" "}
            <span className="text-sky-300">攒批合并</span>；其余只入库不推送。
          </div>
        </section>

        {/* 频率与静默 */}
        <section className="card space-y-3 p-4">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold">
            <Clock size={15} className="text-lime" /> 频率与免打扰
          </div>
          <NumberField
            label="每小时上限"
            value={s.maxPerHour}
            min={1}
            max={60}
            suffix=" 条"
            onChange={(v) => save({ maxPerHour: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="单次最多"
              value={s.maxPerInstant}
              min={1}
              max={10}
              suffix=" 条"
              onChange={(v) => save({ maxPerInstant: v })}
            />
            <label className="block rounded-xl border border-ink-800 bg-ink-900/50 px-3 py-2">
              <div className="text-[12.5px] text-ink-200">攒批间隔</div>
              <select
                value={s.batchIntervalMin}
                onChange={(e) => save({ batchIntervalMin: Number(e.target.value) })}
                className="mt-1.5 w-full rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-[12px] text-ink-200 outline-none"
              >
                <option value={0}>关闭攒批</option>
                <option value={10}>10 分钟</option>
                <option value={15}>15 分钟</option>
                <option value={30}>30 分钟</option>
                <option value={60}>1 小时</option>
                <option value={120}>2 小时</option>
              </select>
            </label>
          </div>
          <label className="block rounded-xl border border-ink-800 bg-ink-900/50 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-200">
                <Moon size={12} /> 静默时段
              </span>
              <span className={`text-[11px] ${payload?.quiet ? "text-amber-300" : "text-ink-500"}`}>
                {payload?.quiet ? "此刻静默中" : "不在静默"}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                type="time"
                value={s.quietHours.split("-")[0] ?? "23:30"}
                onChange={(e) => save({ quietHours: `${e.target.value}-${s.quietHours.split("-")[1] ?? "08:00"}` })}
                className="flex-1 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[12px] text-ink-200 outline-none"
              />
              <span className="text-ink-500">→</span>
              <input
                type="time"
                value={s.quietHours.split("-")[1] ?? "08:00"}
                onChange={(e) => save({ quietHours: `${s.quietHours.split("-")[0] ?? "23:30"}-${e.target.value}` })}
                className="flex-1 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[12px] text-ink-200 outline-none"
              />
            </div>

            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10.5px] leading-snug text-ink-500">
                这段时间内不推送，全转成攒批，早上一起发
              </span>
              <select
                value={s.timezone}
                onChange={(e) => save({ timezone: e.target.value })}
                className="rounded-md border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10.5px] text-ink-200 outline-none"
                title="静默时段按哪个时区算；容器默认 UTC，必须选对"
              >
                <option value="Asia/Shanghai">北京时间</option>
                <option value="Asia/Tokyo">东京</option>
                <option value="UTC">UTC</option>
                <option value="America/New_York">美东</option>
                <option value="Europe/London">伦敦</option>
              </select>
            </div>
          </label>
        </section>

        {/* 语言与内容 */}
        <section className="card space-y-3 p-4">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold">
            <Languages size={15} className="text-lime" /> 语言与内容
          </div>
          <div>
            <div className="mb-1.5 text-[11px] text-ink-400">只推哪种语言（按标题里中文占比自动判断）</div>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { key: "all" as const, label: "全部", hint: "中英文都推" },
                { key: "zh" as const, label: "只要中文", hint: "跳过英文源" },
                { key: "en" as const, label: "只要英文", hint: "跳过中文源" },
              ].map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => save({ langMode: o.key })}
                  className={
                    "rounded-xl border px-2 py-2 text-[12px] transition-colors " +
                    (s.langMode === o.key
                      ? "border-lime/40 bg-lime/10 text-lime"
                      : "border-ink-800 text-ink-300 hover:border-ink-700")
                  }
                  title={o.hint}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <Toggle
            label="含兑换码立即推"
            hint="邀请码/激活码这类手慢无的，不受评分限制"
            value={s.instantOnCodes}
            onChange={(v) => save({ instantOnCodes: v })}
          />
          <Toggle
            label="限量/限时立即推"
            hint="标题含「先到先得」「名额」「最后」等词"
            value={s.instantOnUrgent}
            onChange={(v) => save({ instantOnUrgent: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Toggle label="带价格" value={s.includePrice} onChange={(v) => save({ includePrice: v })} />
            <Toggle label="带截止时间" value={s.includeDeadline} onChange={(v) => save({ includeDeadline: v })} />
          </div>
          <Toggle
            label="按标题跨源去重"
            hint="同一个免费游戏被 5 个源报道时只推一次（24 小时内）"
            value={s.dedupeByTitle}
            onChange={(v) => save({ dedupeByTitle: v })}
          />
        </section>

        {/* 预览与操作 */}
        <section className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold">
              <Eye size={15} className="text-lime" /> 推送预览
            </div>
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
              className="inline-flex items-center gap-1 rounded-lg border border-ink-700 px-2.5 py-1 text-[11.5px] text-ink-200 hover:border-lime/40 hover:text-lime"
            >
              {busy === "preview" ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} 按当前设置算一遍
            </button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-400">
            下面是「如果现在推，会推出什么」，不会真的发送。调完阈值点一下就能看到效果。
          </p>

          {preview && (
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-[11px] text-lime">⚡ 立即推送（{preview.instant.length}）</div>
                <pre className="max-h-[160px] overflow-auto rounded-lg bg-ink-950/70 p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink-300">
                  {preview.instant.length ? preview.instant.join("\n\n") : "（当前没有达到立即推送阈值的条目）"}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-[11px] text-sky-300">📦 攒批（{preview.batch.length}，队列里 {preview.queued} 条）</div>
                <pre className="max-h-[160px] overflow-auto rounded-lg bg-ink-950/70 p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink-300">
                  {preview.batch.length ? preview.batch.join("\n\n") : "（没有达到攒批阈值的条目）"}
                </pre>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 py-2 text-[12.5px] font-medium text-sky-300 hover:bg-sky-500/25"
            >
              {busy === "flush" ? <Loader2 size={13} className="animate-spin" /> : <ListOrdered size={13} />}
              立即发送攒批队列
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-[12.5px] text-ink-200 hover:border-lime/40 hover:text-lime"
            >
              {busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              发测试消息
            </button>
          </div>
        </section>
      </div>

      {/* 总开关 */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Settings2 size={15} className="text-ink-400" />
          <div>
            <div className="text-[13px] font-medium">推送总开关</div>
            <div className="text-[11px] text-ink-400">关掉后即时与攒批都停，日报仍可手动触发</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => save({ enabled: !s.enabled })}
          className={
            "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-[13px] font-medium transition-colors " +
            (s.enabled
              ? "border-lime/40 bg-lime/10 text-lime"
              : "border-ink-700 bg-ink-900 text-ink-400")
          }
        >
          <BellRing size={14} /> {s.enabled ? "已开启" : "已关闭"}
        </button>
      </section>

      {/* 推送记录 */}
      <section className="card overflow-hidden">
        <div className="border-b border-ink-700/60 px-4 py-3 text-sm font-medium">最近推送记录（{logs.length}）</div>
        <div className="max-h-[420px] overflow-auto">
          {logs.length === 0 && <div className="px-4 py-8 text-center text-[12px] text-ink-500">还没有推送记录</div>}
          {logs.map((l) => (
            <div key={l.id} className="border-b border-ink-800/60 px-4 py-2.5 last:border-0">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={
                    "rounded px-1.5 py-0.5 font-medium " +
                    (l.kind === "instant"
                      ? "bg-amber-400/15 text-amber-300"
                      : l.kind === "batch"
                        ? "bg-sky-400/15 text-sky-300"
                        : "bg-ink-700 text-ink-300")
                  }
                >
                  {l.kind === "instant" ? "即时" : l.kind === "batch" ? "攒批" : l.kind}
                </span>
                <span className="font-mono text-ink-500">{l.created_at.replace("T", " ").slice(5, 19)}</span>
                <span className="text-ink-400">{l.count} 条</span>
                {l.ok === 0 && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-300">失败</span>}
              </div>
              <pre className="max-h-[80px] overflow-hidden font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink-400">
                {(l.text ?? "").slice(0, 240)}
                {(l.text ?? "").length > 240 ? "…" : ""}
              </pre>
              {l.error && <div className="mt-1 font-mono text-[10.5px] text-red-400">{l.error}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

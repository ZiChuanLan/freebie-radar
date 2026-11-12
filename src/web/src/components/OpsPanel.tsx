import { useEffect, useState } from "react";
import { Loader2, Play, Plus, Rss, Search, Send, Trash2 } from "lucide-react";
import { formatInterval, timeAgo } from "../lib/sources.ts";
import type { RetentionSettings, Run, Source } from "../types.ts";

const INTERVAL_OPTIONS = [
  { label: "60 秒", sec: 60 },
  { label: "90 秒", sec: 90 },
  { label: "2 分钟", sec: 120 },
  { label: "5 分钟", sec: 300 },
  { label: "15 分钟", sec: 900 },
  { label: "30 分钟", sec: 1800 },
  { label: "1 小时", sec: 3600 },
  { label: "6 小时", sec: 21600 },
];

export function OpsPanel({
  sources,
  runs,
  sourceName,
  onCollectSource,
  onToggleSource,
  onChangeInterval,
  onAddRss,
  onTestPush,
}: {
  sources: Source[];
  runs: Run[];
  sourceName: (id: string) => string;
  onCollectSource: (id: string) => Promise<void>;
  onToggleSource: (id: string, enabled: boolean) => Promise<void>;
  onChangeInterval: (id: string, sec: number) => Promise<void>;
  onAddRss: (name: string, url: string, intervalSec: number) => Promise<void>;
  onTestPush: () => Promise<void>;
}) {
  const [filterText, setFilterText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "error" | "disabled">("all");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [rssName, setRssName] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [rssInterval, setRssInterval] = useState(1800);
  const [addingRss, setAddingRss] = useState(false);
  const [testingPush, setTestingPush] = useState(false);

  const visibleSources = sources.filter((s) => {
    if (filterText && !(s.name + " " + s.id + " " + s.kind).toLowerCase().includes(filterText.toLowerCase())) {
      return false;
    }
    if (statusFilter === "disabled") return !s.enabled;
    if (statusFilter === "error") return s.last_status === "failed" || s.last_status === "degraded";
    if (statusFilter === "ok") return s.enabled && s.last_status === "ok";
    return true;
  });

  const errorCount = sources.filter((s) => s.enabled && (s.last_status === "failed" || s.last_status === "degraded")).length;

  const [retention, setRetention] = useState<RetentionSettings | null>(null);
  const [retCounts, setRetCounts] = useState<{ total: number; active: number; ignored: number; starred: number } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanPreview, setCleanPreview] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    fetch("/api/retention")
      .then((r) => r.json())
      .then((j: { settings: RetentionSettings; counts: typeof retCounts }) => {
        setRetention(j.settings);
        setRetCounts(j.counts);
      })
      .catch(() => undefined);
  }, []);

  const saveRetentionField = async (patch: Partial<RetentionSettings>) => {
    if (!retention) return;
    setRetention({ ...retention, ...patch });
    const r = await fetch("/api/retention", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) {
      const j = (await r.json()) as { settings: RetentionSettings; counts: typeof retCounts };
      setRetention(j.settings);
      setRetCounts(j.counts);
    }
  };

  const previewCleanup = async () => {
    const r = await fetch("/api/retention/preview", { method: "POST" });
    if (r.ok) setCleanPreview(((await r.json()) as { deleted: Record<string, number> }).deleted);
  };

  const doCleanup = async () => {
    setCleaning(true);
    try {
      const r = await fetch("/api/retention/run", { method: "POST" });
      if (r.ok) {
        const j = (await r.json()) as { deleted: Record<string, number>; counts: typeof retCounts };
        setCleanPreview(j.deleted);
        setRetCounts(j.counts);
      }
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 数据保留与清理 */}
      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
            <Trash2 size={15} className="text-brand" /> 数据保留与清理
          </div>
          {retCounts && (
            <span className="text-[11.5px] text-ink-500">
              在库 <span className="font-mono font-medium text-ink-800">{retCounts.total}</span> · 收藏{" "}
              <span className="font-mono font-medium text-amber-700">{retCounts.starred}</span> · 已关闭{" "}
              <span className="font-mono font-medium">{retCounts.ignored}</span>
            </span>
          )}
        </div>

        {retention && (
          <div className="grid gap-2 sm:grid-cols-5">
            {[
              { key: "itemDays" as const, label: "非福利条目", hint: "天" },
              { key: "keptDays" as const, label: "AI 判福利", hint: "天" },
              { key: "ignoredDays" as const, label: "手动关闭", hint: "天" },
              { key: "pushLogDays" as const, label: "推送日志", hint: "天" },
              { key: "digestDays" as const, label: "每日精选", hint: "天" },
            ].map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-[11.5px] text-ink-600">{f.label}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={retention[f.key]}
                    onChange={(e) => saveRetentionField({ [f.key]: Number(e.target.value) } as Partial<RetentionSettings>)}
                    className="w-full rounded-lg border border-ink-200 bg-surface px-2 py-1.5 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
                  />
                  <span className="text-[11px] text-ink-500">{f.hint}</span>
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-ink-700">
            <input
              type="checkbox"
              checked={retention?.auto ?? true}
              onChange={(e) => saveRetentionField({ auto: e.target.checked })}
              className="h-3.5 w-3.5 accent-brand"
            />
            每天自动清理（收藏的永不删）
          </label>
          <button
            type="button"
            onClick={previewCleanup}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100"
          >
            <Search size={13} /> 预演
          </button>
          <button
            type="button"
            onClick={doCleanup}
            disabled={cleaning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-alert-border bg-alert-subtle px-3 py-1.5 text-[12.5px] font-medium text-alert hover:bg-red-100/80 disabled:opacity-60"
          >
            {cleaning ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} 立即清理
          </button>
        </div>

        {cleanPreview && (
          <div className="rounded-lg border border-ink-200 bg-surface p-2.5 text-[12px] text-ink-700">
            将清理：
            {Object.entries(cleanPreview)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${k} ${n} 条`)
              .join(" · ") || "没有需要清理的条目"}
          </div>
        )}
      </div>
      {/* 顶部功能栏：添加自定义 RSS + 概览 */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="panel space-y-3 p-4 lg:col-span-8">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
            <Rss size={15} className="text-brand" /> 添加自定义 RSS / Atom 源
          </div>
          <div className="grid gap-2 sm:grid-cols-12">
            <input
              value={rssName}
              onChange={(e) => setRssName(e.target.value)}
              placeholder="源名称（如 某博客羊毛）"
              className="rounded-xl border border-ink-200 bg-surface px-3 py-2 text-[12.5px] text-ink-950 outline-none focus:border-brand sm:col-span-3"
            />
            <input
              value={rssUrl}
              onChange={(e) => setRssUrl(e.target.value)}
              placeholder="https://example.com/feed"
              className="rounded-xl border border-ink-200 bg-surface px-3 py-2 text-[12.5px] text-ink-950 outline-none focus:border-brand sm:col-span-5"
            />
            <select
              value={rssInterval}
              onChange={(e) => setRssInterval(Number(e.target.value))}
              className="rounded-xl border border-ink-200 bg-surface px-2 py-2 text-[12px] text-ink-800 outline-none focus:border-brand sm:col-span-2"
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.sec} value={o.sec}>
                  每 {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!rssName.trim() || !/^https?:\/\//i.test(rssUrl.trim()) || addingRss}
              onClick={async () => {
                setAddingRss(true);
                try {
                  await onAddRss(rssName.trim(), rssUrl.trim(), rssInterval);
                  setRssName("");
                  setRssUrl("");
                } finally {
                  setAddingRss(false);
                }
              }}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-brand px-3 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-40 sm:col-span-2"
            >
              {addingRss ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
              加入并采集
            </button>
          </div>
        </div>

        <div className="panel flex flex-col justify-between gap-3 p-4 lg:col-span-4">
          <div>
            <div className="text-[14px] font-semibold text-ink-950">采集健康度</div>
            <p className="mt-1 text-[12.5px] text-ink-500">
              启用源 <span className="font-mono font-semibold text-ink-900">{sources.filter((s) => s.enabled).length}</span> / {sources.length} · 异常{" "}
              <span className={`font-mono font-semibold ${errorCount > 0 ? "text-alert" : "text-deal"}`}>{errorCount}</span>
            </p>
          </div>
          <button
            type="button"
            disabled={testingPush}
            onClick={async () => {
              setTestingPush(true);
              try {
                await onTestPush();
              } finally {
                setTestingPush(false);
              }
            }}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50"
          >
            {testingPush ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            发一条 Telegram 测试消息
          </button>
        </div>
      </div>

      {/* 源控表 */}
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3.5">
          <div className="text-[14px] font-semibold text-ink-950">数据源管理（{visibleSources.length}）</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="搜源名称 / 类型…"
              className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1 text-[12px] text-ink-900 outline-none focus:border-brand"
            />
            {(["all", "ok", "error", "disabled"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k)}
                className={
                  "rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors " +
                  (statusFilter === k ? "bg-brand text-white" : "text-ink-600 hover:bg-ink-100")
                }
              >
                {k === "all" ? "全部" : k === "ok" ? "正常" : k === "error" ? "异常" : "已禁用"}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface-hover text-[11px] tracking-wide text-ink-500 uppercase">
              <tr className="border-b border-ink-200">
                <th className="px-4 py-2.5 font-medium">源</th>
                <th className="px-2 py-2.5 font-medium">启用</th>
                <th className="px-2 py-2.5 font-medium">采集周期</th>
                <th className="px-2 py-2.5 font-medium">在库条数</th>
                <th className="px-2 py-2.5 font-medium">最近采集</th>
                <th className="px-2 py-2.5 font-medium">状态</th>
                <th className="px-2 py-2.5 font-medium">错误信息</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {visibleSources.map((s) => {
                const isCustomInterval = !INTERVAL_OPTIONS.some((o) => o.sec === s.interval_sec);
                return (
                  <tr key={s.id} className="hover:bg-surface-hover">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-ink-950">{s.name}</div>
                      <div className="font-mono text-[11px] text-ink-400">
                        {s.id} · {s.kind}
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() => onToggleSource(s.id, !s.enabled)}
                        className={
                          "h-5 w-9 rounded-full p-0.5 transition-colors " + (s.enabled ? "bg-brand" : "bg-ink-300")
                        }
                        title={s.enabled ? "点击禁用" : "点击启用"}
                      >
                        <span
                          className={
                            "block h-4 w-4 rounded-full bg-white shadow-sm transition-transform " +
                            (s.enabled ? "translate-x-4" : "")
                          }
                        />
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      {s.kind === "ingest" ? (
                        <span className="text-[12px] text-ink-500">本机定时</span>
                      ) : (
                        <select
                          value={s.interval_sec}
                          onChange={(e) => onChangeInterval(s.id, Number(e.target.value))}
                          className="rounded-lg border border-ink-200 bg-surface px-2 py-1 text-[12px] text-ink-800 outline-none focus:border-brand"
                        >
                          {isCustomInterval && <option value={s.interval_sec}>{formatInterval(s.interval_sec)}</option>}
                          {INTERVAL_OPTIONS.map((o) => (
                            <option key={o.sec} value={o.sec}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-2 py-2.5 font-mono tabular-nums text-ink-700">{s.items}</td>
                    <td className="px-2 py-2.5 text-ink-500">{timeAgo(s.last_run_at)}</td>
                    <td className="px-2 py-2.5">
                      <span
                        className={
                          "inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium " +
                          (s.last_status === "ok"
                            ? "bg-deal-subtle text-deal"
                            : s.last_status === "failed"
                              ? "bg-alert-subtle text-alert"
                              : s.last_status === "degraded"
                                ? "bg-code-subtle text-amber-800"
                                : "bg-ink-100 text-ink-600")
                        }
                      >
                        {s.last_status ?? "未运行"}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-2 py-2.5 font-mono text-[11px] text-alert" title={s.last_error ?? ""}>
                      {s.last_error ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {s.kind !== "ingest" && (
                        <button
                          type="button"
                          disabled={runningId === s.id}
                          onClick={async () => {
                            setRunningId(s.id);
                            try {
                              await onCollectSource(s.id);
                            } finally {
                              setRunningId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-700 hover:border-brand-border hover:bg-brand-subtle hover:text-brand disabled:opacity-50"
                        >
                          {runningId === s.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                          立即采集
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 采集日志 */}
      <div className="panel overflow-hidden">
        <div className="border-b border-ink-100 px-4 py-3.5 text-[14px] font-semibold text-ink-950">
          最近采集记录（{runs.length}）
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface-hover text-[11px] tracking-wide text-ink-500 uppercase">
              <tr className="border-b border-ink-200">
                <th className="px-4 py-2 font-medium">时间</th>
                <th className="px-2 py-2 font-medium">源</th>
                <th className="px-2 py-2 font-medium">抓取</th>
                <th className="px-2 py-2 font-medium">新增</th>
                <th className="px-2 py-2 font-medium">耗时</th>
                <th className="px-4 py-2 font-medium">结果</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-2 font-mono text-[12px] text-ink-500">
                    {r.started_at.replace("T", " ").slice(5, 19)}
                  </td>
                  <td className="px-2 py-2 text-ink-800">{sourceName(r.source_id)}</td>
                  <td className="px-2 py-2 font-mono tabular-nums text-ink-700">{r.fetched}</td>
                  <td className="px-2 py-2 font-mono font-medium tabular-nums text-deal">{r.inserted}</td>
                  <td className="px-2 py-2 font-mono tabular-nums text-ink-500">
                    {r.duration_ms ? (r.duration_ms / 1000).toFixed(1) + "s" : "—"}
                  </td>
                  <td className="max-w-[320px] truncate px-4 py-2 font-mono text-[11px] text-ink-500">
                    {r.error ?? r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

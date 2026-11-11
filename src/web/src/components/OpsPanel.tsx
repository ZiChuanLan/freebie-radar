import { useState } from "react";
import { Loader2, Play, Plus, Rss, Send } from "lucide-react";
import { formatInterval, timeAgo } from "../lib/sources.ts";
import type { Run, Source } from "../types.ts";

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

  return (
    <div className="space-y-5">
      {/* 顶部功能栏：添加自定义 RSS + 测试推送 */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="card space-y-3 p-4 lg:col-span-8">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold">
            <Rss size={15} className="text-lime" /> 添加自定义 RSS / Atom 源
          </div>
          <div className="grid gap-2 sm:grid-cols-12">
            <input
              value={rssName}
              onChange={(e) => setRssName(e.target.value)}
              placeholder="源名称（如 某博客羊毛）"
              className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-[12.5px] outline-none focus:border-lime/40 sm:col-span-3"
            />
            <input
              value={rssUrl}
              onChange={(e) => setRssUrl(e.target.value)}
              placeholder="https://example.com/feed"
              className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-[12.5px] outline-none focus:border-lime/40 sm:col-span-5"
            />
            <select
              value={rssInterval}
              onChange={(e) => setRssInterval(Number(e.target.value))}
              className="rounded-xl border border-ink-700 bg-ink-900 px-2 py-2 text-[12px] text-ink-200 outline-none sm:col-span-2"
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
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-lime/15 px-3 py-2 text-[12.5px] font-medium text-lime hover:bg-lime/25 disabled:opacity-40 sm:col-span-2"
            >
              {addingRss ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
              加入并采集
            </button>
          </div>
        </div>

        <div className="card flex flex-col justify-between gap-3 p-4 lg:col-span-4">
          <div>
            <div className="text-[13.5px] font-semibold">推送与巡检概览</div>
            <p className="mt-1 text-[12px] text-ink-400">
              活跃源 {sources.filter((s) => s.enabled).length} / {sources.length} · 异常{" "}
              <span className={errorCount > 0 ? "text-red-400" : "text-lime"}>{errorCount}</span>
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
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-[12.5px] text-ink-200 hover:border-lime/40 hover:text-lime disabled:opacity-50"
          >
            {testingPush ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            发一条 Telegram 测试消息
          </button>
        </div>
      </div>

      {/* 源控表 */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700/60 px-4 py-3">
          <div className="text-sm font-medium">数据源管理（{visibleSources.length}）</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="筛源名称 / kind…"
              className="rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1 text-[12px] outline-none focus:border-lime/40"
            />
            {(["all", "ok", "error", "disabled"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k)}
                className={
                  "rounded-lg px-2.5 py-1 text-[11.5px] " +
                  (statusFilter === k ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200")
                }
              >
                {k === "all" ? "全部" : k === "ok" ? "正常" : k === "error" ? "异常" : "已禁用"}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] tracking-wide text-ink-400 uppercase">
              <tr className="border-b border-ink-800">
                <th className="px-4 py-2 font-medium">源</th>
                <th className="px-2 py-2 font-medium">启用</th>
                <th className="px-2 py-2 font-medium">间隔</th>
                <th className="px-2 py-2 font-medium">条目</th>
                <th className="px-2 py-2 font-medium">最近采集</th>
                <th className="px-2 py-2 font-medium">状态</th>
                <th className="px-2 py-2 font-medium">错误</th>
                <th className="px-4 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleSources.map((s) => {
                const isCustomInterval = !INTERVAL_OPTIONS.some((o) => o.sec === s.interval_sec);
                return (
                  <tr key={s.id} className="border-b border-ink-800/60 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-ink-200">{s.name}</div>
                      <div className="font-mono text-[10.5px] text-ink-500">
                        {s.id} · {s.kind}
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() => onToggleSource(s.id, !s.enabled)}
                        className={
                          "h-5 w-9 rounded-full p-0.5 transition-colors " +
                          (s.enabled ? "bg-lime/70" : "bg-ink-700")
                        }
                        title={s.enabled ? "点击禁用" : "点击启用"}
                      >
                        <span
                          className={
                            "block h-4 w-4 rounded-full bg-ink-950 transition-transform " +
                            (s.enabled ? "translate-x-4" : "")
                          }
                        />
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      {s.kind === "ingest" ? (
                        <span className="text-[11.5px] text-ink-500">本机计划</span>
                      ) : (
                        <select
                          value={s.interval_sec}
                          onChange={(e) => onChangeInterval(s.id, Number(e.target.value))}
                          className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-[11.5px] text-ink-200 outline-none"
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
                    <td className="px-2 py-2.5 tabular-nums text-ink-300">{s.items}</td>
                    <td className="px-2 py-2.5 text-ink-400">{timeAgo(s.last_run_at)}</td>
                    <td className="px-2 py-2.5">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[11px] " +
                          (s.last_status === "ok"
                            ? "bg-lime/15 text-lime"
                            : s.last_status === "failed"
                              ? "bg-red-500/15 text-red-400"
                              : s.last_status === "degraded"
                                ? "bg-amber-500/15 text-amber-400"
                                : "bg-ink-700 text-ink-300")
                        }
                      >
                        {s.last_status ?? "未运行"}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-2 py-2.5 font-mono text-[11px] text-red-400/80" title={s.last_error ?? ""}>
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
                          className="inline-flex items-center gap-1 rounded-lg border border-ink-700 px-2.5 py-1 text-[11.5px] text-ink-200 hover:border-lime/40 hover:text-lime disabled:opacity-50"
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
      <div className="card overflow-hidden">
        <div className="border-b border-ink-700/60 px-4 py-3 text-sm font-medium">最近采集记录（{runs.length}）</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] tracking-wide text-ink-400 uppercase">
              <tr className="border-b border-ink-800">
                <th className="px-4 py-2 font-medium">时间</th>
                <th className="px-2 py-2 font-medium">源</th>
                <th className="px-2 py-2 font-medium">抓取</th>
                <th className="px-2 py-2 font-medium">新增</th>
                <th className="px-2 py-2 font-medium">耗时</th>
                <th className="px-4 py-2 font-medium">结果</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-ink-800/60 last:border-0">
                  <td className="px-4 py-2 font-mono text-[11.5px] text-ink-400">
                    {r.started_at.replace("T", " ").slice(5, 19)}
                  </td>
                  <td className="px-2 py-2 text-ink-300">{sourceName(r.source_id)}</td>
                  <td className="px-2 py-2 tabular-nums text-ink-300">{r.fetched}</td>
                  <td className="px-2 py-2 tabular-nums text-lime">{r.inserted}</td>
                  <td className="px-2 py-2 tabular-nums text-ink-400">
                    {r.duration_ms ? (r.duration_ms / 1000).toFixed(1) + "s" : "—"}
                  </td>
                  <td className="max-w-[320px] truncate px-4 py-2 font-mono text-[11px] text-ink-400">
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

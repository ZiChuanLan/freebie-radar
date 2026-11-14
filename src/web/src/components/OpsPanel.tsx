import { useEffect, useState } from "react";
import { Activity, Copy, Database, ExternalLink, Loader2, Play, Plus, Rss, Search, ShieldCheck, Trash2 } from "lucide-react";
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

type OpsTab = "sources" | "runs" | "retention";

export function OpsPanel({
  sources,
  runs,
  sourceName,
  onCollectSource,
  onToggleSource,
  onChangeInterval,
  onAddRss,
  onNotify,
}: {
  sources: Source[];
  runs: Run[];
  sourceName: (id: string) => string;
  onCollectSource: (id: string) => Promise<void>;
  onToggleSource: (id: string, enabled: boolean) => Promise<void>;
  onChangeInterval: (id: string, sec: number) => Promise<void>;
  onAddRss: (name: string, url: string, intervalSec: number) => Promise<void>;
  onNotify?: (msg: string) => void;
}) {
  const [subTab, setSubTab] = useState<OpsTab>("sources");
  const [filterText, setFilterText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "error" | "disabled">("all");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [showAddRss, setShowAddRss] = useState(false);
  const [rssName, setRssName] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [rssInterval, setRssInterval] = useState(1800);
  const [addingRss, setAddingRss] = useState(false);
  const [showIngestGuide, setShowIngestGuide] = useState(false);
  const [helperUrl, setHelperUrl] = useState(() => {
    try {
      return localStorage.getItem("radar_loopback_helper") || "http://127.0.0.1:18789";
    } catch {
      return "http://127.0.0.1:18789";
    }
  });
  const [ingestTokenInput, setIngestTokenInput] = useState("");

  const siteKeyOf = (id: string) => (id.startsWith("zhihu") ? "zhihu" : id.startsWith("xhs") ? "xhs" : "xiaoheihe");

  const startLoopbackLogin = async (sourceId: string) => {
    const base = helperUrl.replace(/\/+$/, "");
    const site = siteKeyOf(sourceId);
    try {
      const probe = await fetch(base + "/status", { signal: AbortSignal.timeout(1500) });
      if (!probe.ok) throw new Error("not ok");
    } catch {
      setShowIngestGuide(true);
      onNotify?.("未检测到本机回环助手（请按下方指引先启动，Cookie 绝不上传）");
      return;
    }
    const target = new URL(base + "/login");
    target.searchParams.set("site", site);
    target.searchParams.set("server", window.location.origin);
    target.searchParams.set("return_to", window.location.href.split("#")[0] ?? window.location.origin);
    if (ingestTokenInput.trim()) target.searchParams.set("token", ingestTokenInput.trim());
    window.open(target.toString(), "_blank", "noopener");
  };

  const buildUserscript = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8788";
    const tok = ingestTokenInput.trim() || "请替换为你的 INGEST_TOKEN";
    return `// ==UserScript==
// @name         Freebie Radar 零 Cookie 上传采集助手
// @namespace    https://github.com/ZiChuanLan/freebie-radar
// @version      0.1.0
// @description  仅读取当前搜索页公开帖子标题与链接发送到你自己的 Freebie Radar，Cookie 绝不离开浏览器
// @match        https://www.xiaohongshu.com/search_result*
// @match        https://www.zhihu.com/search*
// @match        https://www.xiaoheihe.cn/app/bbs/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==
(function () {
  const SERVER = ${JSON.stringify(origin)};
  const TOKEN = ${JSON.stringify(tok)};
  function push(sourceId, items) {
    if (!items.length) return;
    GM_xmlhttpRequest({
      method: "POST",
      url: SERVER + "/api/ingest",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      data: JSON.stringify({ sourceId, items }),
      onload: (r) => console.log("[FreebieRadar]", sourceId, r.status, r.responseText),
    });
  }
  setTimeout(() => {
    const h = location.hostname;
    if (h.includes("xiaohongshu")) {
      const items = [...document.querySelectorAll("section.note-item")].map((c) => {
        const a = c.querySelector('a.cover, a[href*="/explore/"], a[href*="/search_result/"]');
        const t = c.querySelector(".title span, .footer .title, .title");
        const img = c.querySelector("img");
        return a && t ? { externalId: a.href, url: a.href, title: t.textContent.trim(), summary: "", imageUrl: img?.src || "" } : null;
      }).filter((x) => x && x.title && x.url);
      push("xhs-search", items);
    } else if (h.includes("zhihu")) {
      const items = [...document.querySelectorAll(".SearchResult-Card, .List-item")].map((c) => {
        const a = c.querySelector("h2 a, .ContentItem-title a");
        const t = c.querySelector(".RichText");
        const img = c.querySelector("img");
        return a ? { externalId: a.href, url: a.href, title: a.textContent.trim(), summary: (t?.textContent || "").trim().slice(0, 300), imageUrl: img?.getAttribute("data-original") || img?.src || "" } : null;
      }).filter((x) => x && x.title && x.url);
      push("zhihu-search", items);
    }
  }, 3500);
})();`;
  };

  const visibleSources = sources.filter((s) => {
    if (filterText && !(s.name + " " + s.id + " " + s.kind).toLowerCase().includes(filterText.toLowerCase())) {
      return false;
    }
    if (statusFilter === "disabled") return !s.enabled;
    if (statusFilter === "error") return s.last_status === "failed" || s.last_status === "degraded";
    if (statusFilter === "ok") return s.enabled && s.last_status === "ok";
    return true;
  });

  const enabledCount = sources.filter((s) => s.enabled).length;
  const errorCount = sources.filter((s) => s.enabled && (s.last_status === "failed" || s.last_status === "degraded")).length;

  const [retention, setRetention] = useState<RetentionSettings | null>(null);
  const [retCounts, setRetCounts] = useState<{ total: number; active: number; ignored: number; starred: number } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanPreview, setCleanPreview] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    fetch("/api/retention")
      .then((r) => r.json() as Promise<{ settings: RetentionSettings; counts: typeof retCounts }>)
      .then((j) => {
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
      onNotify?.("保留策略已保存");
    } else {
      onNotify?.("保存失败");
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
        onNotify?.("清理完成");
      }
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部概览 + 子页签 */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: "sources" as OpsTab, label: `数据源 (${enabledCount}/${sources.length})`, icon: Rss },
            { key: "runs" as OpsTab, label: `采集记录 (${runs.length})`, icon: Activity },
            { key: "retention" as OpsTab, label: "数据保留与清理", icon: Database },
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
        <div className="flex items-center gap-3 text-[12px] text-ink-500">
          <span>
            异常源{" "}
            <span className={`font-mono font-semibold ${errorCount > 0 ? "text-alert" : "text-deal"}`}>{errorCount}</span>
          </span>
          {retCounts && (
            <span>
              在库 <span className="font-mono font-semibold text-ink-800">{retCounts.total}</span>
            </span>
          )}
        </div>
      </div>

      {subTab === "sources" && (
        <div className="space-y-4">
          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="搜源名称 / 类型…"
                  className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12px] text-ink-900 outline-none focus:border-brand"
                />
                {(["all", "ok", "error", "disabled"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStatusFilter(k)}
                    className={
                      "rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors " +
                      (statusFilter === k ? "bg-brand-subtle text-brand" : "text-ink-600 hover:bg-ink-100")
                    }
                  >
                    {k === "all" ? `全部 (${sources.length})` : k === "ok" ? "正常" : k === "error" ? `异常 (${errorCount})` : "已禁用"}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowIngestGuide((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-700 hover:border-brand-border hover:text-brand"
                >
                  <ShieldCheck size={13} /> {showIngestGuide ? "收起登录态接入" : "登录态接入（零 Cookie 上传）"}
                </button>
              <button
                type="button"
                onClick={() => setShowAddRss((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-brand-border bg-brand-subtle px-3 py-1.5 text-[12px] font-medium text-brand hover:bg-ink-200/70"
              >
                <Plus size={13} /> {showAddRss ? "收起" : "添加 RSS / Atom"}
              </button>
            </div>
              </div>

            {showIngestGuide && (
              <div className="space-y-3 border-b border-ink-100 bg-brand-subtle/60 px-4 py-3 text-[12.5px] text-ink-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium text-ink-900">
                    <ShieldCheck size={14} className="text-brand" />
                    知乎 / 小红书 / 小黑盒采集（Cookie 永远只留在本机，绝不上传服务端）
                  </div>
                  <span className="text-[11.5px] text-ink-500">点下方对应源的「扫码登录」→ 弹本地窗扫码 → 自动采集并跳回本页</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11.5px] text-ink-500">本机回环助手地址</span>
                    <input
                      value={helperUrl}
                      onChange={(e) => {
                        setHelperUrl(e.target.value);
                        try {
                          localStorage.setItem("radar_loopback_helper", e.target.value);
                        } catch { /* ignore */ }
                      }}
                      className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-900 outline-none focus:border-brand"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11.5px] text-ink-500">可选回传 INGEST_TOKEN（留空则用本机助手 .env）</span>
                    <input
                      type="password"
                      value={ingestTokenInput}
                      onChange={(e) => setIngestTokenInput(e.target.value)}
                      placeholder="若本机 .env 已配 INGEST_TOKEN 可留空"
                      className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-900 outline-none focus:border-brand"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="text-ink-500">方式 A（本机回环服务，平时无常驻浏览器）：</span>
                  <code className="rounded bg-surface px-2 py-1 font-mono text-[11.5px] text-ink-900">
                    SERVER_URL={typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8788"} node scripts/pw-collect.mjs serve
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(
                        `SERVER_URL=${window.location.origin} node scripts/pw-collect.mjs serve`,
                      );
                      onNotify?.("已复制回环助手启动命令");
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-2 py-1 text-[11.5px] hover:border-brand-border hover:text-brand"
                  >
                    <Copy size={11} /> 复制命令
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(buildUserscript());
                      onNotify?.("已复制 Tampermonkey 油猴脚本（免装 Playwright）");
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-brand-border bg-surface px-2 py-1 text-[11.5px] text-brand hover:bg-brand-subtle"
                  >
                    <Copy size={11} /> 复制油猴脚本（方式 B · 免装 Node）
                  </button>
                </div>
              </div>
            )}
            {showAddRss && (
              <div className="border-b border-ink-100 bg-surface-hover px-4 py-3">
                <div className="grid gap-2 sm:grid-cols-12">
                  <input
                    value={rssName}
                    onChange={(e) => setRssName(e.target.value)}
                    placeholder="源名称（如 某博客羊毛）"
                    className="rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[12.5px] text-ink-950 outline-none focus:border-brand sm:col-span-3"
                  />
                  <input
                    value={rssUrl}
                    onChange={(e) => setRssUrl(e.target.value)}
                    placeholder="https://example.com/feed"
                    className="rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[12.5px] text-ink-950 outline-none focus:border-brand sm:col-span-5"
                  />
                  <select
                    value={rssInterval}
                    onChange={(e) => setRssInterval(Number(e.target.value))}
                    className="rounded-lg border border-ink-200 bg-surface px-2 py-2 text-[12px] text-ink-800 outline-none focus:border-brand sm:col-span-2"
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
                        setShowAddRss(false);
                      } finally {
                        setAddingRss(false);
                      }
                    }}
                    className="inline-flex items-center justify-center gap-1 rounded-lg bg-brand px-3 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-40 sm:col-span-2"
                  >
                    {addingRss ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
                    加入并采集
                  </button>
                </div>
              </div>
            )}

            {/* 移动端：卡片式源列表（表格仅 ≥sm 显示，避免横向挤压） */}
            <div className="divide-y divide-ink-100 sm:hidden">
              {visibleSources.map((s) => {
                const isCustomInterval = !INTERVAL_OPTIONS.some((o) => o.sec === s.interval_sec);
                return (
                  <div key={s.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-ink-950">{s.name}</div>
                        <div className="truncate font-mono text-[11px] text-ink-400">
                          {s.id} · {s.kind}
                        </div>
                      </div>
                      <span
                        className={
                          "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium " +
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
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-500">
                      <span className="font-mono tabular-nums text-ink-700">{s.items} 条在库</span>
                      <span>{timeAgo(s.last_run_at)}采集</span>
                      <button
                        type="button"
                        onClick={() => onToggleSource(s.id, !s.enabled)}
                        className={"h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors " + (s.enabled ? "bg-brand" : "bg-ink-300")}
                        title={s.enabled ? "点击禁用" : "点击启用"}
                      >
                        <span
                          className={
                            "block h-4 w-4 rounded-full bg-white shadow-sm transition-transform " + (s.enabled ? "translate-x-4" : "")
                          }
                        />
                      </button>
                      {s.kind === "ingest" ? (
                        <span className="text-[12px] text-ink-500">本机定时</span>
                      ) : (
                        <select
                          value={s.interval_sec}
                          onChange={(e) => onChangeInterval(s.id, Number(e.target.value))}
                          className="rounded-lg border border-ink-200 bg-surface px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-brand"
                        >
                          {isCustomInterval && <option value={s.interval_sec}>{formatInterval(s.interval_sec)}</option>}
                          {INTERVAL_OPTIONS.map((o) => (
                            <option key={o.sec} value={o.sec}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {s.last_error && <div className="mt-1.5 font-mono text-[11px] text-alert">{s.last_error}</div>}

                    <div className="mt-2">
                      {s.kind === "ingest" ? (
                        <button
                          type="button"
                          onClick={() => void startLoopbackLogin(s.id)}
                          className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-brand-border bg-brand-subtle px-2.5 py-2 text-[12px] font-medium text-brand hover:bg-ink-200/70"
                          title="通过本机回环助手扫码登录并采集，Cookie 仅留在本机"
                        >
                          <ExternalLink size={11} />
                          扫码登录
                        </button>
                      ) : (
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
                          className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-ink-200 bg-surface px-2.5 py-2 text-[12px] font-medium text-ink-700 hover:border-brand-border hover:bg-brand-subtle hover:text-brand disabled:opacity-50"
                        >
                          {runningId === s.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                          立即采集
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto sm:block">
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
                          {s.kind === "ingest" ? (
                            <button
                              type="button"
                              onClick={() => void startLoopbackLogin(s.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-brand-border bg-brand-subtle px-2.5 py-1 text-[12px] font-medium text-brand hover:bg-ink-200/70"
                              title="通过本机回环助手扫码登录并采集，Cookie 仅留在本机"
                            >
                              <ExternalLink size={11} />
                              扫码登录
                            </button>
                          ) : (
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
        </div>
      )}

      {subTab === "runs" && (
        <div className="panel overflow-hidden">
          <div className="border-b border-ink-100 px-4 py-3 text-[13.5px] font-semibold text-ink-950">
            最近采集记录（{runs.length}）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
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
      )}

      {subTab === "retention" && (
        <div className="panel space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-950">
                <Trash2 size={15} className="text-brand" /> 数据保留与自动清理
              </div>
              <p className="mt-0.5 text-[12px] text-ink-500">
                修改天数后失焦即保存；收藏条目永久保留不删除。
              </p>
            </div>
            {retCounts && (
              <span className="text-[12px] text-ink-500">
                在库 <span className="font-mono font-medium text-ink-800">{retCounts.total}</span> · 收藏{" "}
                <span className="font-mono font-medium text-amber-700">{retCounts.starred}</span> · 已关闭{" "}
                <span className="font-mono font-medium">{retCounts.ignored}</span>
              </span>
            )}
          </div>

          {retention && (
            <div className="grid gap-3 sm:grid-cols-5">
              {[
                { key: "itemDays" as const, label: "非福利条目", hint: "天" },
                { key: "keptDays" as const, label: "AI 判福利", hint: "天" },
                { key: "ignoredDays" as const, label: "手动关闭", hint: "天" },
                { key: "pushLogDays" as const, label: "推送日志", hint: "天" },
                { key: "digestDays" as const, label: "每日精选", hint: "天" },
              ].map((f) => (
                <label key={f.key} className="block rounded-lg border border-ink-200 bg-surface-hover p-3">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink-700">{f.label}</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={retention[f.key]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setRetention({ ...retention, [f.key]: Number.isFinite(v) ? v : 0 });
                      }}
                      onBlur={(e) => {
                        const raw = Number(e.target.value);
                        const clamped = Math.min(Math.max(Number.isFinite(raw) ? Math.round(raw) : 1, 1), 3650);
                        void saveRetentionField({ [f.key]: clamped } as Partial<RetentionSettings>);
                      }}
                      className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[13px] text-ink-900 outline-none focus:border-brand"
                    />
                    <span className="text-[11.5px] text-ink-500">{f.hint}</span>
                  </div>
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-700">
              <input
                type="checkbox"
                checked={retention?.auto ?? true}
                onChange={(e) => void saveRetentionField({ auto: e.target.checked })}
                className="h-4 w-4 accent-brand"
              />
              每天自动清理过期数据
            </label>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={previewCleanup}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100"
              >
                <Search size={13} /> 预演清理量
              </button>
              <button
                type="button"
                disabled={cleaning}
                onClick={doCleanup}
                className="inline-flex items-center gap-1.5 rounded-lg border border-alert-border bg-alert-subtle px-3.5 py-1.5 text-[12.5px] font-medium text-alert hover:bg-red-100/80 disabled:opacity-60"
              >
                {cleaning ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} 立即清理
              </button>
            </div>
          </div>

          {cleanPreview && (
            <div className="rounded-lg border border-ink-200 bg-surface-hover p-3 text-[12.5px] text-ink-700">
              将清理：
              {Object.entries(cleanPreview)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `${k} ${n} 条`)
                .join(" · ") || "没有需要清理的条目"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PushLogItem, PushPayload, PushSettings } from "./types.ts";
import {
  Activity,
  Bell,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  LayoutGrid,
  List,
  Loader2,
  Radar,
  RefreshCw,
  Search,
  ShieldBan,
  Wrench,
  Zap,
} from "lucide-react";
import { CompactRow, ItemCard, ItemDetail, QuickBlockModal } from "./components/ItemView.tsx";
import { DigestPanel } from "./components/DigestPanel.tsx";
import { RulesPanel } from "./components/RulesPanel.tsx";
import { OpsPanel } from "./components/OpsPanel.tsx";
import { PushPanel } from "./components/PushPanel.tsx";
import {
  CATEGORY_LABEL,
  SOURCE_GROUPS,
  formatInterval,
  groupOfSource,
  timeAgo,
} from "./lib/sources.ts";
import type { BlockPreset, BlockRule, Item, Run, Source, Stats, Subscription } from "./types.ts";

const SOURCE_LABEL: Record<string, string> = {
  "linuxdo-welfare": "LINUX DO · 福利羊毛",
  "linuxdo-resource": "LINUX DO · 资源荟萃",
  "v2ex-free": "V2EX · 免费赠送",
  "github-free-for-dev": "GitHub · free-for-dev",
  "rss-fuliba": "福利吧",
  "rss-52pojie": "吾爱破解",
  "rss-smzdm": "什么值得买",
  "zhihu-search": "知乎 · 福利搜索",
  "xhs-search": "小红书 · 福利搜索",
  "xiaoheihe-search": "小黑盒 · 福利搜索",
  "tg-channels": "Telegram 频道",
  gamerpower: "GamerPower · 免费游戏",
  "epic-free": "Epic Games · 喜加一",
  "rss-reddit-freegames": "Reddit · FreeGameFindings",
  "rss-reddit-efreebies": "Reddit · eFreebies",
  "rss-reddit-gamedeals": "Reddit · GameDeals",
  "rss-slickdeals": "Slickdeals",
  "rss-heyitsfree": "HeyItsFree",
  "rss-keylol": "其乐 Keylol",
  "mock-source": "Mock 源",
};

// 源显示名以 /api/sources 的 name 为准，SOURCE_LABEL 只作首屏兜底
let SOURCE_NAMES: Record<string, string> = { ...SOURCE_LABEL };
const sourceName = (id: string) => SOURCE_NAMES[id] ?? SOURCE_LABEL[id] ?? id;

type Tab = "feed" | "digest" | "rules" | "push" | "ops";

function useApi<T>(url: string | null): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    setLoading(true);
    fetch(url, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return (await r.json()) as T;
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [url, nonce]);

  return { data, loading, error, reload };
}

function StatPill({ label, value, accent }: { label: string; value: number | string; accent?: boolean | "warn" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={
          "text-lg font-semibold tabular-nums " +
          (accent === "warn" ? "text-red-400" : accent ? "text-lime" : "text-ink-100")
        }
      >
        {value}
      </span>
      <span className="text-[11px] tracking-wide text-ink-400 uppercase">{label}</span>
    </div>
  );
}

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-lime/30 bg-ink-850/95 px-4 py-2 text-[13px] text-lime shadow-xl backdrop-blur">
      {message}
    </div>
  );
}

export function App() {
  const initialTab = (): Tab => {
    if (typeof location === "undefined") return "feed";
    const h = location.hash.replace("#", "");
    return h === "digest" || h === "rules" || h === "push" || h === "ops" ? (h as Tab) : "feed";
  };

  const [tab, setTab] = useState<Tab>(initialTab);
  const [detail, setDetail] = useState<Item | null>(null);
  const [quickBlock, setQuickBlock] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("score");
  const [range, setRange] = useState("all");
  const [priceCap, setPriceCap] = useState("all");
  const [flags, setFlags] = useState({ fresh: true, unread: false, codes: false, starred: false, subscribed: false, expiring: false });
  const [viewMode, setViewMode] = useState<"card" | "compact">("card");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [showAllSources, setShowAllSources] = useState(false);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  const copyCode = useCallback(
    (code: string) => {
      void navigator.clipboard?.writeText(code);
      notify("已复制 " + code);
    },
    [notify],
  );

  // 支持直接分享 #rules / #ops 链接，也支持浏览器前进后退
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace("#", "");
      setTab(h === "digest" || h === "rules" || h === "push" || h === "ops" ? (h as Tab) : "feed");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (typeof location === "undefined") return;
    if (tab === "feed") history.replaceState(null, "", location.pathname + location.search);
    else history.replaceState(null, "", "#" + tab);
  }, [tab]);

  const [, bumpNames] = useState(0);
  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d: { sources: { id: string; name: string }[] }) => {
        const m: Record<string, string> = { ...SOURCE_LABEL };
        for (const s of d.sources) if (s.name) m[s.id] = s.name;
        SOURCE_NAMES = m;
        bumpNames((n) => n + 1);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("search", debounced);
    if (source) p.set("source", source);
    if (category) p.set("category", category);
    if (sort) p.set("sort", sort);
    if (flags.fresh) p.set("unexpired", "1");
    if (flags.unread) p.set("unread", "1");
    if (flags.codes) p.set("hasCodes", "1");
    if (flags.starred) p.set("starred", "1");
    if (flags.subscribed) p.set("subscribed", "1");
    if (flags.expiring) p.set("expiring", "1");
    if (priceCap === "free") p.set("freeOnly", "1");
    else if (priceCap !== "all") p.set("maxPrice", priceCap);
    const DAYS: Record<string, number> = { "1d": 1, "3d": 3, "7d": 7, "30d": 30 };
    const days = DAYS[range];
    if (days) p.set("since", new Date(Date.now() - days * 86_400_000).toISOString());
    p.set("limit", "80");
    return p.toString();
  }, [debounced, source, category, sort, range, priceCap, flags]);

  const stats = useApi<Stats>("/api/stats");
  const items = useApi<{ total: number; items: Item[] }>(`/api/items?${query}`);
  const subs = useApi<{ subscriptions: Subscription[] }>("/api/subscriptions");
  const sources = useApi<{ sources: Source[] }>("/api/sources");
  const runs = useApi<{ runs: Run[] }>("/api/runs?limit=40");
  const blockRules = useApi<{ rules: BlockRule[]; totalBlocked: number; presets: BlockPreset[] }>("/api/block-rules");
  const push = useApi<PushPayload>("/api/push");
  const pushLogs = useApi<{ logs: PushLogItem[] }>(tab === "push" ? "/api/push/log?limit=40" : null);
  const [pushPreview, setPushPreview] = useState<{ instant: string[]; batch: string[]; queued: number } | null>(null);
  const digests = useApi<{ digests: { date: string; created_at: string; pushed_at: string | null }[] }>("/api/digests");
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const activeDate = pickedDate ?? digests.data?.digests?.[0]?.date ?? null;
  const digestDetail = useApi<{
    date: string;
    text: string;
    count: number;
    created_at: string;
    pushed_at: string | null;
    items: Item[];
  }>(activeDate && tab === "digest" ? "/api/digests/" + activeDate : null);

  const [blockedPreview, setBlockedPreview] = useState<Item[] | null>(null);

  const patch = useCallback(
    async (id: number, body: Record<string, unknown>) => {
      await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      items.reload();
      stats.reload();
      if (detail && detail.id === id) {
        const next = await fetch(`/api/items/${id}`).then((r) => r.json());
        setDetail(next as Item);
      }
    },
    [items, stats, detail],
  );

  const addRule = useCallback(
    async (pattern: string, mode: "keyword" | "regex", scope: string) => {
      const res = await fetch("/api/block-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pattern, mode, scope }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        notify(err.error ?? "添加失败");
        return;
      }
      notify("已屏蔽「" + pattern + "」");
      blockRules.reload();
      items.reload();
      stats.reload();
      setBlockedPreview(null);
    },
    [blockRules, items, stats, notify],
  );

  const quickBlockAdd = useCallback(
    async (pattern: string, scope: string) => {
      await addRule(pattern, "keyword", scope);
    },
    [addRule],
  );

  const addSubscription = useCallback(
    async (kw: string) => {
      await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: kw }),
      });
      subs.reload();
      items.reload();
      notify("已订阅「" + kw + "」");
    },
    [subs, items, notify],
  );

  const removeSubscription = useCallback(
    async (id: number) => {
      await fetch("/api/subscriptions/" + id, { method: "DELETE" });
      subs.reload();
      items.reload();
    },
    [subs, items],
  );

  const refreshAll = useCallback(() => {
    items.reload();
    stats.reload();
    sources.reload();
    runs.reload();
    blockRules.reload();
  }, [items, stats, sources, runs, blockRules]);

  const maxCategory = Math.max(1, ...(stats.data?.byCategory ?? []).map((c) => c.n));
  const enabledSources = (sources.data?.sources ?? []).filter((s) => s.enabled || showAllSources);
  const grouped = SOURCE_GROUPS.map((g) => ({
    ...g,
    sources: enabledSources.filter((s) => groupOfSource(s) === g.key),
  })).filter((g) => g.sources.length > 0);

  const tabs: { key: Tab; label: string; icon: typeof Activity; badge?: number }[] = [
    { key: "feed", label: "资源流", icon: Activity },
    { key: "digest", label: "每日精选", icon: Radar },
    { key: "rules", label: "订阅与屏蔽", icon: ShieldBan, badge: stats.data?.totals.blockRules },
    { key: "push", label: "推送", icon: Zap, badge: push.data?.stats.queued },
    { key: "ops", label: "运维", icon: Wrench },
  ];

  const exportUrl = "/api/export?format=md&" + query.replace(/limit=\d+/, "limit=300");

  return (
    <div className="mx-auto flex min-h-screen max-w-[1360px] flex-col px-5 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-lime/30 bg-lime/10">
            <Radar size={20} className="text-lime" />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight">白嫖雷达</h1>
            <p className="text-[11.5px] text-ink-400">
              {sources.data?.sources.filter((s) => s.enabled).length ?? "—"} 个源 · 免费额度 · 喜加一 · 限时开放注册
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <StatPill label="在库" value={stats.data?.totals.active ?? "—"} />
          <StatPill label="24h 新增" value={stats.data?.totals.last24h ?? "—"} accent />
          <StatPill label="含码" value={stats.data?.totals.withCodes ?? "—"} />
          <StatPill label="已屏蔽" value={stats.data?.totals.blockRules ?? 0} accent="warn" />
          <div className="hidden items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-[11.5px] text-ink-300 lg:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${stats.data?.features.push ? "bg-lime" : "bg-ink-500"}`} />
            推送 {stats.data?.features.push ? stats.data.features.pushChannel : "关"}
          </div>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜「免费」「Epic」「域名」「会员」…"
            className="w-full rounded-xl border border-ink-700 bg-ink-900/70 py-2.5 pr-3 pl-9 text-[13.5px] outline-none transition-colors placeholder:text-ink-400/70 focus:border-lime/40"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-ink-700 bg-ink-900/60 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] transition-colors ${
                tab === t.key ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200"
              }`}
            >
              <t.icon size={13} />
              {t.label}
              {typeof t.badge === "number" && t.badge > 0 && (
                <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] text-red-300">{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={refreshAll}
          className="rounded-xl border border-ink-700 bg-ink-900/60 p-2.5 text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
          title="刷新"
        >
          <RefreshCw size={15} className={items.loading ? "animate-spin" : ""} />
        </button>
      </div>

      {tab === "feed" && (
        <div className="flex flex-1 flex-col gap-4 lg:flex-row">
          <aside className="w-full shrink-0 space-y-4 lg:w-[228px]">
            <section>
              <div className="mb-2 flex items-center justify-between text-[11px] tracking-wider text-ink-400 uppercase">
                <span className="inline-flex items-center gap-1.5">
                  <Filter size={11} /> 来源
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllSources((v) => !v)}
                  className="text-[10px] text-ink-500 hover:text-ink-300"
                  title="显示/隐藏已禁用的源"
                >
                  {showAllSources ? "隐藏禁用" : "显示全部"}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSource("")}
                className={`mb-1 w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                  source === "" ? "bg-ink-700/70 text-ink-100" : "text-ink-300 hover:bg-ink-800/60"
                }`}
              >
                全部来源
              </button>

              {grouped.map((g) => {
                const collapsed = collapsedGroups[g.key];
                const total = g.sources.reduce((n, s) => n + s.items, 0);
                return (
                  <div key={g.key} className="mb-1.5">
                    <button
                      type="button"
                      onClick={() => setCollapsedGroups((m) => ({ ...m, [g.key]: !m[g.key] }))}
                      className="flex w-full items-center gap-1 px-1 py-1 text-[10.5px] tracking-wide text-ink-500 uppercase hover:text-ink-300"
                    >
                      {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                      <span className="flex-1 text-left">{g.label}</span>
                      <span className="font-mono">{total}</span>
                    </button>
                    {!collapsed && (
                      <div className="space-y-0.5">
                        {g.sources.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setSource(s.id === source ? "" : s.id)}
                            className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[12px] transition-colors ${
                              source === s.id ? "bg-ink-700/70 text-ink-100" : "text-ink-300 hover:bg-ink-800/60"
                            } ${s.enabled ? "" : "opacity-40"}`}
                            title={s.id + " · 间隔 " + formatInterval(s.interval_sec)}
                          >
                            <span className="truncate">{s.name}</span>
                            <span className="ml-2 shrink-0 font-mono text-[10px] text-ink-500">{s.items}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>

            <section>
              <div className="mb-2 text-[11px] tracking-wider text-ink-400 uppercase">分类</div>
              <div className="space-y-1">
                {(stats.data?.byCategory ?? []).map((c) => (
                  <button
                    key={c.category ?? "other"}
                    type="button"
                    onClick={() => setCategory(category === (c.category ?? "") ? "" : (c.category ?? ""))}
                    className={`block w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                      category === (c.category ?? "") ? "bg-ink-700/70" : "hover:bg-ink-800/60"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span className="text-ink-200">{CATEGORY_LABEL[c.category ?? "other"] ?? c.category}</span>
                      <span className="font-mono text-[10.5px] text-ink-400">{c.n}</span>
                    </div>
                    <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-ink-800">
                      <div className="h-full rounded-full bg-lime/50" style={{ width: `${(c.n / maxCategory) * 100}%` }} />
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 text-[11px] tracking-wider text-ink-400 uppercase">我能付多少</div>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { key: "all", label: "不限" },
                  { key: "free", label: "白嫖" },
                  { key: "5", label: "≤5" },
                  { key: "10", label: "≤10" },
                  { key: "30", label: "≤30" },
                  { key: "100", label: "≤100" },
                ].map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setPriceCap(o.key)}
                    className={
                      "rounded-lg border px-1 py-1.5 text-[11.5px] transition-colors " +
                      (priceCap === o.key
                        ? "border-lime/40 bg-lime/10 text-lime"
                        : "border-ink-700 text-ink-300 hover:border-ink-600")
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 text-[10.5px] text-ink-500">
                白嫖 {stats.data?.price?.free ?? 0} · ≤5 元 {stats.data?.price?.under5 ?? 0}
              </div>
            </section>

            <section className="space-y-1">
              <div className="mb-1.5 text-[11px] tracking-wider text-ink-400 uppercase">筛选</div>
              {[
                { key: "fresh" as const, label: "只看未过期" },
                { key: "unread" as const, label: "只看未读" },
                { key: "codes" as const, label: "只看含兑换码" },
                { key: "subscribed" as const, label: "订阅命中" },
                { key: "expiring" as const, label: "3 天内截止" },
                { key: "starred" as const, label: "只看收藏" },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFlags((v) => ({ ...v, [f.key]: !v[f.key] }))}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[12.5px] transition-colors ${
                    flags[f.key] ? "bg-lime/10 text-lime" : "text-ink-300 hover:bg-ink-800/60"
                  }`}
                >
                  {f.label}
                  <span className={`h-3.5 w-6 rounded-full p-0.5 transition-colors ${flags[f.key] ? "bg-lime/70" : "bg-ink-700"}`}>
                    <span
                      className={`block h-2.5 w-2.5 rounded-full bg-ink-950 transition-transform ${
                        flags[f.key] ? "translate-x-2.5" : ""
                      }`}
                    />
                  </span>
                </button>
              ))}
            </section>

            <section className="space-y-1.5">
              <div className="text-[11px] tracking-wider text-ink-400 uppercase">时间 / 排序</div>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value)}
                className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-[12.5px] text-ink-200 outline-none"
              >
                <option value="all">不限时间</option>
                <option value="1d">24 小时内</option>
                <option value="3d">3 天内</option>
                <option value="7d">一周内</option>
                <option value="30d">一个月内</option>
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-[12.5px] text-ink-200 outline-none"
              >
                <option value="score">综合评分</option>
                <option value="newest">最新发布</option>
                <option value="oldest">最早发布</option>
                <option value="price_asc">价格从低到高</option>
              </select>
            </section>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-0.5">
              <div className="text-[12px] text-ink-400">
                {items.loading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" /> 加载中
                  </span>
                ) : (
                  <>
                    共 <span className="font-mono text-ink-200">{items.data?.total ?? 0}</span> 条
                    {debounced && <span>，搜索「{debounced}」</span>}
                    {stats.data?.totals.blockRules ? (
                      <span className="ml-2 text-ink-500">（已应用 {stats.data.totals.blockRules} 条屏蔽规则）</span>
                    ) : null}
                  </>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <a
                  href={exportUrl}
                  className="inline-flex items-center gap-1 rounded-lg border border-ink-700 px-2.5 py-1 text-[11.5px] text-ink-300 hover:border-ink-600 hover:text-ink-100"
                  title="按当前筛选导出 Markdown"
                >
                  <Download size={12} /> 导出
                </a>
                <div className="flex items-center gap-0.5 rounded-lg border border-ink-700 p-0.5">
                  {(
                    [
                      { key: "card" as const, icon: LayoutGrid, label: "卡片" },
                      { key: "compact" as const, icon: List, label: "紧凑" },
                    ]
                  ).map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => setViewMode(v.key)}
                      className={
                        "rounded px-2 py-1 text-[11.5px] transition-colors " +
                        (viewMode === v.key ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200")
                      }
                      title={v.label + "视图"}
                    >
                      <v.icon size={12} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {items.error && (
              <div className="card mb-3 border-red-500/30 p-4 text-[13px] text-red-400">接口错误：{items.error}</div>
            )}

            {viewMode === "card" ? (
              <div className="space-y-2.5">
                {(items.data?.items ?? []).map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    sourceName={sourceName}
                    onPatch={patch}
                    onOpen={setDetail}
                    onQuickBlock={setQuickBlock}
                    onCopyCode={copyCode}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {(items.data?.items ?? []).map((item) => (
                  <CompactRow
                    key={item.id}
                    item={item}
                    sourceName={sourceName}
                    onPatch={patch}
                    onOpen={setDetail}
                    onQuickBlock={setQuickBlock}
                    onCopyCode={copyCode}
                  />
                ))}
              </div>
            )}

            {!items.loading && !items.data?.items.length && (
              <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
                <Radar size={26} className="text-ink-600" />
                <div className="text-[14px] text-ink-200">没有符合条件的资源</div>
                <p className="max-w-sm text-[12.5px] leading-relaxed text-ink-400">
                  试试放宽价格或时间筛选；也可能是屏蔽词把结果挡掉了，去「订阅与屏蔽」看看。
                </p>
              </div>
            )}
          </main>
        </div>
      )}

      {tab === "digest" && (
        <DigestPanel
          digests={digests.data?.digests ?? []}
          detail={digestDetail}
          pickedDate={pickedDate}
          onPickDate={setPickedDate}
          sourceName={sourceName}
          onPatch={patch}
          onOpen={setDetail}
          onQuickBlock={setQuickBlock}
          onCopyCode={copyCode}
        />
      )}

      {tab === "rules" && (
        <RulesPanel
          subscriptions={subs.data?.subscriptions ?? []}
          rules={blockRules.data?.rules ?? []}
          presets={blockRules.data?.presets ?? []}
          totalBlocked={blockRules.data?.totalBlocked ?? 0}
          sources={sources.data?.sources ?? []}
          blockedPreview={blockedPreview}
          sourceName={sourceName}
          onAddSub={addSubscription}
          onRemoveSub={removeSubscription}
          onJumpToSubscribed={(kw) => {
            setSearch(kw);
            setTab("feed");
          }}
          onAddRule={addRule}
          onImportPresets={async () => {
            await fetch("/api/block-rules", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ presets: true }),
            });
            blockRules.reload();
            items.reload();
            stats.reload();
            notify("已导入常见噪音屏蔽词");
          }}
          onToggleRule={async (id, enabled) => {
            await fetch("/api/block-rules/" + id, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ enabled }),
            });
            blockRules.reload();
            items.reload();
            setBlockedPreview(null);
          }}
          onDeleteRule={async (id) => {
            await fetch("/api/block-rules/" + id, { method: "DELETE" });
            blockRules.reload();
            items.reload();
            stats.reload();
            setBlockedPreview(null);
            notify("规则已删除，相关条目已恢复显示");
          }}
          onLoadBlockedPreview={async () => {
            const res = await fetch("/api/items?includeBlocked=1&limit=80&sort=newest");
            const data = (await res.json()) as { items: Item[] };
            setBlockedPreview(data.items);
          }}
        />
      )}
      {tab === "push" && (
        <PushPanel
          payload={push.data}
          preview={pushPreview}
          logs={pushLogs.data?.logs ?? []}
          onSave={async (patch: Partial<PushSettings>) => {
            const res = await fetch("/api/push", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(patch),
            });
            if (!res.ok) {
              notify("保存失败");
              return;
            }
            push.reload();
            setPushPreview(null);
          }}
          onPreview={async () => {
            const res = await fetch("/api/push/preview?limit=6");
            setPushPreview((await res.json()) as { instant: string[]; batch: string[]; queued: number });
          }}
          onFlush={async () => {
            const res = await fetch("/api/push/flush", { method: "POST" });
            const data = (await res.json().catch(() => ({}))) as { sent?: number; queued?: number };
            notify(`已发送 ${data.sent ?? 0} 条，队列剩 ${data.queued ?? 0} 条`);
            push.reload();
            pushLogs.reload();
            setPushPreview(null);
          }}
          onTest={async () => {
            const res = await fetch("/api/push/test", { method: "POST" });
            notify(res.ok ? "测试消息已发送" : "推送未启用或缺少凭据");
            pushLogs.reload();
          }}
        />
      )}
      {tab === "ops" && (
        <OpsPanel
          sources={sources.data?.sources ?? []}
          runs={runs.data?.runs ?? []}
          sourceName={sourceName}
          onCollectSource={async (id) => {
            notify("正在采集…");
            const res = await fetch(`/api/sources/${id}/collect`, { method: "POST" });
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
              summary?: { inserted: number; fetched: number; status: string };
            };
            if (!res.ok) notify(data.error ?? "采集失败");
            else notify(`完成：抓取 ${data.summary?.fetched ?? 0}，新增 ${data.summary?.inserted ?? 0}`);
            refreshAll();
          }}
          onToggleSource={async (id, enabled) => {
            await fetch("/api/sources/" + id, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ enabled }),
            });
            sources.reload();
            notify(enabled ? "已启用" : "已禁用");
          }}
          onChangeInterval={async (id, sec) => {
            await fetch("/api/sources/" + id, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ interval_sec: sec }),
            });
            sources.reload();
            notify("间隔已改为 " + formatInterval(sec));
          }}
          onAddRss={async (name, url, intervalSec) => {
            notify("正在添加并试采…");
            const res = await fetch("/api/sources", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name, url, intervalSec }),
            });
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
              summary?: { fetched: number; inserted: number; status: string; error?: string };
            };
            if (!res.ok) notify(data.error ?? "添加失败");
            else if (data.summary?.status === "failed") notify("已添加，但首次采集失败：" + (data.summary.error ?? ""));
            else notify(`已添加，抓取 ${data.summary?.fetched ?? 0} 条，新增 ${data.summary?.inserted ?? 0}`);
            refreshAll();
          }}
          onTestPush={async () => {
            const res = await fetch("/api/push/test", { method: "POST" });
            if (res.ok) notify("测试消息已发送到 Telegram");
            else notify("推送未启用或缺少凭据");
          }}
        />
      )}

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-4 text-[11px] text-ink-500">
        <span>freebie-radar · 本地优先 · SQLite</span>
        <span className="font-mono">
          {stats.data?.totals.total ?? 0} items · {stats.data?.totals.unread ?? 0} 未读
        </span>
      </footer>

      {detail && (
        <ItemDetail
          item={detail}
          sourceName={sourceName}
          onClose={() => setDetail(null)}
          onPatch={patch}
          onQuickBlock={setQuickBlock}
          onCopyCode={copyCode}
        />
      )}

      {quickBlock && (
        <QuickBlockModal
          item={quickBlock}
          sourceName={sourceName}
          onClose={() => setQuickBlock(null)}
          onIgnoreOne={(id) => patch(id, { status: "ignored" })}
          onAddRule={quickBlockAdd}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlignJustify,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  EyeOff,
  Lock,
  LayoutGrid,
  Loader2,
  Radar,
  RefreshCw,
  Search,
  ShieldBan,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Wrench,
  Zap,
} from "lucide-react";
import { CompactRow, ItemCard, ItemDetailDrawer, QuickBlockModal } from "./components/ItemView.tsx";
import { DigestPanel } from "./components/DigestPanel.tsx";
import { AiPanel } from "./components/AiPanel.tsx";
import { AdminGate } from "./components/AdminGate.tsx";
import { getToken } from "./lib/auth.ts";
import { RulesPanel } from "./components/RulesPanel.tsx";
import { OpsPanel } from "./components/OpsPanel.tsx";
import { PushPanel } from "./components/PushPanel.tsx";
import { CATEGORY_LABEL, OBTAIN_HINT, SOURCE_GROUPS, formatInterval, groupOfSource } from "./lib/sources.ts";
import type {
  BlockPreset,
  BlockRule,
  Item,
  PushLogItem,
  AiPayload,
  PushPayload,
  PushSettings,
  Run,
  Source,
  Stats,
  Subscription,
} from "./types.ts";

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

let SOURCE_NAMES: Record<string, string> = { ...SOURCE_LABEL };
const sourceName = (id: string) => SOURCE_NAMES[id] ?? SOURCE_LABEL[id] ?? id;

type Tab = "feed" | "digest" | "rules" | "push" | "ai" | "ops";

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

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-ink-200 bg-surface px-4 py-2.5 text-[13px] font-medium text-ink-900 shadow-lg">
      <Check size={14} className="text-deal" />
      {message}
    </div>
  );
}

type Preset = { key: string; label: string; icon: typeof Sparkles };

const PRESETS: Preset[] = [
  { key: "verified", label: "真福利精选", icon: Sparkles },
  { key: "free", label: "完全白嫖", icon: Tag },
  { key: "codes", label: "含兑换码", icon: Zap },
  { key: "urgent", label: "今日截止", icon: Bell },
  { key: "starred", label: "我的收藏", icon: Check },
  { key: "all", label: "全部收录", icon: AlignJustify },
  { key: "hidden", label: "已关闭", icon: EyeOff },
];

// 公开区：任何人不登录就能看。其余全部归管理区。
const PUBLIC_TABS = new Set<Tab>(["feed", "digest"]);
const ADMIN_TABS = new Set<Tab>(["rules", "push", "ai", "ops"]);

export function App() {
  const initialTab = (): Tab => {
    if (typeof location === "undefined") return "feed";
    const h = location.hash.replace("#", "");
    return h === "digest" || h === "rules" || h === "push" || h === "ai" || h === "ops" ? (h as Tab) : "feed";
  };

  const [tab, setTab] = useState<Tab>(initialTab);
  const [detail, setDetail] = useState<Item | null>(null);
  const [quickBlock, setQuickBlock] = useState<Item | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  // 服务端是否启用管理密码（决定是否拦截管理区）
  const [protectedMode, setProtectedMode] = useState(false);
  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((j: { protected?: boolean }) => setProtectedMode(Boolean(j.protected)))
      .catch(() => undefined);
  }, []);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("score");
  const [range, setRange] = useState("all");
  const [priceCap, setPriceCap] = useState("all");
  const [minScore, setMinScore] = useState("all");
  const [obtain, setObtain] = useState("");
  const [preset, setPreset] = useState("verified");
  const [viewMode, setViewMode] = useState<"compact" | "card">("compact");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [showAllSources, setShowAllSources] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1900);
  }, []);

  const copyCode = useCallback(
    (code: string) => {
      void navigator.clipboard?.writeText(code);
      notify("已复制兑换码 " + code);
    },
    [notify],
  );

  useEffect(() => {
    if (typeof location === "undefined") return;
    if (tab === "feed") history.replaceState(null, "", location.pathname + location.search);
    else history.replaceState(null, "", "#" + tab);
  }, [tab]);

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace("#", "");
      setTab(h === "digest" || h === "rules" || h === "push" || h === "ai" || h === "ops" ? (h as Tab) : "feed");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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
    if (preset === "verified") {
      // 真福利精选 = AI 判定是福利 + 没过截止时间 + 7 天内的新帖 + 排除抽奖/试用/推广
      p.set("unexpired", "1");
      p.set("maxAgeDays", "7");
      p.set("aiOnly", "1");
      p.set("obtain", "free");
    } else if (preset === "free") {
      p.set("unexpired", "1");
      p.set("maxAgeDays", "14");
      p.set("freeOnly", "1");
      p.set("obtain", "free");
    } else if (preset === "codes") {
      p.set("unexpired", "1");
      p.set("hasCodes", "1");
    } else if (preset === "urgent") {
      p.set("expiring", "1");
    } else if (preset === "starred") {
      p.set("starred", "1");
    } else if (preset === "hidden") {
      // 「已关闭」：纯手动隐藏的条目，可以在这里找回来
      p.set("status", "ignored");
    }
    if (preset === "all") p.set("hideRejected", "1");
    if (priceCap === "free") p.set("freeOnly", "1");
    else if (priceCap !== "all") p.set("maxPrice", priceCap);
    // 手动选获取方式时覆盖预设的默认值（预设已各自设好，这里只在用户主动切换时生效）
    if (obtain) p.set("obtain", obtain);
    if (minScore !== "all") p.set("minScore", minScore);
    if (unreadOnly) p.set("unread", "1");
    const DAYS: Record<string, number> = { "1d": 1, "3d": 3, "7d": 7, "30d": 30 };
    const days = DAYS[range];
    if (days) p.set("since", new Date(Date.now() - days * 86_400_000).toISOString());
    p.set("limit", "100");
    return p.toString();
  }, [debounced, source, category, sort, range, priceCap, preset, obtain, minScore, unreadOnly]);
  // 已启用的筛选条件数（用于「清除 N」）与一键重置
  const activeFilterCount =
    [source, category, debounced, minScore !== "all", unreadOnly, priceCap !== "all", obtain, range !== "all"].filter(
      Boolean,
    ).length;
  const resetFilters = useCallback(() => {
    setSource("");
    setCategory("");
    setSearch("");
    setDebounced("");
    setMinScore("all");
    setUnreadOnly(false);
    setPriceCap("all");
    setObtain("");
    setRange("all");
    setPreset("verified");
  }, []);
  const stats = useApi<Stats>("/api/stats");
  const items = useApi<{ total: number; items: Item[] }>(`/api/items?${query}`);
  const subs = useApi<{ subscriptions: Subscription[] }>("/api/subscriptions");
  const sources = useApi<{ sources: Source[] }>("/api/sources");
  const runs = useApi<{ runs: Run[] }>(getToken() ? "/api/runs?limit=40" : null);
  const blockRules = useApi<{ rules: BlockRule[]; totalBlocked: number; presets: BlockPreset[] }>(
    getToken() ? "/api/block-rules" : null,
  );
  const digests = useApi<{ digests: { date: string; created_at: string; pushed_at: string | null }[] }>("/api/digests");
  // 管理接口只在已登录时请求，避免公开区刷出一堆 401
  const push = useApi<PushPayload>(getToken() ? "/api/push" : null);
  const ai = useApi<AiPayload>(tab === "ai" ? "/api/ai" : null);
  const pushLogs = useApi<{ logs: PushLogItem[] }>(tab === "push" ? "/api/push/log?limit=40" : null);
  const [pushPreview, setPushPreview] = useState<{
    instant: string[];
    batch: string[];
    queued: number;
    scanned?: number;
    matched?: number;
  } | null>(null);

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

  const visible = items.data?.items ?? [];
  const currentIndex = detail ? visible.findIndex((i) => i.id === detail.id) : -1;

  const enabledSources = (sources.data?.sources ?? []).filter((s) => s.enabled || showAllSources);
  const grouped = SOURCE_GROUPS.map((g) => ({
    ...g,
    sources: enabledSources.filter((s) => groupOfSource(s) === g.key),
  })).filter((g) => g.sources.length > 0);

  const authed = Boolean(getToken());
  // 公开区只显示「资源流 / 每日精选」，其余 Tab 只有进管理区后才出现
  const tabs: { key: Tab | "admin"; label: string; icon: typeof Activity; badge?: number }[] = [
    { key: "feed", label: "资源流", icon: Activity },
    { key: "digest", label: "每日精选", icon: Radar },
    ...(authed
      ? [
          { key: "rules" as Tab, label: "订阅与屏蔽", icon: ShieldBan, badge: stats.data?.totals.blockRules },
          { key: "push" as Tab, label: "推送规则", icon: Zap, badge: push.data?.stats.queued },
          { key: "ai" as Tab, label: "AI 引擎", icon: Bot },
          { key: "ops" as Tab, label: "数据源运维", icon: Wrench },
        ]
      : [{ key: "admin" as const, label: "管理区", icon: Lock }]),
  ];

  const handleTab = (key: Tab | "admin") => {
    if (key === "admin") {
      setTab("admin" as Tab);
      return;
    }
    setTab(key);
  };


  const exportUrl = "/api/export?format=md&" + query.replace(/limit=\d+/, "limit=300");

  return (
    <div className="flex min-h-screen flex-col">
      {/* 顶部固定命令栏 */}
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-4 px-6 py-3">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white shadow-sm">
              <Radar size={19} />
            </div>
            <div className="leading-tight">
              <h1 className="text-[15px] font-semibold tracking-tight text-ink-950">白嫖雷达</h1>
              <p className="text-[11px] text-ink-500">自动聚合 + AI 验真</p>
            </div>
          </div>

          <div className="relative min-w-[280px] flex-1">
            <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索福利资源（按 Enter 即时筛选）…"
              className="w-full rounded-xl border border-ink-200 bg-canvas py-2 pr-3 pl-9 text-[13.5px] text-ink-950 transition-colors outline-none placeholder:text-ink-400 focus:border-brand focus:bg-surface"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="mr-1 hidden items-center gap-3 border-r border-ink-200 pr-3 text-[12px] lg:flex">
              <div className="text-center">
                <span className="block font-mono text-[14px] leading-tight font-semibold tabular-nums text-ink-950">
                  {stats.data?.totals.aiKept ?? "—"}
                </span>
                <span className="text-ink-500">真福利</span>
              </div>
              <div className="text-center">
                <span className="block font-mono text-[14px] leading-tight font-semibold tabular-nums text-ink-950">
                  {stats.data?.totals.last24h ?? "—"}
                </span>
                <span className="text-ink-500">24h 新增</span>
              </div>
              <div className="text-center">
                <span className="block font-mono text-[14px] leading-tight font-semibold tabular-nums text-ink-950">
                  {stats.data?.totals.withCodes ?? "—"}
                </span>
                <span className="text-ink-500">含码</span>
              </div>
            </div>

            <a
              href={exportUrl}
              className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-700 transition-colors hover:bg-ink-100"
              title="按当前筛选导出 Markdown"
            >
              <Download size={13} /> 导出
            </a>
            <button
              type="button"
              onClick={refreshAll}
              className="rounded-xl border border-ink-200 bg-surface p-2 text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
              title="刷新数据"
            >
              <RefreshCw size={15} className={items.loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1560px] flex-1 flex-col gap-5 px-6 py-5 lg:flex-row">
        {/* 左侧导航与筛选坞 */}
        <aside className="w-full shrink-0 space-y-4 lg:w-[248px]">
          <nav className="space-y-0.5">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => handleTab(t.key)}
                className={
                  "flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] font-medium transition-colors " +
                  (tab === t.key
                    ? "bg-brand text-white shadow-sm"
                    : "text-ink-600 hover:bg-surface hover:text-ink-950")
                }
              >
                <span className="flex items-center gap-2">
                  <t.icon size={15} />
                  {t.label}
                </span>
                {typeof t.badge === "number" && t.badge > 0 && (
                  <span
                    className={
                      "rounded-md px-1.5 py-0.5 font-mono text-[11px] " +
                      (tab === t.key ? "bg-white/25 text-white" : "bg-ink-200 text-ink-700")
                    }
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {tab === "feed" && (
            <>
              <div className="panel p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">快速筛选</span>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-brand hover:underline"
                      title="清除全部筛选条件"
                    >
                      <RotateCcw size={11} /> 清除 {activeFilterCount}
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPreset(p.key)}
                      className={
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-medium transition-colors " +
                        (preset === p.key
                          ? "bg-brand-subtle text-brand"
                          : "text-ink-600 hover:bg-surface-hover hover:text-ink-900")
                      }
                    >
                      <p.icon size={13} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel p-3">
                <div className="mb-2 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">价格上限</div>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { k: "all", label: "不限" },
                    { k: "free", label: "白嫖" },
                    { k: "5", label: "≤5 元" },
                    { k: "10", label: "≤10 元" },
                    { k: "30", label: "≤30 元" },
                    { k: "100", label: "≤100 元" },
                  ].map((o) => (
                    <button
                      key={o.k}
                      type="button"
                      onClick={() => setPriceCap(o.k)}
                      className={
                        "rounded-lg border py-1.5 text-[12px] font-medium transition-colors " +
                        (priceCap === o.k
                          ? "border-brand bg-brand text-white"
                          : "border-ink-200 bg-surface text-ink-600 hover:bg-ink-100")
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-ink-500">
                  在库白嫖 <span className="font-mono font-medium text-deal">{stats.data?.price?.free ?? 0}</span> · ≤5 元{" "}
                  <span className="font-mono font-medium">{stats.data?.price?.under5 ?? 0}</span>
                </div>
              </div>

              <div className="panel p-3">
                <div className="mb-2 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">获取方式</div>
                <div className="flex flex-wrap gap-1">
                  {[
                    { k: "", label: "不限" },
                    { k: "free", label: "直接白嫖" },
                    { k: "conditional", label: "有条件" },
                    { k: "lottery", label: "抽奖" },
                    { k: "trial", label: "试用" },
                    { k: "promo", label: "推广" },
                  ].map((o) => (
                    <button
                      key={o.k || "any"}
                      type="button"
                      onClick={() => setObtain(o.k)}
                      title={OBTAIN_HINT[o.k] ?? "不限制获取方式"}
                      className={
                        "rounded-lg border px-2 py-1 text-[11.5px] font-medium transition-colors " +
                        (obtain === o.k
                          ? "border-brand bg-brand text-white"
                          : "border-ink-200 bg-surface text-ink-600 hover:bg-ink-100")
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-[11px] leading-relaxed text-ink-500">
                  抽奖 / 试用 / 推广不算完全白嫖，默认已从「真福利精选」和推送里隔离
                </div>
              </div>

              <div className="panel p-3">
                <div className="mb-2 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">排序</div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 bg-surface px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-brand"
                >
                  <option value="score">综合评分</option>
                  <option value="newest">最新发布</option>
                  <option value="oldest">最早发布</option>
                  <option value="expiring">截止时间最近</option>
                  <option value="price_asc">价格从低到高</option>
                </select>
              </div>

              <div className="panel space-y-3 p-3">
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">最低评分</div>
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { k: "all", label: "不限" },
                      { k: "50", label: "≥50" },
                      { k: "60", label: "≥60" },
                      { k: "70", label: "≥70" },
                    ].map((o) => (
                      <button
                        key={o.k}
                        type="button"
                        onClick={() => setMinScore(o.k)}
                        className={
                          "rounded-lg border py-1 text-[12px] font-medium transition-colors " +
                          (minScore === o.k
                            ? "border-brand bg-brand text-white"
                            : "border-ink-200 bg-surface text-ink-600 hover:bg-ink-100")
                        }
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <label className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ink-600">
                    <input
                      type="checkbox"
                      checked={unreadOnly}
                      onChange={(e) => setUnreadOnly(e.target.checked)}
                      className="h-3.5 w-3.5 accent-brand"
                    />
                    只看未读
                  </label>
                </div>
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">分类</div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setCategory("")}
                        className={
                          "rounded-md border px-2 py-0.5 text-[12px] transition-colors " +
                          (category === ""
                            ? "border-brand bg-brand-subtle font-medium text-brand"
                            : "border-ink-200 text-ink-600 hover:bg-ink-100")
                        }
                      >
                        全部
                      </button>
                      {(stats.data?.byCategory ?? []).map((c) => (
                        <button
                          key={c.category ?? "other"}
                          type="button"
                          onClick={() => setCategory(category === (c.category ?? "") ? "" : (c.category ?? ""))}
                          className={
                            "rounded-md border px-2 py-0.5 text-[12px] transition-colors " +
                            (category === (c.category ?? "")
                              ? "border-brand bg-brand-subtle font-medium text-brand"
                              : "border-ink-200 text-ink-600 hover:bg-ink-100")
                          }
                        >
                          {CATEGORY_LABEL[c.category ?? "other"] ?? c.category}({c.n})
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-ink-500">发布时间</span>
                      <select
                        value={range}
                        onChange={(e) => setRange(e.target.value)}
                        className="w-full rounded-lg border border-ink-200 bg-surface px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-brand"
                      >
                        <option value="all">不限</option>
                        <option value="1d">24 小时内</option>
                        <option value="3d">3 天内</option>
                        <option value="7d">一周内</option>
                        <option value="30d">一个月内</option>
                      </select>
                    </label>
                  </div>
              </div>

              <div className="panel p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">数据源</span>
                  <button
                    type="button"
                    onClick={() => setShowAllSources((v) => !v)}
                    className="text-[11px] text-ink-400 hover:text-brand"
                  >
                    {showAllSources ? "隐藏禁用" : "显示全部"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setSource("")}
                  className={
                    "mb-1 w-full rounded-lg px-2 py-1 text-left text-[12px] font-medium transition-colors " +
                    (source === "" ? "bg-brand-subtle text-brand" : "text-ink-600 hover:bg-surface-hover")
                  }
                >
                  全部来源
                </button>
                {grouped.map((g) => {
                  const collapsed = collapsedGroups[g.key];
                  const total = g.sources.reduce((n, s) => n + s.items, 0);
                  return (
                    <div key={g.key} className="mb-1">
                      <button
                        type="button"
                        onClick={() => setCollapsedGroups((m) => ({ ...m, [g.key]: !m[g.key] }))}
                        className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-[11px] font-medium tracking-wide text-ink-400 uppercase hover:text-ink-700"
                      >
                        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
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
                              className={
                                "flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[12px] transition-colors " +
                                (source === s.id
                                  ? "bg-brand-subtle font-medium text-brand"
                                  : "text-ink-600 hover:bg-surface-hover") +
                                (s.enabled ? "" : " opacity-45")
                              }
                              title={s.id + " · 采集周期 " + formatInterval(s.interval_sec)}
                            >
                              <span className="truncate">{s.name}</span>
                              <span className="ml-1.5 shrink-0 font-mono text-[11px] text-ink-400">{s.items}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </aside>

        {/* 主内容区 */}
        <main className="min-w-0 flex-1">
          {(tab as string) === "admin" && (
            <AdminGate protectedMode={protectedMode}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { key: "rules" as Tab, label: "订阅与屏蔽", desc: "关键词订阅、屏蔽词防火墙", icon: ShieldBan },
                  { key: "push" as Tab, label: "推送规则", desc: "阈值、静默时段、语言与去重", icon: Zap },
                  { key: "ai" as Tab, label: "AI 引擎", desc: "二审模型、提示词、判定统计", icon: Bot },
                  { key: "ops" as Tab, label: "数据源运维", desc: "采集开关、间隔、数据清理", icon: Wrench },
                ].map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setTab(entry.key)}
                    className="panel flex flex-col items-start gap-1.5 p-4 text-left transition-colors hover:border-brand"
                  >
                    <entry.icon size={16} className="text-brand" />
                    <span className="text-[13.5px] font-semibold text-ink-900">{entry.label}</span>
                    <span className="text-[11.5px] leading-relaxed text-ink-500">{entry.desc}</span>
                  </button>
                ))}
              </div>
            </AdminGate>
          )}

          {tab === "feed" && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-500">
                  {items.loading ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" /> 正在加载…
                    </span>
                  ) : (
                    <>
                      <span>
                        共 <span className="font-mono font-semibold text-ink-900">{items.data?.total ?? 0}</span> 条
                      </span>
                      {preset === "verified" && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-deal-subtle px-2 py-0.5 font-medium text-deal">
                          <Sparkles size={10} /> AI 验真福利
                        </span>
                      )}
                      {debounced && <span className="rounded-md bg-ink-100 px-2 py-0.5">搜索：{debounced}</span>}
                      {(stats.data?.totals.aiRejected ?? 0) > 0 && (
                        <span className="text-ink-400">· 已自动隐藏 {stats.data?.totals.aiRejected} 条非福利内容</span>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center gap-0.5 rounded-lg border border-ink-200 bg-surface p-0.5">
                  {[
                    { key: "compact" as const, icon: AlignJustify, label: "紧凑列表" },
                    { key: "card" as const, icon: LayoutGrid, label: "卡片视图" },
                  ].map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => setViewMode(v.key)}
                      className={
                        "rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors " +
                        (viewMode === v.key ? "bg-brand text-white shadow-sm" : "text-ink-500 hover:text-ink-900")
                      }
                      title={v.label}
                    >
                      <v.icon size={13} />
                    </button>
                  ))}
                </div>
              </div>

              {items.error && (
                <div className="panel mb-3 border-alert-border bg-alert-subtle p-4 text-[13px] text-alert">
                  加载失败：{items.error}
                </div>
              )}

              {viewMode === "compact" ? (
                <div className="panel overflow-hidden">
                  {visible.map((item) => (
                    <CompactRow
                      key={item.id}
                      item={item}
                      sourceName={sourceName}
                      selected={detail?.id === item.id}
                      onPatch={patch}
                      onOpen={setDetail}
                      onQuickBlock={setQuickBlock}
                      onCopyCode={copyCode}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {visible.map((item) => (
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
              )}

              {!items.loading && !visible.length && (
                <div className="panel flex flex-col items-center gap-3 px-6 py-20 text-center">
                  <Radar size={30} className="text-ink-300" />
                  <div className="text-[15px] font-medium text-ink-900">当前条件下没有福利资源</div>
                  <p className="max-w-md text-[12.5px] leading-relaxed text-ink-500">
                    试试把「快速筛选」切到「全部收录」，或放宽价格上限；也可能是屏蔽词把结果挡掉了。
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPreset("all");
                      setPriceCap("all");
                      setCategory("");
                      setSource("");
                    }}
                    className="mt-1 rounded-xl bg-brand px-4 py-2 text-[12.5px] font-medium text-white hover:bg-brand-hover"
                  >
                    清除全部筛选
                  </button>
                </div>
              )}
            </>
          )}

          {tab === "digest" && (
            <DigestPanel
              digests={digests.data?.digests ?? []}
              detail={digestDetail}
              pickedDate={pickedDate}
              onPickDate={setPickedDate}
              onRunDaily={async () => {
                notify("正在生成今日精选…");
                const res = await fetch("/api/digests/run", { method: "POST" });
                const data = (await res.json().catch(() => ({}))) as { count?: number; error?: string };
                if (!res.ok) notify(data.error ?? "生成失败");
                else notify(`已生成 ${data.count ?? 0} 条精选`);
                digests.reload();
                setPickedDate(null);
                digestDetail.reload();
              }}
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
                setPreset("all");
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
              onSave={async (p: Partial<PushSettings>) => {
                const res = await fetch("/api/push", {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(p),
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
                setPushPreview(
                  (await res.json()) as { instant: string[]; batch: string[]; queued: number; scanned?: number; matched?: number },
                );
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
                notify(res.ok ? "测试消息已发送到 Telegram" : "推送未启用或缺少凭据");
                pushLogs.reload();
              }}
            />
          )}

          {tab === "ai" && <AiPanel data={ai.data} reload={ai.reload} />}
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
                notify(enabled ? "已启用该源" : "已禁用该源");
              }}
              onChangeInterval={async (id, sec) => {
                await fetch("/api/sources/" + id, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ interval_sec: sec }),
                });
                sources.reload();
                notify("采集周期已改为 " + formatInterval(sec));
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
                notify(res.ok ? "测试消息已发送" : "推送未启用或缺少凭据");
              }}
            />
          )}
        </main>
      </div>

      <footer className="mx-auto flex w-full max-w-[1560px] flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-6 py-4 text-[12px] text-ink-500">
        <span>白嫖雷达 · 自动多源聚合 · AI 语义验真 · 所筛即所推</span>
        <span className="font-mono">
          {stats.data?.totals.active ?? 0} 条在库 · {stats.data?.totals.unread ?? 0} 条未读
        </span>
      </footer>

      {detail && (
        <ItemDetailDrawer
          item={detail}
          sourceName={sourceName}
          hasPrev={currentIndex > 0}
          hasNext={currentIndex >= 0 && currentIndex < visible.length - 1}
          onPrev={() => currentIndex > 0 && setDetail(visible[currentIndex - 1] ?? null)}
          onNext={() => currentIndex >= 0 && currentIndex < visible.length - 1 && setDetail(visible[currentIndex + 1] ?? null)}
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

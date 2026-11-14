import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  X,
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
import { CATEGORY_LABEL, OBTAIN_HINT, OBTAIN_LABEL, SOURCE_GROUPS, formatInterval, groupOfSource } from "./lib/sources.ts";
import type {
  BlockPreset,
  BlockRule,
  Item,
  PushLogItem,
  AiPayload,
  PushPayload,
  PushPreview,
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
  "openrouter-free": "OpenRouter · 新免费大模型",
  "gamerpower-loot": "GamerPower · 免费礼包与 Key",
  "rss-itch-free": "itch.io · 100% 限免游戏",
  "rss-freesteamkeys": "FreeSteamKeys · Steam 限免",
  "rss-ghxi": "果核剥壳 · 免费软件",
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
    if (!url) {
      setLoading(false);
      return;
    }
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
    <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-ink-800 bg-ink-950 px-3.5 py-2 text-[12.5px] font-medium text-white shadow-lg">
      <Check size={14} className="text-emerald-400" />
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
  // 合并组展开：记录展开的条目 id 与其同福利的其他来源
  const [relatedOpen, setRelatedOpen] = useState<number | null>(null);
  const [relatedMap, setRelatedMap] = useState<Record<number, (Item & { sourceName?: string })[]>>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  // 展开合并组时按需拉取其他来源报道（同一 title_key 的兄弟条目）
  useEffect(() => {
    const id = relatedOpen;
    if (!id || relatedMap[id]) return;
    let alive = true;
    fetch(`/api/items/${id}/related`, { headers: { accept: "application/json" } })
      .then((r) => r.json())
      .then((d: { items?: (Item & { sourceName?: string })[] }) => {
        if (alive && Array.isArray(d.items)) setRelatedMap((m) => ({ ...m, [id]: d.items! }));
      })
      .catch(() => {
        if (alive) setRelatedMap((m) => ({ ...m, [id]: [] }));
      });
    return () => {
      alive = false;
    };
  }, [relatedOpen, relatedMap]);
  // 服务端是否启用管理密码（决定是否拦截管理区）
  const [authChecked, setAuthChecked] = useState(false);
  const [protectedMode, setProtectedMode] = useState(false);
  const [adminAuthed, setAdminAuthed] = useState(() => Boolean(getToken()));
  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((j: { protected?: boolean }) => {
        const prot = Boolean(j.protected);
        setProtectedMode(prot);
        if (!prot) setAdminAuthed(true);
      })
      .catch(() => undefined)
      .finally(() => setAuthChecked(true));
  }, []);
  const adminReady = authChecked && (!protectedMode || adminAuthed);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [source, setSource] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [catOpen, setCatOpen] = useState(false);
  const catRef = useRef<HTMLDivElement | null>(null);
  const [lang, setLang] = useState<"all" | "zh" | "en">("all");
  const [sort, setSort] = useState("score");
  const [range, setRange] = useState("auto");
  const [priceCap, setPriceCap] = useState("auto");
  const [minScore, setMinScore] = useState("all");
  const [obtain, setObtain] = useState("auto");
  const [preset, setPreset] = useState("verified");
  const [viewMode, setViewMode] = useState<"compact" | "card">("compact");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [showAllSources, setShowAllSources] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  /** 移动端：侧栏「筛选与数据源」展开态与顶部筛选栏展开态 */
  const [mobileFilters, setMobileFilters] = useState(false);
  const [mobileFilterBar, setMobileFilterBar] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onSlash = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);
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

  useEffect(() => {
    if (typeof location === "undefined") return;
    const sp = new URLSearchParams(location.search);
    const site = sp.get("login_ok");
    if (!site) return;
    sp.delete("login_ok");
    const nextSearch = sp.toString();
    history.replaceState(null, "", location.pathname + (nextSearch ? "?" + nextSearch : "") + "#ops");
    setTab("ops");
    notify(`已完成 ${site} 登录并回传公开福利（Cookie 仅留本机）`);
  }, [notify]);

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

  useEffect(() => {
    if (!catOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (catRef.current && !catRef.current.contains(e.target as Node)) setCatOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [catOpen]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("search", debounced);
    if (source) p.set("source", source);
    if (categories.length) p.set("category", categories.join(","));
    if (lang !== "all") p.set("lang", lang);
    if (sort) p.set("sort", sort);

    if (preset === "verified") {
      p.set("unexpired", "1");
      p.set("aiOnly", "1");
      if (range === "auto") p.set("maxAgeDays", "7");
      if (obtain === "auto") p.set("obtain", "free,conditional");
    } else if (preset === "free") {
      p.set("unexpired", "1");
      if (range === "auto") p.set("maxAgeDays", "14");
      if (priceCap === "auto") p.set("freeOnly", "1");
      if (obtain === "auto") p.set("obtain", "free");
    } else if (preset === "codes") {
      p.set("unexpired", "1");
      p.set("hasCodes", "1");
    } else if (preset === "urgent") {
      p.set("expiring", "1");
    } else if (preset === "starred") {
      p.set("starred", "1");
    } else if (preset === "hidden") {
      p.set("status", "ignored");
    }
    if (preset === "all") p.set("hideRejected", "1");

    if (priceCap === "free") p.set("freeOnly", "1");
    else if (priceCap !== "auto" && priceCap !== "all") p.set("maxPrice", priceCap);

    if (obtain !== "auto" && obtain !== "all" && obtain) p.set("obtain", obtain);
    if (minScore !== "all") p.set("minScore", minScore);
    if (unreadOnly) p.set("unread", "1");

    const DAYS: Record<string, number> = { "1d": 1, "3d": 3, "7d": 7, "30d": 30 };
    const days = DAYS[range];
    if (days) p.set("since", new Date(Date.now() - days * 86_400_000).toISOString());
    p.set("limit", "100");
    return p.toString();
  }, [debounced, source, categories, lang, sort, range, priceCap, preset, obtain, minScore, unreadOnly]);

  const activeFilterCount =
    [
      source,
      categories.length > 0,
      lang !== "all",
      debounced,
      minScore !== "all",
      unreadOnly,
      priceCap !== "auto",
      obtain !== "auto",
      range !== "auto",
      sort !== "score",
    ].filter(Boolean).length;

  const resetFilters = useCallback(() => {
    setSource("");
    setCategories([]);
    setLang("all");
    setSearch("");
    setDebounced("");
    setMinScore("all");
    setUnreadOnly(false);
    setPriceCap("auto");
    setObtain("auto");
    setRange("auto");
    setSort("score");
    setPreset("verified");
  }, []);
  const stats = useApi<Stats>("/api/stats");
  const items = useApi<{ total: number; items: Item[] }>(`/api/items?${query}`);
  const subs = useApi<{ subscriptions: Subscription[] }>(adminReady ? "/api/subscriptions" : null);
  const sources = useApi<{ sources: Source[] }>("/api/sources");
  const runs = useApi<{ runs: Run[] }>(adminReady ? "/api/runs?limit=40" : null);
  const blockRules = useApi<{ rules: BlockRule[]; totalBlocked: number; presets: BlockPreset[] }>(
    adminReady ? "/api/block-rules" : null,
  );
  const digests = useApi<{ digests: { date: string; created_at: string; pushed_at: string | null }[] }>("/api/digests");
  // 管理接口只在就绪后请求，避免公开区刷出一堆 401，也避免无密码模式卡住加载
  const push = useApi<PushPayload>(adminReady ? "/api/push" : null);
  const ai = useApi<AiPayload>(adminReady && tab === "ai" ? "/api/ai" : null);
  const pushLogs = useApi<{ logs: PushLogItem[] }>(adminReady && tab === "push" ? "/api/push/log?limit=40" : null);
  const [pushPreview, setPushPreview] = useState<PushPreview | null>(null);
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
      setRelatedMap({});
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
    setRelatedMap({});
  }, [items, stats, sources, runs, blockRules]);

  const visible = items.data?.items ?? [];
  const currentIndex = detail ? visible.findIndex((i) => i.id === detail.id) : -1;

  const enabledSources = (sources.data?.sources ?? []).filter((s) => s.enabled || showAllSources);
  const grouped = SOURCE_GROUPS.map((g) => ({
    ...g,
    sources: enabledSources.filter((s) => groupOfSource(s) === g.key),
  })).filter((g) => g.sources.length > 0);

  // 公开区只显示「资源流 / 每日精选」，其余 Tab 只有进管理区后才出现
  const tabs: { key: Tab | "admin"; label: string; icon: typeof Activity; badge?: number }[] = [
    { key: "feed", label: "资源流", icon: Activity },
    { key: "digest", label: "每日精选", icon: Radar },
    ...(adminReady
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
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      {/* 左侧连续导轨（移动端为顶部收拢区） */}
      <aside className="w-full shrink-0 border-b border-ink-200 bg-canvas/70 px-3.5 py-3 lg:flex lg:w-[240px] lg:flex-col lg:gap-4 lg:border-r lg:border-b-0 lg:bg-canvas lg:px-3 lg:py-4">
        {/* 品牌行 + 移动端快捷导出/刷新 */}
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <h1 className="text-[14.5px] font-semibold tracking-tight text-ink-950">白嫖雷达</h1>
          </div>
          <span className="hidden font-mono text-[11px] tabular-nums text-ink-400 lg:inline">
            {stats.data?.totals.aiKept ?? "—"} 精选
          </span>
          <div className="flex items-center gap-1.5 lg:hidden">
            <a
              href={exportUrl}
              className="rounded-md border border-ink-200 bg-surface p-2 text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-950"
              title="按当前筛选导出 Markdown"
            >
              <Download size={14} />
            </a>
            <button
              type="button"
              onClick={refreshAll}
              className="rounded-md border border-ink-200 bg-surface p-2 text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-950"
              title="刷新数据"
            >
              <RefreshCw size={14} className={items.loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* 搜索框（/ 快捷键聚焦） */}
        <div className="relative mt-2.5 lg:mt-0">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-400" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (search) {
                  setSearch("");
                  setDebounced("");
                } else {
                  e.currentTarget.blur();
                }
              }
            }}
            placeholder="搜索福利、兑换码…"
            className="h-8 w-full rounded-md border border-ink-200 bg-surface pr-8 pl-8 text-[12.5px] text-ink-950 transition-colors outline-none placeholder:text-ink-400 focus:border-accent"
          />
          {search ? (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setDebounced("");
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              title="清空搜索"
            >
              <X size={12} />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-ink-200 bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-ink-400 lg:inline">
              /
            </kbd>
          )}
        </div>

        {/* 导航：手机横向可滚，桌面纵列无边框 */}
        <nav className="-mx-3.5 mt-2.5 flex gap-1 overflow-x-auto px-3.5 pb-0.5 lg:mx-0 lg:mt-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
          {tabs.slice(0, 2).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTab(t.key)}
              className={
                "flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors lg:w-full " +
                (tab === t.key
                  ? "bg-ink-950 text-white lg:bg-canvas-subtle lg:font-semibold lg:text-ink-950"
                  : "text-ink-600 hover:bg-canvas-subtle/70 hover:text-ink-950")
              }
            >
              <span className="flex items-center gap-2">
                <t.icon size={14} className={tab === t.key ? "lg:text-accent" : "text-ink-400"} />
                {t.label}
              </span>
              {t.key === "feed" && (stats.data?.totals.unread ?? 0) > 0 && (
                <span
                  className={
                    "hidden font-mono text-[11px] tabular-nums lg:inline " +
                    (tab === t.key ? "text-ink-600" : "text-ink-400")
                  }
                >
                  {stats.data?.totals.unread}
                </span>
              )}
            </button>
          ))}
          <div className="mx-1 h-4 w-px shrink-0 self-center bg-ink-200 lg:hidden" />
          <div className="hidden px-2.5 pt-3 pb-1 text-[11px] font-medium text-ink-400 lg:block">
            管理
          </div>
          {tabs.slice(2).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTab(t.key)}
              className={
                "flex shrink-0 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors lg:w-full " +
                (tab === t.key
                  ? "bg-ink-950 text-white lg:bg-canvas-subtle lg:font-semibold lg:text-ink-950"
                  : "text-ink-600 hover:bg-canvas-subtle/70 hover:text-ink-950")
              }
            >
              <span className="flex items-center gap-2">
                <t.icon size={14} className={tab === t.key ? "lg:text-accent" : "text-ink-400"} />
                {t.label}
              </span>
              {typeof t.badge === "number" && t.badge > 0 && (
                <span
                  className={
                    "rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums " +
                    (tab === t.key
                      ? "bg-white/20 text-white lg:bg-surface lg:text-ink-700"
                      : "bg-ink-200/80 text-ink-600")
                  }
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* 场景预设 & 数据源（仅资源流 tab，手机默认折叠） */}
        {tab === "feed" && (
          <div className="mt-2.5 lg:mt-0 lg:flex lg:flex-col lg:gap-4">
            <button
              type="button"
              onClick={() => setMobileFilters((v) => !v)}
              className="flex w-full items-center justify-between rounded-md border border-ink-200 bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-700 transition-colors hover:border-ink-300 lg:hidden"
            >
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal size={13} /> 场景与数据源
              </span>
              <ChevronDown
                size={14}
                className={"text-ink-400 transition-transform " + (mobileFilters ? "rotate-180" : "")}
              />
            </button>

            <div className={mobileFilters ? "mt-2.5 space-y-4 lg:mt-0" : "hidden space-y-4 lg:block"}>
              {/* 快速筛选 */}
              <div className="border-t border-ink-200 pt-3">
                <div className="mb-1.5 flex items-center justify-between px-2">
                  <span className="text-[11px] font-medium text-ink-400">常用场景</span>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
                      title="清除全部筛选条件"
                    >
                      <RotateCcw size={10} /> 清除 {activeFilterCount}
                    </button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPreset(p.key)}
                      className={
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors " +
                        (preset === p.key
                          ? "bg-canvas-subtle font-semibold text-ink-950"
                          : "font-medium text-ink-600 hover:bg-canvas-subtle/60 hover:text-ink-950")
                      }
                    >
                      <p.icon size={13} className={preset === p.key ? "text-accent" : "text-ink-400"} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 数据源树 */}
              <div className="border-t border-ink-200 pt-3">
                <div className="mb-1.5 flex items-center justify-between px-2">
                  <span className="text-[11px] font-medium text-ink-400">数据源</span>
                  <button
                    type="button"
                    onClick={() => setShowAllSources((v) => !v)}
                    className="text-[11px] text-ink-400 hover:text-ink-700"
                  >
                    {showAllSources ? "隐藏禁用" : "显示全部"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setSource("")}
                  className={
                    "mb-1 w-full rounded-md px-2.5 py-1 text-left text-[12px] transition-colors " +
                    (source === ""
                      ? "bg-canvas-subtle font-semibold text-ink-950"
                      : "font-medium text-ink-600 hover:bg-canvas-subtle/60")
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
                        className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-ink-400 hover:text-ink-700"
                      >
                        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                        <span className="flex-1 text-left">{g.label}</span>
                        <span className="font-mono tabular-nums">{total}</span>
                      </button>
                      {!collapsed && (
                        <div className="space-y-0.5">
                          {g.sources.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => setSource(s.id === source ? "" : s.id)}
                              className={
                                "flex w-full items-center justify-between rounded-md px-2.5 py-1 text-left text-[12px] transition-colors " +
                                (source === s.id
                                  ? "bg-canvas-subtle font-semibold text-ink-950"
                                  : "text-ink-600 hover:bg-canvas-subtle/60") +
                                (s.enabled ? "" : " opacity-45")
                              }
                              title={s.id + " · 采集周期 " + formatInterval(s.interval_sec)}
                            >
                              <span className="truncate">{s.name}</span>
                              <span className="ml-1.5 shrink-0 font-mono text-[11px] tabular-nums text-ink-400">{s.items}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* 右侧纯白主工作区 */}
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {/* 桌面 48px 顶栏 */}
        <header className="sticky top-0 z-20 hidden h-12 items-center justify-between gap-4 border-b border-ink-200 bg-surface/95 px-6 backdrop-blur-sm lg:flex">
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            {tab === "feed" ? (
              <div className="flex items-center gap-1">
                {PRESETS.slice(0, 5).map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPreset(p.key)}
                    className={
                      "rounded-full px-3 py-1 text-[12.5px] transition-colors " +
                      (preset === p.key
                        ? "bg-ink-950 font-medium text-white"
                        : "text-ink-600 hover:bg-ink-100 hover:text-ink-950")
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className="font-semibold text-ink-950">
                {tabs.find((t) => t.key === tab)?.label ?? "管理区"}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3 text-[12px] text-ink-500">
            <span className="font-mono tabular-nums">
              24h <strong className="font-semibold text-ink-900">+{stats.data?.totals.last24h ?? "—"}</strong>
            </span>
            <span className="text-ink-300" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              含码 <strong className="font-semibold text-ink-900">{stats.data?.totals.withCodes ?? "—"}</strong>
            </span>
            {(stats.data?.totals.aiRejected ?? 0) > 0 && (
              <>
                <span className="text-ink-300" aria-hidden="true">·</span>
                <span>已滤 {stats.data?.totals.aiRejected} 条水帖</span>
              </>
            )}
            <a
              href={exportUrl}
              className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-md border border-ink-200 bg-surface px-2.5 text-[12px] font-medium text-ink-700 transition-colors hover:bg-ink-100 hover:text-ink-950"
              title="按当前筛选导出 Markdown"
            >
              <Download size={12} /> 导出
            </a>
            <button
              type="button"
              onClick={refreshAll}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-ink-200 bg-surface text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-950"
              title="刷新数据"
            >
              <RefreshCw size={13} className={items.loading ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        {/* 主内容区 */}
        <main className={tab === "feed" ? "min-w-0 flex-1" : "min-w-0 flex-1 px-3.5 py-3.5 sm:px-6 sm:py-5"}>
          {((tab as string) === "admin" || (ADMIN_TABS.has(tab) && !adminReady)) && (
            <AdminGate protectedMode={protectedMode} onAuthChange={setAdminAuthed}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { key: "rules" as Tab, label: "订阅与屏蔽", desc: "关键词订阅、屏蔽词防火墙", icon: ShieldBan },
                  { key: "push" as Tab, label: "推送规则", desc: "推送时机、阈值、格式与免打扰", icon: Zap },
                  { key: "ai" as Tab, label: "AI 引擎", desc: "规则初筛、审核模型、提示词与补审", icon: Bot },
                  { key: "ops" as Tab, label: "数据源运维", desc: "采集开关、间隔、数据清理", icon: Wrench },
                ].map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setTab(entry.key)}
                    className="panel flex flex-col items-start gap-1.5 p-4 text-left transition-colors hover:border-ink-400"
                  >
                    <entry.icon size={16} className="text-accent" />
                    <span className="text-[13.5px] font-semibold text-ink-950">{entry.label}</span>
                    <span className="text-[12px] leading-relaxed text-ink-500">{entry.desc}</span>
                  </button>
                ))}
              </div>
            </AdminGate>
          )}

          {tab === "feed" && (
            <>
              {/* 移动端：筛选条件折叠按钮 + 视图切换 */}
              <div className="flex items-center gap-2 border-b border-ink-100 px-3.5 py-2 sm:hidden">
                <button
                  type="button"
                  onClick={() => setMobileFilterBar((v) => !v)}
                  className={
                    "flex flex-1 items-center justify-between rounded-md border px-3 py-2 text-[12.5px] font-medium transition-colors " +
                    (mobileFilterBar
                      ? "border-ink-950 bg-ink-950 text-white"
                      : "border-ink-200 bg-surface text-ink-700")
                  }
                >
                  <span className="flex items-center gap-1.5">
                    <SlidersHorizontal size={13} /> 筛选条件
                    {activeFilterCount > 0 && (
                      <span
                        className={
                          "rounded px-1.5 py-0.5 font-mono text-[10.5px] " +
                          (mobileFilterBar ? "bg-white/20 text-white" : "bg-ink-950 text-white")
                        }
                      >
                        {activeFilterCount}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    size={14}
                    className={"transition-transform " + (mobileFilterBar ? "rotate-180" : "")}
                  />
                </button>
                <div className="flex items-center gap-0.5 rounded-md border border-ink-200 bg-surface p-0.5">
                  {[
                    { key: "compact" as const, icon: AlignJustify, label: "紧凑列表" },
                    { key: "card" as const, icon: LayoutGrid, label: "卡片视图" },
                  ].map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => setViewMode(v.key)}
                      className={
                        "rounded px-2 py-1.5 text-[12px] font-medium transition-colors " +
                        (viewMode === v.key ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-950")
                      }
                      title={v.label}
                    >
                      <v.icon size={13} />
                    </button>
                  ))}
                </div>
              </div>

              {/* 40px 细线筛选条 */}
              <div
                className={
                  "border-b border-ink-200 bg-[#FCFCFD] px-3.5 py-2.5 sm:px-6 sm:py-2 " +
                  (mobileFilterBar ? "block" : "hidden sm:block")
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  {/* 分类多选浮层 */}
                  <div className="relative" ref={catRef}>
                    <button
                      type="button"
                      onClick={() => setCatOpen((v) => !v)}
                      className={
                        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors " +
                        (categories.length
                          ? "border-ink-950 bg-ink-950 font-medium text-white"
                          : "border-ink-200 bg-surface text-ink-700 hover:border-ink-300")
                      }
                    >
                      <span>
                        {categories.length === 0
                          ? "全部分类"
                          : categories.length === 1
                            ? `分类：${CATEGORY_LABEL[categories[0]!] ?? categories[0]}`
                            : `分类：已选 ${categories.length} 项`}
                      </span>
                      <ChevronDown size={12} />
                    </button>
                    {catOpen && (
                      <div className="panel absolute top-full left-0 z-40 mt-1.5 w-[260px] p-2.5 shadow-lg">
                        <div className="mb-2 flex items-center justify-between text-[11px] text-ink-500">
                          <span>支持多选分类</span>
                          {categories.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setCategories([])}
                              className="font-medium text-accent hover:underline"
                            >
                              清空
                            </button>
                          )}
                        </div>
                        <div className="grid max-h-[240px] grid-cols-2 gap-1 overflow-auto">
                          {(stats.data?.byCategory ?? []).map((c) => {
                            const key = c.category ?? "other";
                            const checked = categories.includes(key);
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() =>
                                  setCategories((cur) =>
                                    cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key],
                                  )
                                }
                                className={
                                  "flex items-center justify-between rounded border px-2 py-1 text-left text-[11.5px] transition-colors " +
                                  (checked
                                    ? "border-ink-950 bg-ink-950 font-medium text-white"
                                    : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                                }
                              >
                                <span className="truncate">{CATEGORY_LABEL[key] ?? key}</span>
                                <span className={"ml-1 font-mono text-[10.5px] " + (checked ? "text-white/70" : "text-ink-400")}>
                                  {c.n}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 语言筛选 */}
                  <select
                    value={lang}
                    onChange={(e) => setLang(e.target.value as "all" | "zh" | "en")}
                    className="h-7 rounded-md border border-ink-200 bg-surface px-2 text-[12px] text-ink-700 outline-none focus:border-accent"
                    title="按标题语言筛选"
                  >
                    <option value="all">全部语言</option>
                    <option value="zh">仅看中文</option>
                    <option value="en">仅看英文</option>
                  </select>

                  <select
                    value={priceCap}
                    onChange={(e) => setPriceCap(e.target.value)}
                    className="h-7 rounded-md border border-ink-200 bg-surface px-2 text-[12px] text-ink-700 outline-none focus:border-accent"
                    title="价格上限"
                  >
                    <option value="auto">
                      价格：{preset === "free" ? "默认只看白嫖" : "默认不限"}
                    </option>
                    <option value="all">价格：不限</option>
                    <option value="free">仅白嫖 (0 元)</option>
                    <option value="5">≤ 5 元</option>
                    <option value="10">≤ 10 元</option>
                    <option value="30">≤ 30 元</option>
                    <option value="100">≤ 100 元</option>
                  </select>

                  <select
                    value={obtain}
                    onChange={(e) => setObtain(e.target.value)}
                    className="h-7 rounded-md border border-ink-200 bg-surface px-2 text-[12px] text-ink-700 outline-none focus:border-accent"
                    title={OBTAIN_HINT[obtain] ?? "获取方式"}
                  >
                    <option value="auto">
                      方式：{preset === "verified" ? "默认白嫖+有条件" : preset === "free" ? "默认直接白嫖" : "默认不限"}
                    </option>
                    <option value="all">方式：全部（含抽奖/试用）</option>
                    <option value="free">仅直接白嫖</option>
                    <option value="conditional">有条件领取</option>
                    <option value="lottery">抽奖/开奖</option>
                    <option value="trial">免费试用</option>
                    <option value="promo">推广/引流</option>
                  </select>

                  <select
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                    className="h-7 rounded-md border border-ink-200 bg-surface px-2 text-[12px] text-ink-700 outline-none focus:border-accent"
                    title="发布时间窗口"
                  >
                    <option value="auto">
                      时间：{preset === "verified" ? "默认 7 天内" : preset === "free" ? "默认 14 天内" : "默认不限"}
                    </option>
                    <option value="all">时间：不限</option>
                    <option value="1d">24 小时内</option>
                    <option value="3d">3 天内</option>
                    <option value="7d">一周内</option>
                    <option value="30d">一个月内</option>
                  </select>

                  <select
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                    className="h-7 rounded-md border border-ink-200 bg-surface px-2 text-[12px] text-ink-700 outline-none focus:border-accent"
                    title="最低评分"
                  >
                    <option value="all">评分：不限</option>
                    <option value="50">≥ 50 分</option>
                    <option value="60">≥ 60 分</option>
                    <option value="70">≥ 70 分</option>
                  </select>

                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    className="h-7 rounded-md border border-ink-200 bg-surface px-2 text-[12px] text-ink-700 outline-none focus:border-accent"
                    title="排序方式"
                  >
                    <option value="score">综合评分</option>
                    <option value="newest">最新发布</option>
                    <option value="oldest">最早发布</option>
                    <option value="expiring">截止时间最近</option>
                    <option value="price_asc">价格从低到高</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => setUnreadOnly((v) => !v)}
                    className={
                      "h-7 rounded-md border px-2.5 text-[12px] font-medium transition-colors " +
                      (unreadOnly
                        ? "border-ink-950 bg-ink-950 text-white"
                        : "border-ink-200 bg-surface text-ink-600 hover:border-ink-300")
                    }
                  >
                    只看未读
                  </button>

                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-accent hover:bg-brand-subtle"
                    >
                      <RotateCcw size={11} /> 重置 ({activeFilterCount})
                    </button>
                  )}

                  {/* 右端统计与视图切换 */}
                  <div className="ml-auto hidden items-center gap-3 sm:flex">
                    <span className="text-[12px] text-ink-500">
                      {items.loading ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 size={11} className="animate-spin" /> 加载中…
                        </span>
                      ) : (
                        <>
                          共 <strong className="font-mono font-semibold tabular-nums text-ink-900">{items.data?.total ?? 0}</strong> 条
                        </>
                      )}
                    </span>
                    <div className="flex items-center gap-0.5 rounded-md border border-ink-200 bg-surface p-0.5">
                      {[
                        { key: "compact" as const, icon: AlignJustify, label: "紧凑列表" },
                        { key: "card" as const, icon: LayoutGrid, label: "卡片视图" },
                      ].map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => setViewMode(v.key)}
                          className={
                            "rounded px-2 py-1 text-[12px] transition-colors " +
                            (viewMode === v.key ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-950")
                          }
                          title={v.label}
                        >
                          <v.icon size={13} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {activeFilterCount > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-2 text-[11.5px]">
                    <span className="text-ink-400">当前条件：</span>
                    {debounced && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch("");
                          setDebounced("");
                        }}
                        className="rounded bg-ink-100 px-2 py-0.5 text-ink-700 hover:bg-ink-200"
                      >
                        搜索：{debounced} ×
                      </button>
                    )}
                    {source && (
                      <button
                        type="button"
                        onClick={() => setSource("")}
                        className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
                      >
                        源：{sourceName(source)} ×
                      </button>
                    )}
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategories((cur) => cur.filter((x) => x !== cat))}
                        className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
                      >
                        分类：{CATEGORY_LABEL[cat] ?? cat} ×
                      </button>
                    ))}
                    {lang !== "all" && (
                      <button
                        type="button"
                        onClick={() => setLang("all")}
                        className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
                      >
                        语言：{lang === "zh" ? "仅看中文" : "仅看英文"} ×
                      </button>
                    )}
                    {priceCap !== "auto" && (
                      <button
                        type="button"
                        onClick={() => setPriceCap("auto")}
                        className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
                      >
                        价格：{priceCap === "all" ? "不限" : priceCap === "free" ? "仅白嫖" : `≤${priceCap}元`} ×
                      </button>
                    )}
                    {obtain !== "auto" && (
                      <button
                        type="button"
                        onClick={() => setObtain("auto")}
                        className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
                      >
                        方式：{obtain === "all" ? "全部" : (OBTAIN_LABEL[obtain] ?? obtain)} ×
                      </button>
                    )}
                    {range !== "auto" && (
                      <button
                        type="button"
                        onClick={() => setRange("auto")}
                        className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
                      >
                        时间：{range === "all" ? "不限" : range} ×
                      </button>
                    )}
                    {minScore !== "all" && (
                      <button
                        type="button"
                        onClick={() => setMinScore("all")}
                        className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
                      >
                        评分：≥{minScore} ×
                      </button>
                    )}
                    {unreadOnly && (
                      <button
                        type="button"
                        onClick={() => setUnreadOnly(false)}
                        className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
                      >
                        仅未读 ×
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 移动端统计一行 */}
              <div className="flex items-center justify-between border-b border-ink-100 px-3.5 py-1.5 text-[12px] text-ink-500 sm:hidden">
                <span>
                  共 <strong className="font-mono font-semibold text-ink-900">{items.data?.total ?? 0}</strong> 条
                  {preset === "verified" && <span className="ml-1.5 font-medium text-deal">· AI 验真</span>}
                </span>
                {(stats.data?.totals.aiRejected ?? 0) > 0 && (
                  <span className="text-ink-400">已滤 {stats.data?.totals.aiRejected} 条</span>
                )}
              </div>

              {items.error && (
                <div className="mx-3.5 my-3 rounded-lg border border-alert-border bg-alert-subtle p-4 text-[13px] text-alert sm:mx-6">
                  加载失败：{items.error}
                </div>
              )}

              {viewMode === "compact" ? (
                <div>
                  {visible.map((item) => (
                    <Fragment key={item.id}>
                      <CompactRow
                        item={item}
                        sourceName={sourceName}
                        selected={detail?.id === item.id}
                        onPatch={patch}
                        onOpen={setDetail}
                        onQuickBlock={setQuickBlock}
                        onCopyCode={copyCode}
                        expanded={relatedOpen === item.id}
                        onToggleRelated={(id) => setRelatedOpen((cur) => (cur === id ? null : id))}
                      />
                      {relatedOpen === item.id && relatedMap[item.id] ? (
                        <div className="border-b border-ink-100 bg-surface-hover px-3.5 py-2 sm:px-6">
                          <div className="mb-1 text-[11px] font-medium text-ink-500">
                            同一福利的其他 {relatedMap[item.id]!.length} 条来源报道
                          </div>
                          <ul className="space-y-1">
                            {relatedMap[item.id]!.map((r) => (
                              <li key={r.id} className="flex items-center gap-2 text-[12px]">
                                <span className="w-20 shrink-0 truncate text-ink-500 sm:w-28">{r.sourceName ?? r.source_id}</span>
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="truncate text-ink-700 hover:text-accent hover:underline"
                                >
                                  {r.title}
                                </a>
                                <span className="shrink-0 font-mono text-[11px] text-ink-400">
                                  {String(r.first_seen_at).slice(5, 16).replace("T", " ")}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </Fragment>
                  ))}
                </div>
              ) : (
                <div className="space-y-2.5 px-3.5 py-3 sm:px-6 sm:py-4">
                  {visible.map((item) => (
                    <Fragment key={item.id}>
                      <ItemCard
                        item={item}
                        sourceName={sourceName}
                        onPatch={patch}
                        onOpen={setDetail}
                        onQuickBlock={setQuickBlock}
                        onCopyCode={copyCode}
                        expanded={relatedOpen === item.id}
                        onToggleRelated={(id) => setRelatedOpen((cur) => (cur === id ? null : id))}
                      />
                      {relatedOpen === item.id && relatedMap[item.id] ? (
                        <div className="panel px-4 py-3">
                          <div className="mb-2 text-[12px] font-medium text-ink-500">
                            同一福利的其他 {relatedMap[item.id]!.length} 条来源报道
                          </div>
                          <ul className="space-y-1.5">
                            {relatedMap[item.id]!.map((r) => (
                              <li key={r.id} className="flex items-center gap-2 text-[12px]">
                                <span className="w-24 shrink-0 truncate text-ink-500 sm:w-32">{r.sourceName ?? r.source_id}</span>
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="truncate text-ink-700 hover:text-accent hover:underline"
                                >
                                  {r.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </Fragment>
                  ))}
                </div>
              )}

              {!items.loading && !visible.length && (
                <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
                  <Radar size={28} className="text-ink-300" />
                  <div className="text-[15px] font-medium text-ink-900">当前条件下没有福利资源</div>
                  <p className="max-w-md text-[12.5px] leading-relaxed text-ink-500">
                    试试把「常用场景」切到「全部收录」，或放宽价格上限；也可能是屏蔽词把结果挡掉了。
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      resetFilters();
                      setPreset("all");
                    }}
                    className="mt-1 rounded-md bg-brand px-4 py-2 text-[12.5px] font-medium text-white hover:bg-brand-hover"
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
              canAdmin={adminReady}
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

          {adminReady && tab === "rules" && (
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

          {adminReady && tab === "push" && (
            <PushPanel
              payload={push.data}
              preview={pushPreview}
              logs={pushLogs.data?.logs ?? []}
              sources={sources.data?.sources ?? []}
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
                notify("推送规则已保存");
              }}
              onPreview={async () => {
                const res = await fetch("/api/push/preview?limit=6");
                setPushPreview((await res.json()) as PushPreview);
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

          {adminReady && tab === "ai" && (
            <AiPanel
              data={ai.data}
              sources={sources.data?.sources ?? []}
              reload={ai.reload}
              onNotify={notify}
            />
          )}

          {adminReady && tab === "ops" && (
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
              onNotify={notify}
            />
          )}
        </main>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-3.5 py-3 text-[11.5px] text-ink-400 sm:px-6">
          <span>白嫖雷达 · 自动多源聚合 · AI 语义验真 · 所筛即所推</span>
          <span className="font-mono tabular-nums">
            {stats.data?.totals.active ?? 0} 条在库 · {stats.data?.totals.unread ?? 0} 条未读
          </span>
        </footer>
      </div>

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

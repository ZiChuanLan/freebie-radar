import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Clock3,
  Filter,
  Info,
  Github,
  Globe2,
  Loader2,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import type { Item, ItemsQuery, Run, Source, Stats } from "./types.ts";

const CATEGORY_LABEL: Record<string, string> = {
  ai: "AI 额度",
  cloud: "云服务",
  domain: "域名/主机",
  software: "软件授权",
  media: "影音会员",
  game: "游戏",
  goods: "实物/优惠",
  invite: "邀请码",
  edu: "教育",
  other: "其它",
};

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
  "gamerpower": "GamerPower · 免费游戏",
  "epic-free": "Epic Games · 喜加一",
  "rss-reddit-freegames": "Reddit · FreeGameFindings",
  "rss-reddit-efreebies": "Reddit · eFreebies",
  "rss-reddit-gamedeals": "Reddit · GameDeals",
  "rss-slickdeals": "Slickdeals",
  "rss-heyitsfree": "HeyItsFree",
  "rss-keylol": "其乐 Keylol",
  "mock-source": "Mock 源",
};

const sourceName = (id: string) => SOURCE_LABEL[id] ?? id;

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

function expiresLabel(iso: string | null): { text: string; urgent: boolean } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  if (days < 0) return { text: "已过期", urgent: true };
  if (days === 0) return { text: "今天截止", urgent: true };
  return { text: `${days} 天后截止`, urgent: days <= 3 };
}

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

function StatPill({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-lg font-semibold tabular-nums ${accent ? "text-lime" : "text-ink-100"}`}>{value}</span>
      <span className="text-[11px] tracking-wide text-ink-400 uppercase">{label}</span>
    </div>
  );
}

function ItemCard({ item, onPatch, onOpen }: { item: Item; onPatch: (id: number, body: Record<string, unknown>) => void; onOpen: (item: Item) => void }) {
  const exp = expiresLabel(item.expires_at);
  return (
    <article className="card animate-rise group relative overflow-hidden p-4 transition-colors hover:border-ink-600/90">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
            <span className="rounded-full bg-ink-700/70 px-2 py-0.5 font-medium text-ink-200">{sourceName(item.source_id)}</span>
            {item.category && (
              <span className="rounded-full border border-lime/25 bg-lime/10 px-2 py-0.5 font-medium text-lime">
                {CATEGORY_LABEL[item.category] ?? item.category}
              </span>
            )}
            {exp && (
              <span className={`inline-flex items-center gap-1 ${exp.urgent ? "text-orange-400" : "text-ink-400"}`}>
                <Clock3 size={11} /> {exp.text}
              </span>
            )}
            <span>{timeAgo(item.published_at ?? item.first_seen_at)}</span>
          </div>

          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="block text-[15px] leading-snug font-medium text-ink-100 decoration-lime/60 underline-offset-4 hover:text-lime hover:underline"
          >
            {item.title}
            <ArrowUpRight size={13} className="ml-1 inline-block opacity-0 transition-opacity group-hover:opacity-60" />
          </a>

          {item.summary && <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-400">{item.summary}</p>}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {item.tags.slice(0, 6).map((t) => (
              <span key={t} className="rounded-md bg-ink-800 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-300">
                #{t}
              </span>
            ))}
            {item.ai?.reason && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-400">
                <Sparkles size={10} /> {item.ai.reason}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div
            className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-1.5 font-mono text-xs font-semibold tabular-nums ${
              item.score >= 70 ? "bg-lime/15 text-lime" : item.score >= 40 ? "bg-ink-700 text-ink-200" : "bg-ink-800 text-ink-400"
            }`}
            title="综合评分"
          >
            {Math.round(item.score)}
          </div>
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="rounded-md p-1.5 text-ink-600 transition-colors hover:bg-ink-700 hover:text-ink-300"
            title="查看详情"
          >
            <Info size={14} />
          </button>
          <button
            type="button"
            onClick={() => onPatch(item.id, { starred: !item.starred })}
            className={`rounded-md p-1.5 transition-colors hover:bg-ink-700 ${item.starred ? "text-amber-300" : "text-ink-600 hover:text-ink-300"}`}
            title={item.starred ? "取消收藏" : "收藏"}
          >
            <Star size={14} fill={item.starred ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            onClick={() => onPatch(item.id, { status: "ignored" })}
            className="rounded-md p-1.5 text-ink-600 transition-colors hover:bg-ink-700 hover:text-ink-300"
            title="忽略"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function StatusPanel({ sources, runs }: { sources: Source[]; runs: Run[] }) {
  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="border-b border-ink-700/60 px-4 py-3 text-sm font-medium">数据源状态</div>
        <table className="w-full text-left text-[13px]">
          <thead className="text-[11px] tracking-wide text-ink-400 uppercase">
            <tr className="border-b border-ink-800">
              <th className="px-4 py-2 font-medium">源</th>
              <th className="px-2 py-2 font-medium">条目</th>
              <th className="px-2 py-2 font-medium">最近采集</th>
              <th className="px-2 py-2 font-medium">状态</th>
              <th className="px-4 py-2 font-medium">错误</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-b border-ink-800/60 last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-ink-200">{s.name}</div>
                  <div className="font-mono text-[10.5px] text-ink-400">{s.kind}</div>
                </td>
                <td className="px-2 py-2.5 tabular-nums text-ink-300">{s.items}</td>
                <td className="px-2 py-2.5 text-ink-400">{timeAgo(s.last_run_at)}</td>
                <td className="px-2 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      s.last_status === "ok"
                        ? "bg-lime/15 text-lime"
                        : s.last_status === "failed"
                          ? "bg-red-500/15 text-red-400"
                          : s.last_status === "degraded"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-ink-700 text-ink-300"
                    }`}
                  >
                    {s.last_status ?? "未运行"}
                  </span>
                </td>
                <td className="max-w-[280px] truncate px-4 py-2.5 font-mono text-[11px] text-red-400/80">{s.last_error ?? "—"}</td>
              </tr>
            ))}
            {!sources.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-400">
                  还没有注册任何数据源
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-700/60 px-4 py-3 text-sm font-medium">最近采集记录</div>
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
                <td className="px-4 py-2 font-mono text-[11.5px] text-ink-400">{r.started_at.replace("T", " ").slice(5, 19)}</td>
                <td className="px-2 py-2 text-ink-300">{sourceName(r.source_id)}</td>
                <td className="px-2 py-2 tabular-nums text-ink-300">{r.fetched}</td>
                <td className="px-2 py-2 tabular-nums text-lime">{r.inserted}</td>
                <td className="px-2 py-2 tabular-nums text-ink-400">{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                <td className="max-w-[320px] truncate px-4 py-2 font-mono text-[11px] text-ink-400">{r.error ?? r.status}</td>
              </tr>
            ))}
            {!runs.length && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-400">
                  还没有采集记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemDetail({ item, onClose, onPatch }: { item: Item; onClose: () => void; onPatch: (id: number, body: Record<string, unknown>) => void }) {
  const exp = expiresLabel(item.expires_at);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 p-4 backdrop-blur-sm sm:p-10" onClick={onClose}>
      <div className="card w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
            <span className="rounded-full bg-ink-700/70 px-2 py-0.5 text-ink-200">{sourceName(item.source_id)}</span>
            {item.category && (
              <span className="rounded-full border border-lime/25 bg-lime/10 px-2 py-0.5 text-lime">
                {CATEGORY_LABEL[item.category] ?? item.category}
              </span>
            )}
            {exp && <span className={exp.urgent ? "text-orange-400" : ""}>{exp.text}</span>}
            <span>{timeAgo(item.published_at ?? item.first_seen_at)}</span>
            <span className="font-mono">评分 {Math.round(item.score)}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100" title="关闭">
            <X size={16} />
          </button>
        </div>

        <h2 className="text-[17px] leading-snug font-semibold">{item.title}</h2>
        {item.summary && <p className="mt-3 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-300">{item.summary}</p>}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          <div><dt className="text-ink-500">首次收录</dt><dd className="text-ink-300">{item.first_seen_at.replace("T", " ").slice(0, 19)}</dd></div>
          <div><dt className="text-ink-500">最近更新</dt><dd className="text-ink-300">{item.last_seen_at.replace("T", " ").slice(0, 19)}</dd></div>
          <div><dt className="text-ink-500">发布时间</dt><dd className="text-ink-300">{item.published_at ? item.published_at.replace("T", " ").slice(0, 19) : "—"}</dd></div>
          <div><dt className="text-ink-500">截止时间</dt><dd className="text-ink-300">{item.expires_at ? item.expires_at.replace("T", " ").slice(0, 19) : "—"}</dd></div>
          <div className="col-span-2"><dt className="text-ink-500">来源 ID</dt><dd className="font-mono text-ink-400">{item.source_id} · {item.external_id}</dd></div>
        </dl>

        {item.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {item.tags.map((t) => (
              <span key={t} className="rounded-md bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-300">#{t}</span>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <a href={item.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-lg bg-lime/15 px-3 py-2 text-[13px] font-medium text-lime hover:bg-lime/25">
            打开原文 <ArrowUpRight size={14} />
          </a>
          <button type="button" onClick={() => onPatch(item.id, { starred: !item.starred })} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-[13px] text-ink-200 hover:border-ink-600">
            <Star size={14} fill={item.starred ? "currentColor" : "none"} /> {item.starred ? "取消收藏" : "收藏"}
          </button>
          <button type="button" onClick={() => { onPatch(item.id, { status: "ignored" }); onClose(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-[13px] text-ink-400 hover:border-ink-600 hover:text-ink-200">
            <X size={14} /> 忽略此条
          </button>
        </div>
      </div>
    </div>
  );
}

function DigestPanel({ onPatch, onOpen }: { onPatch: (id: number, body: Record<string, unknown>) => void; onOpen: (item: Item) => void }) {
  const list = useApi<{ digests: { date: string; created_at: string; pushed_at: string | null }[] }>("/api/digests");
  const dates = list.data?.digests ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const active = picked ?? dates[0]?.date ?? null;
  const detail = useApi<{ date: string; text: string; count: number; created_at: string; pushed_at: string | null; items: Item[] }>(
    active ? "/api/digests/" + active : null,
  );

  if (!list.loading && !dates.length) {
    return (
      <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
        <Sparkles size={26} className="text-ink-600" />
        <div className="text-[14px]">还没有生成过日报</div>
        <p className="max-w-md text-[12.5px] leading-relaxed text-ink-400">
          运行 <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono">pnpm daily</code>，或
          <code className="mx-1 rounded bg-ink-800 px-1.5 py-0.5 font-mono">docker compose exec radar node node_modules/tsx/dist/cli.mjs src/server/cli.ts daily</code>
          生成当日精选；生成后这里会按日期列出。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {dates.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => setPicked(d.date)}
            className={"rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors " + (d.date === active ? "border-lime/40 bg-lime/10 text-lime" : "border-ink-700 text-ink-300 hover:border-ink-600")}
          >
            {d.date}
            {d.pushed_at ? <span className="ml-1.5 text-[10px] text-lime/70">已推送</span> : null}
          </button>
        ))}
      </div>

      {detail.loading && <div className="card p-6 text-[13px] text-ink-400">加载中…</div>}
      {detail.error && <div className="card border-red-500/30 p-4 text-[13px] text-red-400">{detail.error}</div>}

      {detail.data && (
        <>
          <div className="card p-4">
            <div className="mb-1 flex items-center justify-between text-[13px]">
              <span className="font-medium">{detail.data.date} 精选</span>
              <span className="text-[11.5px] text-ink-400">
                {detail.data.count} 条 · 生成于 {detail.data.created_at.replace("T", " ").slice(5, 16)}
                {detail.data.pushed_at ? " · 已推送 Telegram" : " · 仅落库（PUSH_CHANNEL=none）"}
              </span>
            </div>
            <pre className="mt-3 max-h-[240px] overflow-auto rounded-lg bg-ink-900/80 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-300">
              {detail.data.text}
            </pre>
          </div>

          <div className="space-y-2.5">
            {detail.data.items.map((item) => (
              <ItemCard key={item.id} item={item} onPatch={onPatch} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<"feed" | "digest" | "status">(() => {
    if (typeof location === "undefined") return "feed";
    if (location.hash === "#status") return "status";
    if (location.hash === "#digest") return "digest";
    return "feed";
  });

  useEffect(() => {
    if (typeof location === "undefined") return;
    if (tab === "status" || tab === "digest") history.replaceState(null, "", "#" + tab);
    else history.replaceState(null, "", location.pathname + location.search);
  }, [tab]);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Item | null>(null);
  const [debounced, setDebounced] = useState("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("score");
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [onlyFresh, setOnlyFresh] = useState(true);
  const [range, setRange] = useState("all");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("search", debounced);
    if (source) p.set("source", source);
    if (category) p.set("category", category);
    if (sort) p.set("sort", sort);
    if (onlyStarred) p.set("starred", "1");
    if (onlyFresh) p.set("unexpired", "1");
    const DAYS: Record<string, number> = { "1d": 1, "3d": 3, "7d": 7, "30d": 30 };
    const days = DAYS[range];
    if (days) p.set("since", new Date(Date.now() - days * 86_400_000).toISOString());
    p.set("limit", "60");
    return p.toString();
  }, [debounced, source, category, sort, onlyStarred, onlyFresh, range]);

  const stats = useApi<Stats>("/api/stats");
  const items = useApi<{ total: number; items: Item[] }>(`/api/items?${query}`);
  const sources = useApi<{ sources: Source[] }>("/api/sources");
  const runs = useApi<{ runs: Run[] }>("/api/runs?limit=30");

  const patch = useCallback(
    async (id: number, body: Record<string, unknown>) => {
      await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      items.reload();
      stats.reload();
    },
    [items, stats],
  );

  const maxCategory = Math.max(1, ...(stats.data?.byCategory ?? []).map((c) => c.n));

  return (
    <div className="mx-auto flex min-h-screen max-w-[1240px] flex-col px-5 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-lime/30 bg-lime/10">
            <Radar size={20} className="text-lime" />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight">白嫖雷达</h1>
            <p className="text-[11.5px] text-ink-400">免费额度 · 可领取 · 限时开放注册</p>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <StatPill label="在库" value={stats.data?.totals.active ?? "—"} />
          <StatPill label="24h 新增" value={stats.data?.totals.last24h ?? "—"} accent />
          <StatPill label="收藏" value={stats.data?.totals.starred ?? "—"} />
          <div className="hidden items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-[11.5px] text-ink-300 sm:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${stats.data?.features.ai ? "bg-lime" : "bg-ink-500"}`} />
            AI 二审 {stats.data?.features.ai ? "开" : "关"} · 推送 {stats.data?.features.push ? stats.data.features.pushChannel : "关"}
          </div>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜「免费」「GPT」「域名」「会员」…"
            className="w-full rounded-xl border border-ink-700 bg-ink-900/70 py-2.5 pr-3 pl-9 text-[13.5px] outline-none transition-colors placeholder:text-ink-400/70 focus:border-lime/40"
          />
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-ink-700 bg-ink-900/60 p-1">
          {(["feed", "digest", "status"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] transition-colors ${
                tab === t ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200"
              }`}
            >
              {t === "feed" ? "资源流" : t === "digest" ? "每日精选" : "运维状态"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            items.reload();
            stats.reload();
            sources.reload();
            runs.reload();
          }}
          className="rounded-xl border border-ink-700 bg-ink-900/60 p-2.5 text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
          title="刷新"
        >
          <RefreshCw size={15} className={items.loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex flex-1 gap-5">
        {tab === "feed" && (
          <aside className="hidden w-[200px] shrink-0 space-y-5 lg:block">
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] tracking-wider text-ink-400 uppercase">
                <Filter size={11} /> 来源
              </div>
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => setSource("")}
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors ${source === "" ? "bg-ink-700/70 text-ink-100" : "text-ink-300 hover:bg-ink-800/60"}`}
                >
                  全部来源
                </button>
                {(sources.data?.sources ?? []).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSource(s.id === source ? "" : s.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                      source === s.id ? "bg-ink-700/70 text-ink-100" : "text-ink-300 hover:bg-ink-800/60"
                    }`}
                  >
                    <span className="truncate">{s.name}</span>
                    <span className="ml-2 shrink-0 font-mono text-[10.5px] text-ink-400">{s.items}</span>
                  </button>
                ))}
              </div>
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

            <section className="space-y-1.5">
              <div className="mb-2 text-[11px] tracking-wider text-ink-400 uppercase">筛选</div>
              {[
                { label: "只看未过期", on: onlyFresh, toggle: () => setOnlyFresh((v) => !v) },
                { label: "只看收藏", on: onlyStarred, toggle: () => setOnlyStarred((v) => !v) },
              ].map((f) => (
                <button
                  key={f.label}
                  type="button"
                  onClick={f.toggle}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[12.5px] transition-colors ${
                    f.on ? "bg-lime/10 text-lime" : "text-ink-300 hover:bg-ink-800/60"
                  }`}
                >
                  {f.label}
                  <span className={`h-3.5 w-6 rounded-full p-0.5 transition-colors ${f.on ? "bg-lime/70" : "bg-ink-700"}`}>
                    <span className={`block h-2.5 w-2.5 rounded-full bg-ink-950 transition-transform ${f.on ? "translate-x-2.5" : ""}`} />
                  </span>
                </button>
              ))}
            </section>

            <section>
<section>
              <div className="mb-2 text-[11px] tracking-wider text-ink-400 uppercase">发布时间</div>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value)}
                className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-[12.5px] text-ink-200 outline-none"
              >
                <option value="all">不限</option>
                <option value="1d">24 小时内</option>
                <option value="3d">3 天内</option>
                <option value="7d">一周内</option>
                <option value="30d">一个月内</option>
              </select>
            </section>
              <div className="mb-2 text-[11px] tracking-wider text-ink-400 uppercase">排序</div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-[12.5px] text-ink-200 outline-none"
              >
                <option value="score">综合评分</option>
                <option value="newest">最新发布</option>
                <option value="oldest">最早发布</option>
              </select>
            </section>
          </aside>
        )}

        <main className="min-w-0 flex-1">
          {tab === "digest" ? (
            <DigestPanel onPatch={patch} onOpen={setDetail} />
          ) : tab === "status" ? (
            <StatusPanel sources={sources.data?.sources ?? []} runs={runs.data?.runs ?? []} />
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between px-0.5">
                <div className="text-[12px] text-ink-400">
                  {items.loading ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" /> 加载中
                    </span>
                  ) : (
                    <>
                      共 <span className="font-mono text-ink-200">{items.data?.total ?? 0}</span> 条
                      {debounced && <span>，搜索「{debounced}」</span>}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11.5px] text-ink-400">
                  <span className="inline-flex items-center gap-1">
                    <Activity size={11} /> 评分 = 关键词 × 时效 × 稀缺度
                  </span>
                </div>
              </div>

              {items.error && <div className="card mb-3 border-red-500/30 p-4 text-[13px] text-red-400">接口错误：{items.error}</div>}

              <div className="space-y-2.5">
                {(items.data?.items ?? []).map((item) => (
                  <ItemCard key={item.id} item={item} onPatch={patch} onOpen={setDetail} />
                ))}
              </div>

              {!items.loading && !items.data?.items.length && (
                <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <Globe2 size={26} className="text-ink-600" />
                  <div className="text-[14px] text-ink-200">还没有资源</div>
                  <p className="max-w-sm text-[12.5px] leading-relaxed text-ink-400">
                    先跑一次采集：<code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[11.5px]">pnpm collect</code>
                    ，或在运维状态页查看各源最近一次运行记录。
                  </p>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <footer className="mt-10 flex items-center justify-between border-t border-ink-800 pt-4 text-[11px] text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <Github size={11} /> freebie-radar · 本地优先 · 数据存 SQLite
        </span>
        <span className="font-mono">{stats.data?.totals.total ?? 0} items</span>
      </footer>

      {detail && <ItemDetail item={detail} onClose={() => setDetail(null)} onPatch={patch} />}
    </div>
  );
}

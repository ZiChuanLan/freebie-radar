import { aiEnabled, config } from "../config.ts";
import { all, get, run, tx } from "../db.ts";
import { enrichItem } from "../enrich/index.ts";
import { reviewItems, type AiVerdict } from "../enrich/ai.ts";
import { pushInstant } from "../instant.ts";
import { createHttp, type HttpClient } from "../http.ts";
import { mockCollector } from "./mock.ts";
import { linuxdoCollector } from "./linuxdo.ts";
import { v2exCollector } from "./v2ex.ts";
import { githubCollector } from "./github.ts";
import { rssCollector } from "./rss.ts";
import { telegramCollector } from "./telegram.ts";
import { gamerpowerCollector } from "./gamerpower.ts";
import { epicCollector } from "./epic.ts";
import { gogCollector } from "./gog.ts";
import { steamCollector } from "./steam.ts";
import type { Collector, RawItem, SourceSeed } from "./types.ts";

export const COLLECTORS: Collector[] = [
  mockCollector, linuxdoCollector, v2exCollector, githubCollector, rssCollector, telegramCollector,
  gamerpowerCollector, epicCollector, gogCollector, steamCollector,
];
const BY_KIND = new Map(COLLECTORS.map((c) => [c.kind, c]));

/** 内置源清单；collector 落地后在此追加。 */
export const SEEDS: SourceSeed[] = [
  { id: "linuxdo-welfare", name: "LINUX DO · 福利羊毛", kind: "linuxdo", enabled: true, intervalSec: 90, config: { categoryId: 36, fetchContent: true } },
  { id: "linuxdo-resource", name: "LINUX DO · 资源荟萃", kind: "linuxdo", enabled: true, intervalSec: 180, config: { categoryId: 14 } },
  { id: "v2ex-free", name: "V2EX · 免费赠送", kind: "v2ex", enabled: true, intervalSec: 120, config: { node: "free" } },
  { id: "github-free-for-dev", name: "GitHub · free-for-dev", kind: "github-readme", enabled: true, config: { repos: [{ repo: "ripienaar/free-for-dev", limit: 60 }] } },
  { id: "rss-fuliba", name: "福利吧", kind: "rss", enabled: true, config: { feeds: [{ id: "fuliba", url: "https://fuliba.net/feed", limit: 30 }] } },
  { id: "rss-52pojie", name: "吾爱破解", kind: "rss", enabled: true, config: { feeds: [{ id: "52pojie", url: "https://www.52pojie.cn/forum.php?mod=rss", limit: 20 }] } },
  { id: "rss-smzdm", name: "什么值得买", kind: "rss", enabled: true, config: { feeds: [{ id: "smzdm", url: "https://www.smzdm.com/rss/", limit: 20 }] } },
  { id: "zhihu-search", name: "知乎 · 福利搜索", kind: "ingest", enabled: true, config: { keyword: "免费领取" } },
  { id: "xhs-search", name: "小红书 · 福利搜索", kind: "ingest", enabled: true, config: { keyword: "免费领取" } },
  { id: "xiaoheihe-search", name: "小黑盒 · 福利搜索", kind: "ingest", enabled: true, config: { keyword: "免费" } },
  { id: "tg-channels", name: "Telegram 羊毛频道", kind: "telegram", enabled: false, config: { channels: [] } },
  { id: "gamerpower", name: "GamerPower · 免费游戏聚合", kind: "gamerpower", enabled: true, intervalSec: 900, config: { query: "type=game", limit: 60 } },
  // GOG 的 catalog API 不支持 discount=100 / price=free 筛选（实测都返回普通折扣游戏），
  // 商店页是 Angular SSR，解析成本高、单周通常只有 0-1 个免费，先禁用。
  { id: "gog-free", name: "GOG · 限时免费", kind: "gog", enabled: false, config: {} },
  { id: "steam-free", name: "Steam · 限时免费", kind: "steam", enabled: true, intervalSec: 1800, config: { count: 50 } },
  { id: "epic-free", name: "Epic Games · 喜加一", kind: "epic", enabled: true, intervalSec: 3600, config: { includeUpcoming: true } },
  { id: "rss-reddit-freegames", name: "Reddit · FreeGameFindings", kind: "rss", enabled: true, config: { feeds: [{ id: "freegamefindings", url: "https://www.reddit.com/r/FreeGameFindings/hot.rss", limit: 40 }] } },
  { id: "rss-reddit-efreebies", name: "Reddit · eFreebies", kind: "rss", enabled: true, config: { feeds: [{ id: "efreebies", url: "https://www.reddit.com/r/efreebies/hot.rss", limit: 40 }] } },
  { id: "rss-reddit-gamedeals", name: "Reddit · GameDeals", kind: "rss", enabled: true, config: { feeds: [{ id: "gamedeals", url: "https://www.reddit.com/r/GameDeals/hot.rss", limit: 30 }] } },
  { id: "rss-slickdeals", name: "Slickdeals 首页", kind: "rss", enabled: true, config: { feeds: [{ id: "slickdeals", url: "https://slickdeals.net/newsearch.php?rss=1&searcharea=deals&searchin=first", limit: 30 }] } },
  { id: "rss-heyitsfree", name: "HeyItsFree 免费样品", kind: "rss", enabled: true, config: { feeds: [{ id: "heyitsfree", url: "https://heyitsfree.net/feed/", limit: 30 }] } },
  { id: "rss-keylol", name: "其乐 Keylol", kind: "rss", enabled: true, config: { feeds: [{ id: "keylol", url: "https://keylol.com/forum.php?mod=rss", limit: 30 }] } },
  { id: "rss-reddit-freebies", name: "Reddit · freebies", kind: "rss", enabled: true, config: { feeds: [{ id: "freebies", url: "https://www.reddit.com/r/freebies/hot.rss", limit: 30 }] } },
  { id: "rss-reddit-apphookup", name: "Reddit · AppHookup（App 限免）", kind: "rss", enabled: true, config: { feeds: [{ id: "apphookup", url: "https://www.reddit.com/r/AppHookup/hot.rss", limit: 30 }] } },
  { id: "rss-reddit-freeebooks", name: "Reddit · FreeEBOOKS", kind: "rss", enabled: true, config: { feeds: [{ id: "freeebooks", url: "https://www.reddit.com/r/FreeEBOOKS/hot.rss", limit: 30 }] } },
  { id: "rss-reddit-googleplay", name: "Reddit · GooglePlayDeals", kind: "rss", enabled: true, config: { feeds: [{ id: "googleplaydeals", url: "https://www.reddit.com/r/googleplaydeals/hot.rss", limit: 30 }] } },
  { id: "rss-giveawayoftheday", name: "Giveaway of the Day（每日免费软件）", kind: "rss", enabled: true, config: { feeds: [{ id: "giveawayoftheday", url: "https://www.giveawayoftheday.com/feed/", limit: 20 }] } },
  { id: "rss-appinn", name: "小众软件 Appinn", kind: "rss", enabled: true, config: { feeds: [{ id: "appinn", url: "https://www.appinn.com/feed/", limit: 20 }] } },
  { id: "rss-sspai", name: "少数派", kind: "rss", enabled: true, config: { feeds: [{ id: "sspai", url: "https://sspai.com/feed", limit: 20 }] } },
  { id: "rss-ithome", name: "IT之家", kind: "rss", enabled: true, config: { feeds: [{ id: "ithome", url: "https://www.ithome.com/rss/", limit: 25 }] } },
  { id: "rss-producthunt", name: "Product Hunt", kind: "rss", enabled: true, config: { feeds: [{ id: "producthunt", url: "https://www.producthunt.com/feed", limit: 25 }] } },
  { id: "rss-hnrss", name: "Hacker News（100+ 分）", kind: "rss", enabled: true, config: { feeds: [{ id: "hnrss", url: "https://hnrss.org/frontpage?points=100", limit: 25 }] } },
  { id: "rss-freebieshark", name: "FreebieShark 免费样品", kind: "rss", enabled: true, config: { feeds: [{ id: "freebieshark", url: "https://www.freebieshark.com/feed/", limit: 25 }] } },
  { id: "rss-9to5toys", name: "9to5Toys 优惠", kind: "rss", enabled: true, config: { feeds: [{ id: "9to5toys", url: "https://9to5toys.com/feed/", limit: 25 }] } },
  { id: "mock-source", name: "Mock 源", kind: "mock", enabled: false, config: {} },
];

/** 供本机 Playwright 采集器把结果回传到服务器；同时补写 runs / sources 状态，保证 /status 有记录。 */
export function ingestItems(sourceId: string, items: RawItem[]): { inserted: number; skipped: number } {
  ensureSources();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runRow = run("INSERT INTO runs (source_id, started_at, status) VALUES (?, ?, 'running')", sourceId, startedAt);
  const runId = Number(runRow.lastInsertRowid);
  try {
    const saved = persist(sourceId, items, null);
    const durationMs = Date.now() - t0;
    run(
      "UPDATE runs SET finished_at = ?, status = 'ok', fetched = ?, inserted = ?, skipped = ?, duration_ms = ? WHERE id = ?",
      new Date().toISOString(), items.length, saved.inserted, saved.skipped, durationMs, runId,
    );
    run("UPDATE sources SET last_run_at = ?, last_status = 'ok', last_error = NULL WHERE id = ?", startedAt, sourceId);
    return saved;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    run(
      "UPDATE runs SET finished_at = ?, status = 'failed', fetched = ?, error = ?, duration_ms = ? WHERE id = ?",
      new Date().toISOString(), items.length, message, Date.now() - t0, runId,
    );
    run("UPDATE sources SET last_run_at = ?, last_status = 'failed', last_error = ? WHERE id = ?", startedAt, message.slice(0, 300), sourceId);
    throw err;
  }
}

/** 本机采集器上报「登录态失效 / 被风控 / 抓不到内容」：写 runs 并标记 sources 状态，让 /status 如实反映。 */
export function markSourceFailure(
  sourceId: string,
  reason: string,
  status: "degraded" | "failed" = "degraded",
): { ok: true; status: string } {
  ensureSources();
  const now = new Date().toISOString();
  run(
    "INSERT INTO runs (source_id, started_at, finished_at, status, fetched, inserted, skipped, duration_ms, error) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)",
    sourceId, now, now, status, reason.slice(0, 500),
  );
  run("UPDATE sources SET last_run_at = ?, last_status = ?, last_error = ? WHERE id = ?", now, status, reason.slice(0, 300), sourceId);
  return { ok: true, status };
}

type SourceRow = {
  id: string;
  name: string;
  kind: string;
  enabled: number;
  config: string;
  cursor: string | null;
};

export function ensureSources(seeds: SourceSeed[] = SEEDS): void {
  const now = new Date().toISOString();
  for (const s of seeds) {
    run(
      `INSERT INTO sources (id, name, kind, enabled, config, interval_sec, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind`,
      s.id,
      s.name,
      s.kind,
      s.enabled === false ? 0 : 1,
      JSON.stringify(s.config ?? {}),
      s.intervalSec ?? 10800,
      now,
    );
  }
}

export type RunSummary = {
  sourceId: string;
  status: "ok" | "degraded" | "failed";
  fetched: number;
  inserted: number;
  skipped: number;
  durationMs: number;
  error: string | null;
  cursor: string | null;
};

export type FreshItem = {
  id: number;
  title: string;
  url: string;
  score: number;
  codes: string[];
  expiresAt: string | null;
};
function persist(
  sourceId: string,
  items: RawItem[],
  aiMap?: Map<number, AiVerdict> | null,
): { inserted: number; skipped: number; fresh: FreshItem[] } {
  let inserted = 0;
  const fresh: FreshItem[] = [];
  let skipped = 0;
  const now = new Date().toISOString();

  tx(() => {
    for (let index = 0; index < items.length; index += 1) {
      const raw = items[index]!;
      const e = enrichItem(raw, sourceId);
      if (!e) {
        skipped += 1;
        continue;
      }

      const verdict = aiMap?.get(index) ?? null;
      const score = verdict && !verdict.keep ? Math.round(e.score * 0.5) : e.score;
      const aiJson = verdict ? JSON.stringify(verdict) : null;
      const status = e.keep ? "active" : "expired";

      const existing = get<{ id: number }>(
        "SELECT id FROM items WHERE source_id = ? AND external_id = ?",
        sourceId,
        e.externalId,
      );
      if (existing) {
        run(
          `UPDATE items SET url = ?, url_key = ?, title = ?, summary = ?, author = ?, category = ?,
             tags = ?, score = ?, expires_at = ?, published_at = ?, raw = ?, last_seen_at = ?,
             ai = COALESCE(?, ai),
             status = CASE WHEN status = 'ignored' THEN 'ignored' ELSE ? END
           WHERE id = ?`,
          e.url,
          e.urlKey,
          e.title,
          e.summary ?? "",
          e.author ?? null,
          e.category,
          JSON.stringify(e.tags),
          score,
          e.expiresAt,
          e.publishedAt ?? null,
          JSON.stringify(e.raw ?? {}),
          now,
          aiJson,
          status,
          existing.id,
        );
        skipped += 1;
        continue;
      }
      try {
        const res = run(
          `INSERT INTO items (source_id, external_id, url, url_key, title, summary, author, category,
             tags, score, expires_at, published_at, raw, status, ai, content, codes, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          sourceId,
          e.externalId,
          e.url,
          e.urlKey,
          e.title,
          e.summary ?? "",
          e.author ?? null,
          e.category,
          JSON.stringify(e.tags),
          score,
          e.expiresAt,
          e.publishedAt ?? null,
          JSON.stringify(e.raw ?? {}),
          status,
          aiJson,
          e.content ?? null,
          JSON.stringify(e.codes),
          now,
          now,
        );
        inserted += 1;
        fresh.push({ id: Number(res.lastInsertRowid), title: e.title, url: e.url, score, codes: e.codes, expiresAt: e.expiresAt });
      } catch (err) {
        if (/UNIQUE/i.test(String(err))) {
          skipped += 1;
        } else {
          throw err;
        }
      }
    }
  });

  return { inserted, skipped, fresh };
}

export async function runSource(
  sourceId: string,
  options: { http?: HttpClient; maxItems?: number; log?: (message: string) => void } = {},
): Promise<RunSummary> {
  ensureSources();
  const log = options.log ?? ((m: string) => console.log(m));
  const source = get<SourceRow>("SELECT * FROM sources WHERE id = ?", sourceId);
  if (!source) throw new Error(`unknown source: ${sourceId}`);

  const collector = BY_KIND.get(source.kind);
  if (!collector) throw new Error(`no collector registered for kind: ${source.kind}`);

  const http =
    options.http ??
    createHttp({ proxy: config.httpsProxy || config.httpProxy, timeoutMs: config.fetchTimeoutMs, gapMs: config.minRequestGapMs });
  const maxItems = options.maxItems ?? config.maxItemsPerRun;

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runRow = run(
    "INSERT INTO runs (source_id, started_at, status) VALUES (?, ?, 'running')",
    sourceId,
    startedAt,
  );
  const runId = Number(runRow.lastInsertRowid);

  let status: RunSummary["status"] = "ok";
  let fetched = 0;
  let inserted = 0;
  let skipped = 0;
  let error: string | null = null;
  let cursor = source.cursor;

  try {
    const result = await collector.collect({
      sourceId,
      config: JSON.parse(source.config || "{}") as Record<string, unknown>,
      cursor: source.cursor,
      maxItems,
      http,
      log: (m) => log(`[${sourceId}] ${m}`),
    });
    fetched = result.items.length;
    let aiMap: Map<number, AiVerdict> | null = null;
    if (aiEnabled && result.items.length) {
      try {
        aiMap = await reviewItems(result.items);
        if (aiMap) {
          const rejected = [...aiMap.values()].filter((v) => !v.keep).length;
          log(`[${sourceId}] AI 二审 ${aiMap.size} 条，判定非福利 ${rejected} 条`);
        }
      } catch (err) {
        log(`[${sourceId}] AI 二审失败，降级为规则模式: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const saved = persist(sourceId, result.items, aiMap);
    inserted = saved.inserted;
    skipped = saved.skipped;
    // 有新条目就立刻判断是否值得即时推送（送码类 1 分钟就没了）
    if (saved.fresh.length) await pushInstant(sourceId, saved.fresh);
    if (result.cursor !== undefined) cursor = result.cursor;
    if (result.degraded) {
      status = "degraded";
      error = result.degraded;
    }
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  const durationMs = Date.now() - t0;
  const finishedAt = new Date().toISOString();

  run(
    "UPDATE runs SET finished_at = ?, status = ?, fetched = ?, inserted = ?, skipped = ?, duration_ms = ?, error = ? WHERE id = ?",
    finishedAt,
    status,
    fetched,
    inserted,
    skipped,
    durationMs,
    error,
    runId,
  );
  run(
    "UPDATE sources SET cursor = ?, last_run_at = ?, last_status = ?, last_error = ? WHERE id = ?",
    cursor,
    startedAt,
    status,
    error,
    sourceId,
  );

  log(
    `[collect] ${sourceId} fetched=${fetched} inserted=${inserted} skipped=${skipped} duration=${durationMs}ms status=${status}${
      error ? ` error=${error}` : ""
    }`,
  );

  return { sourceId, status, fetched, inserted, skipped, durationMs, error, cursor };
}

export async function runAll(
  options: { http?: HttpClient; maxItems?: number; log?: (message: string) => void } = {},
): Promise<RunSummary[]> {
  ensureSources();
  // kind 没有对应 collector 的源（例如 kind="ingest"，由本机采集器回传）不参与服务器调度，
  // 否则每轮都会产生 "no collector registered" 的无意义失败。
  const rows = all<{ id: string; kind: string }>("SELECT id, kind FROM sources WHERE enabled = 1 ORDER BY id")
    .filter((r) => BY_KIND.has(r.kind))
    .map((r) => r.id);
  const filter = config.enabledSources;
  const targets = filter.length ? rows.filter((id) => filter.includes(id)) : rows;
  const out: RunSummary[] = [];
  for (const id of targets) {
    try {
      out.push(await runSource(id, options));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      (options.log ?? console.log)(`[collect] ${id} 启动失败: ${message}`);
      out.push({ sourceId: id, status: "failed", fetched: 0, inserted: 0, skipped: 0, durationMs: 0, error: message, cursor: null });
    }
  }
    // 源之间留间隔：Reddit 一类站点对同 IP 连续请求会返回 429
    if (config.sourceGapMs > 0) await new Promise((r) => setTimeout(r, config.sourceGapMs));
  return out;
}

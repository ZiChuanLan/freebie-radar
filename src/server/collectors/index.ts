import { aiEnabled, config } from "../config.ts";
import { all, get, run, tx } from "../db.ts";
import { enrichItem, mergeKey } from "../enrich/index.ts";
import { reviewItems, shouldReview, type AiVerdict } from "../enrich/ai.ts";
import { enqueueForAi } from "../enrich/ai-queue.ts";
import { guessObtain, type ObtainMode } from "../enrich/obtain.ts";
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
import { cheapsharkCollector } from "./cheapshark.ts";
import { bskyCollector } from "./bsky.ts";
import type { Collector, RawItem, SourceSeed } from "./types.ts";

export const COLLECTORS: Collector[] = [
  mockCollector, linuxdoCollector, v2exCollector, githubCollector, rssCollector, telegramCollector,
  gamerpowerCollector, epicCollector, gogCollector, steamCollector, cheapsharkCollector, bskyCollector,
];
const BY_KIND = new Map(COLLECTORS.map((c) => [c.kind, c]));

/** 内置源清单；collector 落地后在此追加。 */
export const SEEDS: SourceSeed[] = [
  { id: "linuxdo-welfare", name: "LINUX DO · 福利羊毛", kind: "linuxdo", enabled: true, intervalSec: 90, config: { categoryId: 36, rssSlug: "welfare", categoryName: "福利羊毛" } },
  { id: "linuxdo-resource", name: "LINUX DO · 资源荟萃", kind: "linuxdo", enabled: true, intervalSec: 180, config: { categoryId: 14, rssSlug: "resource", categoryName: "资源荟萃" } },
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
  // === 第二/三批补充：游戏喜加一 / V2EX / NodeSeek / 软件限免 / AI / Bluesky(X镜像) / TG 频道 ===
  { id: "cheapshark-free", name: "CheapShark · 免费与 ≤$1 游戏", kind: "cheapshark", enabled: true, intervalSec: 900, config: { upperPrice: 1, pageSize: 40 } },
  { id: "rss-isthereanydeal", name: "IsThereAnyDeal · 喜加一", kind: "rss", enabled: true, intervalSec: 900, config: { feeds: [{ id: "itad", url: "https://isthereanydeal.com/feeds/US/giveaways.rss", limit: 30 }] } },
  { id: "rss-indiegamebundles", name: "IndieGameBundles · 免费游戏", kind: "rss", enabled: true, intervalSec: 1800, config: { feeds: [{ id: "indiegamebundles", url: "https://www.indiegamebundles.com/category/free/feed/", limit: 25 }] } },
  { id: "rss-ggdeals", name: "GG.deals · 免费与动态", kind: "rss", enabled: true, intervalSec: 1800, config: { feeds: [{ id: "ggdeals", url: "https://gg.deals/news/feed/", limit: 25 }] } },
  { id: "rss-reddit-freegamesonsteam", name: "Reddit · FreeGamesOnSteam", kind: "rss", enabled: true, intervalSec: 1800, config: { feeds: [{ id: "freegamesonsteam", url: "https://www.reddit.com/r/FreeGamesOnSteam/hot.rss", limit: 30 }] } },
  { id: "tg-freegames", name: "TG · 免费游戏情报", kind: "telegram", enabled: true, intervalSec: 300, config: { channels: ["FreeGamesInfo", "freegamesnews"] } },
  { id: "tg-cn-deals", name: "TG · 中文科技/VPS/羊毛", kind: "telegram", enabled: true, intervalSec: 300, config: { channels: ["nodeseekc", "zaihuapd", "vps_offers"] } },
  { id: "bsky-gamedeals", name: "Bluesky · 游戏限免大号", kind: "bsky", enabled: true, intervalSec: 600, config: { actors: ["freegamefindings.bsky.social", "freegamealert.bsky.social", "wario64.bsky.social", "cheapassgamer.com", "dekudeals.com", "steamdb.bsky.social"], limitPerActor: 10 } },
  { id: "bsky-plugins", name: "Bluesky · 免费插件与综合", kind: "bsky", enabled: true, intervalSec: 1800, config: { actors: ["plugindeals.net", "frugalfreebies.bsky.social", "freebies.bsky.social"], limitPerActor: 10 } },
  { id: "v2ex-deals", name: "V2EX · 优惠信息", kind: "v2ex", enabled: true, intervalSec: 300, config: { node: "deals" } },
  { id: "v2ex-share", name: "V2EX · 分享发现", kind: "v2ex", enabled: true, intervalSec: 600, config: { node: "share" } },
  // 纯广告节点：24 条里 9 条被判「福利」，全是代理/中转服务商的引流帖，默认关闭
  { id: "v2ex-promotions", name: "V2EX · 推广与注册送", kind: "v2ex", enabled: false, intervalSec: 600, config: { node: "promotions" } },
  { id: "v2ex-cloud", name: "V2EX · 云计算", kind: "v2ex", enabled: true, intervalSec: 1800, config: { node: "cloud" } },
  { id: "rss-nodeseek", name: "NodeSeek · 官方动态", kind: "rss", enabled: true, intervalSec: 180, config: { feeds: [{ id: "nodeseek", url: "https://rss.nodeseek.com/", limit: 30 }] } },
  { id: "rss-lowendbox", name: "LowEndBox · VPS 优惠", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "lowendbox", url: "https://lowendbox.com/feed/", limit: 20 }] } },
  { id: "rss-sharewareonsale", name: "SharewareOnSale · 正版限免", kind: "rss", enabled: true, intervalSec: 1800, config: { feeds: [{ id: "sharewareonsale", url: "https://sharewareonsale.com/feed", limit: 25 }] } },
  { id: "rss-tickcoupon", name: "TickCoupon · 终身软件限免", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "tickcoupon", url: "https://giveaway.tickcoupon.com/feed/", limit: 20 }] } },
  { id: "rss-iplaysoft", name: "异次元软件世界", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "iplaysoft", url: "https://www.iplaysoft.com/feed", limit: 25 }] } },
  { id: "rss-iapps", name: "翻应用 · App 工具", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "iapps", url: "https://www.iapps.me/feed", limit: 20 }] } },
  { id: "rss-ruanyifeng", name: "阮一峰 · 科技爱好者周刊", kind: "rss", enabled: true, intervalSec: 21600, config: { feeds: [{ id: "ruanyifeng", url: "https://www.ruanyifeng.com/blog/atom.xml", limit: 10 }] } },
  { id: "rss-vonbeau", name: "VonBeau · 免费样品", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "vonbeau", url: "https://www.vonbeau.com/feed/", limit: 30 }] } },
  { id: "rss-hip2save", name: "Hip2Save · 美国羊毛", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "hip2save", url: "https://hip2save.com/feed/", limit: 30 }] } },
  { id: "rss-ozbargain", name: "OzBargain · 澳区好价", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "ozbargain", url: "https://www.ozbargain.com.au/feed", limit: 25 }] } },
  { id: "github-public-apis", name: "GitHub · 免费公开 API", kind: "github-readme", enabled: true, intervalSec: 21600, config: { repos: [{ repo: "public-apis/public-apis", limit: 40 }] } },
  { id: "github-awesome-ai", name: "GitHub · AI 工具清单", kind: "github-readme", enabled: true, intervalSec: 21600, config: { repos: [{ repo: "mahseema/awesome-ai-tools", limit: 40 }] } },
  { id: "github-selfhosted", name: "GitHub · 开源自托管清单", kind: "github-readme", enabled: true, intervalSec: 21600, config: { repos: [{ repo: "awesome-selfhosted/awesome-selfhosted", limit: 40 }] } },
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
    // 本机采集回传的条目同样走异步二审队列，不阻塞响应
    if (shouldReview() && saved.fresh.length) {
      enqueueForAi(
        saved.fresh.map((f) => ({ itemId: f.id, url: f.url, title: f.title, summary: f.summary ?? "" })),
      );
    }
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
  /** 归一化后的人民币价格；null 表示未知 */
  price?: number | null;
  /** 明确免费 */
  isFree?: boolean;
  /** AI 二审结论：false 表示判定不是福利，任何情况下都不推送 */
  aiKeep?: boolean | null;
  /** 归一化分类，用于推送分类过滤 */
  category?: string | null;
  /** 获取方式：free 才算完全白嫖，抽奖/试用/推广默认不推 */
  obtain?: string | null;
  /** 摘要文本，用于订阅关键词匹配 */
  summary?: string | null;
};

/** AI 给了 obtain 就用 AI 的，没给就用关键词兜底。 */
function obtainOf(e: { title: string; summary?: string | null }, verdict?: AiVerdict | null): ObtainMode {
  return verdict?.obtain ?? guessObtain(e.title, e.summary ?? "");
}

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

      const existing = get<{ id: number; ai_keep: number | null }>(
        "SELECT id, ai_keep FROM items WHERE source_id = ? AND external_id = ?",
        sourceId,
        e.externalId,
      );
      if (existing) {
        const nextScore = verdict
          ? score
          : existing.ai_keep === 0
            ? Math.round(e.score * 0.5)
            : e.score;
        run(
          `UPDATE items SET url = ?, url_key = ?, title = ?, title_key = ?, summary = ?, author = ?, category = ?,
             tags = ?, score = ?, expires_at = ?, published_at = ?, raw = ?, last_seen_at = ?,
             price = ?, is_free = ?,
             ai = COALESCE(?, ai),
             obtain = COALESCE(?, obtain),
             ai_keep = COALESCE(?, ai_keep),
             status = CASE WHEN status = 'ignored' THEN 'ignored' ELSE ? END
           WHERE id = ?`,
          e.url,
          e.urlKey,
          e.title,
          mergeKey(e.title),
          e.summary ?? "",
          e.author ?? null,
          e.category,
          JSON.stringify(e.tags),
          nextScore,
          e.expiresAt,
          e.publishedAt ?? null,
          JSON.stringify(e.raw ?? {}),
          now,
          e.price,
          e.isFree ? 1 : 0,
          aiJson,
          verdict?.obtain ?? null,
          verdict ? (verdict.keep ? 1 : 0) : null,
          status,
          existing.id,
        );
        skipped += 1;
        continue;
      }
      try {
        const res = run(
          `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, summary, author, category,
             tags, score, expires_at, published_at, raw, status, ai, obtain, ai_keep, content, codes, price, is_free, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          sourceId,
          e.externalId,
          e.url,
          e.urlKey,
          e.title,
          mergeKey(e.title),
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
          obtainOf(e, verdict),
          verdict ? (verdict.keep ? 1 : 0) : null,
          e.content ?? null,
          JSON.stringify(e.codes),
          e.price,
          e.isFree ? 1 : 0,
          now,
          now,
        );
        inserted += 1;
        fresh.push({
          id: Number(res.lastInsertRowid),
          title: e.title,
          url: e.url,
          score,
          codes: e.codes,
          expiresAt: e.expiresAt,
          price: e.price,
          isFree: e.isFree,
          aiKeep: verdict ? verdict.keep : null,
          category: verdict?.category || e.category,
          summary: e.summary ?? null,
        });
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
    // 不再同步等 AI 二审：MG 是反代网页，单批 1.6-9 秒、偶发 49 秒，
    // 同步送审会把 linux.do 一轮采集拖到 33 秒以上，送码帖早被抢光。
    // 改成：规则判定 → 立即入库 → 立即推送 → 后台队列补 AI 结论。
    const saved = persist(sourceId, result.items, null);
    inserted = saved.inserted;
    skipped = saved.skipped;
    // 有新条目就立刻判断是否值得即时推送（送码类 1 分钟就没了）
    if (saved.fresh.length) await pushInstant(sourceId, saved.fresh);
    // 新条目丢进 AI 队列，结论回填到 items.ai_keep，供列表筛选与后续推送用
    if (shouldReview() && saved.fresh.length) {
      enqueueForAi(
        saved.fresh.map((f) => ({
          itemId: f.id,
          url: f.url,
          title: f.title,
          summary: f.summary ?? "",
        })),
      );
      log(`[${sourceId}] ${saved.fresh.length} 条入 AI 待审队列`);
    }
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
    // 源之间留间隔：Reddit 一类站点对同 IP 连续请求会返回 429
    if (config.sourceGapMs > 0) await new Promise((r) => setTimeout(r, config.sourceGapMs));
  }
  return out;
}

export function addCustomRssSource(input: { id?: string; name: string; url: string; intervalSec?: number }): string {
  const cleanUrl = input.url.trim();
  const slug = (input.id || input.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  const id = slug.startsWith("rss-") ? slug : "rss-" + (slug || Date.now());
  const feedId = id.replace(/^rss-/, "");
  run(
    `INSERT INTO sources (id, name, kind, enabled, config, interval_sec, created_at)
     VALUES (?, ?, 'rss', 1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, config = excluded.config, interval_sec = excluded.interval_sec, enabled = 1`,
    id,
    input.name.trim(),
    JSON.stringify({ feeds: [{ id: feedId, url: cleanUrl, limit: 30 }] }),
    input.intervalSec ?? 1800,
    new Date().toISOString(),
  );
  return id;
}

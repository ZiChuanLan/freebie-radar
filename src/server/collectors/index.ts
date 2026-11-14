import { aiEnabled, config, pushEnabled } from "../config.ts";
import { all, get, isZhText, run, tx } from "../db.ts";
import { enrichItem, FREEBIE_ONLY_SOURCES, resolveKind, type ContentKind } from "../enrich/index.ts";
import { calibrateScoreByObtain, resolveDbMergeKey } from "../enrich/alias.ts";
import { getAiSettings, matchesEntryNoise, shouldPassSourceToAi, shouldReview, type AiVerdict } from "../enrich/ai.ts";
import { enqueueForAi, reviewFreshNow, setPostReviewHandler } from "../enrich/ai-queue.ts";
import { guessObtain, type ObtainMode } from "../enrich/obtain.ts";
import { getRetention } from "../retention.ts";
import { getPushSettings, pushInstant, pushReviewedByIds } from "../instant.ts";

setPostReviewHandler(pushReviewedByIds);
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
import { openrouterCollector } from "./openrouter.ts";
import { bskyCollector } from "./bsky.ts";
import type { Collector, RawItem, SourceSeed } from "./types.ts";

export const COLLECTORS: Collector[] = [
  mockCollector, linuxdoCollector, v2exCollector, githubCollector, rssCollector, telegramCollector,
  gamerpowerCollector, epicCollector, gogCollector, steamCollector, cheapsharkCollector, bskyCollector, openrouterCollector,
];
const BY_KIND = new Map(COLLECTORS.map((c) => [c.kind, c]));

/** 内置源清单；collector 落地后在此追加。 */
export const SEEDS: SourceSeed[] = [
  { id: "linuxdo-welfare", name: "LINUX DO · 福利羊毛", kind: "linuxdo", enabled: true, intervalSec: 90, config: { categoryId: 36, rssSlug: "welfare", categoryName: "福利羊毛" } },
  { id: "linuxdo-resource", name: "LINUX DO · 资源荟萃", kind: "linuxdo", enabled: false, intervalSec: 180, config: { categoryId: 14, rssSlug: "resource", categoryName: "资源荟萃" } },
  { id: "v2ex-free", name: "V2EX · 免费赠送", kind: "v2ex", enabled: true, intervalSec: 120, config: { node: "free" } },
  { id: "v2ex-deals", name: "V2EX · 优惠信息", kind: "v2ex", enabled: true, intervalSec: 300, config: { node: "deals" } },
  { id: "v2ex-cloud", name: "V2EX · 云计算", kind: "v2ex", enabled: false, intervalSec: 1800, config: { node: "cloud" } },
  { id: "v2ex-share", name: "V2EX · 分享发现", kind: "v2ex", enabled: false, intervalSec: 600, config: { node: "share" } },
  { id: "v2ex-promotions", name: "V2EX · 推广与注册送", kind: "v2ex", enabled: false, intervalSec: 600, config: { node: "promotions" } },

  // === AI / 云 / 开发者福利 ===
  { id: "openrouter-free", name: "OpenRouter · 新免费大模型", kind: "openrouter", enabled: true, intervalSec: 3600, config: { maxAgeDays: 14 } },
  {
    id: "rss-nodeseek",
    name: "NodeSeek · 福利情报",
    kind: "rss",
    enabled: true,
    intervalSec: 300,
    config: {
      feeds: [
        {
          id: "nodeseek",
          url: "https://rss.nodeseek.com/",
          limit: 40,
          includeCategories: ["info", "promotion", "trade"],
        },
      ],
    },
  },
  { id: "rss-lowendbox", name: "LowEndBox · VPS 优惠", kind: "rss", enabled: false, intervalSec: 3600, config: { feeds: [{ id: "lowendbox", url: "https://lowendbox.com/feed/", limit: 20 }] } },

  // === 游戏限免 / Key / 礼包 ===
  { id: "epic-free", name: "Epic Games · 本周喜加一", kind: "epic", enabled: true, intervalSec: 3600, config: { includeUpcoming: false } },
  { id: "steam-free", name: "Steam · 限时免费", kind: "steam", enabled: true, intervalSec: 1800, config: { count: 50 } },
  { id: "gamerpower", name: "GamerPower · 免费游戏聚合", kind: "gamerpower", enabled: true, intervalSec: 900, config: { query: "type=game", limit: 60 } },
  { id: "gamerpower-loot", name: "GamerPower · 免费礼包与 Key", kind: "gamerpower", enabled: true, intervalSec: 1800, config: { query: "type=loot", limit: 40 } },
  { id: "cheapshark-free", name: "CheapShark · 免费与 ≤$1 游戏", kind: "cheapshark", enabled: true, intervalSec: 900, config: { upperPrice: 1, pageSize: 40 } },
  { id: "rss-itch-free", name: "itch.io · 100% 限免游戏", kind: "rss", enabled: true, intervalSec: 1800, config: { feeds: [{ id: "itch-free", url: "https://itch.io/games/on-sale.xml", limit: 25, only100Off: true }] } },
  { id: "rss-isthereanydeal", name: "IsThereAnyDeal · 喜加一", kind: "rss", enabled: true, intervalSec: 900, config: { feeds: [{ id: "itad", url: "https://isthereanydeal.com/feeds/US/giveaways.rss", limit: 30 }] } },
  { id: "rss-indiegamebundles", name: "IndieGameBundles · 免费游戏", kind: "rss", enabled: true, intervalSec: 1800, config: { feeds: [{ id: "indiegamebundles", url: "https://www.indiegamebundles.com/category/free/feed/", limit: 25 }] } },
  { id: "rss-freesteamkeys", name: "FreeSteamKeys · Steam 限免", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "freesteamkeys", url: "https://freesteamkeys.com/feed/", limit: 25 }] } },
  { id: "rss-ggdeals", name: "GG.deals · 免费与动态", kind: "rss", enabled: true, intervalSec: 1800, config: { feeds: [{ id: "ggdeals", url: "https://gg.deals/news/feed/", limit: 25 }] } },
  { id: "rss-keylol", name: "其乐 Keylol", kind: "rss", enabled: true, intervalSec: 1800, config: { feeds: [{ id: "keylol", url: "https://keylol.com/forum.php?mod=rss", limit: 30 }] } },
  { id: "tg-freegames", name: "TG · 免费游戏情报", kind: "telegram", enabled: true, intervalSec: 300, config: { channels: ["FreeGamesInfo", "freegamesnews"] } },
  { id: "gog-free", name: "GOG · 限时免费", kind: "gog", enabled: false, config: {} },

  // === 正版软件限免 / 工具 ===
  { id: "rss-giveawayoftheday", name: "Giveaway of the Day · 每日限免软件", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "giveawayoftheday", url: "https://www.giveawayoftheday.com/feed/", limit: 20 }] } },
  { id: "rss-tickcoupon", name: "TickCoupon · 终身软件限免", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "tickcoupon", url: "https://giveaway.tickcoupon.com/feed/", limit: 20 }] } },
  {
    id: "rss-sharewareonsale",
    name: "SharewareOnSale · 100% 限免",
    kind: "rss",
    enabled: true,
    intervalSec: 1800,
    config: { feeds: [{ id: "sharewareonsale", url: "https://sharewareonsale.com/feed", limit: 25, titleKeywords: ["100% discount", "free"] }] },
  },
  { id: "rss-ghxi", name: "果核剥壳 · 免费软件资源", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "ghxi", url: "https://www.ghxi.com/feed", limit: 20 }] } },
  { id: "rss-iplaysoft", name: "异次元软件世界", kind: "rss", enabled: false, intervalSec: 3600, config: { feeds: [{ id: "iplaysoft", url: "https://www.iplaysoft.com/feed", limit: 25 }] } },

  // === Reddit 高纯度白嫖社区（适度拉长间隔防 429）===
  { id: "rss-reddit-freegames", name: "Reddit · FreeGameFindings", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "freegamefindings", url: "https://www.reddit.com/r/FreeGameFindings/hot.rss", limit: 30 }] } },
  { id: "rss-reddit-freebies", name: "Reddit · freebies", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "freebies", url: "https://www.reddit.com/r/freebies/hot.rss", limit: 25 }] } },
  { id: "rss-reddit-efreebies", name: "Reddit · eFreebies", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "efreebies", url: "https://www.reddit.com/r/efreebies/hot.rss", limit: 25 }] } },
  { id: "rss-reddit-apphookup", name: "Reddit · AppHookup（App 限免）", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "apphookup", url: "https://www.reddit.com/r/AppHookup/hot.rss", limit: 25 }] } },
  { id: "rss-reddit-freeebooks", name: "Reddit · FreeEBOOKS", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "freeebooks", url: "https://www.reddit.com/r/FreeEBOOKS/hot.rss", limit: 25 }] } },
  { id: "rss-reddit-freegamesonsteam", name: "Reddit · FreeGamesOnSteam", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "freegamesonsteam", url: "https://www.reddit.com/r/FreeGamesOnSteam/hot.rss", limit: 25 }] } },
  { id: "rss-reddit-gamedeals", name: "Reddit · GameDeals（含打折）", kind: "rss", enabled: false, intervalSec: 3600, config: { feeds: [{ id: "gamedeals", url: "https://www.reddit.com/r/GameDeals/hot.rss", limit: 30 }] } },
  { id: "rss-reddit-googleplay", name: "Reddit · GooglePlayDeals", kind: "rss", enabled: false, intervalSec: 3600, config: { feeds: [{ id: "googleplaydeals", url: "https://www.reddit.com/r/googleplaydeals/hot.rss", limit: 30 }] } },

  // === 综合样品与地区好价 ===
  { id: "rss-freebieshark", name: "FreebieShark 免费样品", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "freebieshark", url: "https://www.freebieshark.com/feed/", limit: 25 }] } },
  { id: "rss-heyitsfree", name: "HeyItsFree 免费样品", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "heyitsfree", url: "https://heyitsfree.net/feed/", limit: 30 }] } },
  { id: "rss-ozbargain", name: "OzBargain · 澳区免费好价", kind: "rss", enabled: true, intervalSec: 3600, config: { feeds: [{ id: "ozbargain", url: "https://www.ozbargain.com.au/feed", limit: 25 }] } },

  // === 登录态站点（零 Cookie 上传 · 本机回环或油猴脚本回传）===
  { id: "zhihu-search", name: "知乎 · 福利搜索", kind: "ingest", enabled: true, config: { keyword: "免费领取" } },
  { id: "xhs-search", name: "小红书 · 福利搜索", kind: "ingest", enabled: true, config: { keyword: "免费领取" } },
  { id: "xiaoheihe-search", name: "小黑盒 · 福利搜索", kind: "ingest", enabled: true, config: { keyword: "免费" } },

  // === 按需选开的低纯度 / 需代理 / 扩展源（默认关闭以保持低噪与轻量化）===
  { id: "tg-cn-deals", name: "TG · 中文科技/VPS/羊毛", kind: "telegram", enabled: false, intervalSec: 300, config: { channels: ["zaihuapd", "vps_offers"] } },
  { id: "bsky-gamedeals", name: "Bluesky · 游戏限免大号", kind: "bsky", enabled: false, intervalSec: 1800, config: { actors: ["freegamefindings.bsky.social", "freegamealert.bsky.social", "wario64.bsky.social", "cheapassgamer.com", "dekudeals.com", "steamdb.bsky.social"], limitPerActor: 10 } },
  { id: "bsky-plugins", name: "Bluesky · 免费插件与综合", kind: "bsky", enabled: false, intervalSec: 1800, config: { actors: ["plugindeals.net", "frugalfreebies.bsky.social", "freebies.bsky.social"], limitPerActor: 10 } },
  { id: "rss-hip2save", name: "Hip2Save · 美国优惠", kind: "rss", enabled: false, intervalSec: 3600, config: { feeds: [{ id: "hip2save", url: "https://hip2save.com/feed/", limit: 30 }] } },
  { id: "rss-vonbeau", name: "VonBeau · 免费样品（需过盾）", kind: "rss", enabled: false, intervalSec: 3600, config: { feeds: [{ id: "vonbeau", url: "https://www.vonbeau.com/feed/", limit: 30 }] } },
  { id: "rss-slickdeals", name: "Slickdeals（需过盾）", kind: "rss", enabled: false, intervalSec: 3600, config: { feeds: [{ id: "slickdeals", url: "https://slickdeals.net/newsearch.php?rss=1&searcharea=deals&searchin=first", limit: 30 }] } },
  { id: "rss-appinn", name: "小众软件 Appinn", kind: "rss", enabled: false, config: { feeds: [{ id: "appinn", url: "https://www.appinn.com/feed/", limit: 20 }] } },
  { id: "rss-sspai", name: "少数派", kind: "rss", enabled: false, config: { feeds: [{ id: "sspai", url: "https://sspai.com/feed", limit: 20 }] } },
  { id: "rss-ithome", name: "IT之家", kind: "rss", enabled: false, config: { feeds: [{ id: "ithome", url: "https://www.ithome.com/rss/", limit: 25 }] } },
  { id: "rss-smzdm", name: "什么值得买", kind: "rss", enabled: false, config: { feeds: [{ id: "smzdm", url: "https://www.smzdm.com/rss/", limit: 20 }] } },
  { id: "rss-fuliba", name: "福利吧", kind: "rss", enabled: false, config: { feeds: [{ id: "fuliba", url: "https://fuliba.net/feed", limit: 30 }] } },
  { id: "rss-52pojie", name: "吾爱破解", kind: "rss", enabled: false, config: { feeds: [{ id: "52pojie", url: "https://www.52pojie.cn/forum.php?mod=rss", limit: 20 }] } },
  { id: "rss-9to5toys", name: "9to5Toys 优惠", kind: "rss", enabled: false, config: { feeds: [{ id: "9to5toys", url: "https://9to5toys.com/feed/", limit: 25 }] } },
  { id: "rss-producthunt", name: "Product Hunt", kind: "rss", enabled: false, config: { feeds: [{ id: "producthunt", url: "https://www.producthunt.com/feed", limit: 25 }] } },
  { id: "rss-hnrss", name: "Hacker News（100+ 分）", kind: "rss", enabled: false, config: { feeds: [{ id: "hnrss", url: "https://hnrss.org/frontpage?points=100", limit: 25 }] } },
  { id: "rss-ruanyifeng", name: "阮一峰 · 科技爱好者周刊", kind: "rss", enabled: false, intervalSec: 21600, config: { feeds: [{ id: "ruanyifeng", url: "https://www.ruanyifeng.com/blog/atom.xml", limit: 10 }] } },
  { id: "github-free-for-dev", name: "GitHub · free-for-dev", kind: "github-readme", enabled: false, config: { repos: [{ repo: "ripienaar/free-for-dev", limit: 60 }] } },
  { id: "github-public-apis", name: "GitHub · 免费公开 API", kind: "github-readme", enabled: false, config: { repos: [{ repo: "public-apis/public-apis", limit: 40 }] } },
  { id: "github-awesome-ai", name: "GitHub · AI 工具清单", kind: "github-readme", enabled: false, config: { repos: [{ repo: "mahseema/awesome-ai-tools", limit: 40 }] } },
  { id: "github-selfhosted", name: "GitHub · 开源自托管清单", kind: "github-readme", enabled: false, config: { repos: [{ repo: "awesome-selfhosted/awesome-selfhosted", limit: 40 }] } },
  { id: "tg-channels", name: "Telegram 羊毛频道", kind: "telegram", enabled: false, config: { channels: [] } },
];

/** 供本机 Playwright 采集器把结果回传到服务器；同时补写 runs / sources 状态，保证 /status 有记录。 */
/**
 * 新条目一审预筛、AI 语义审核与推送调度：
 * - 规则初筛（matchesEntryNoise）：开关开启时先过滤求助/更新补丁/自定义噪音词
 * - 按源分流（shouldPassSourceToAi）：支持纯白嫖专源免审直通、或排除/仅审指定源
 * - 推送时机由 PushSettings.pushTiming 决定：
 *   - wait_ai（默认）：前 syncPrePushLimit 条同步过 AI 后再推，其余进后台队列并在审完后自动补推
 *   - instant_first（极速抢码）：按规则先推，需要审的进后台队列补审（审完通过且未推过可自动补推）
 */
async function dispatchFresh(
  sourceId: string,
  fresh: FreshItem[],
  log: (msg: string) => void = console.log,
): Promise<void> {
  if (!fresh.length) return;
  const reviewOn = shouldReview();
  const aiSettings = reviewOn ? getAiSettings() : null;
  const pushSettings = getPushSettings();

  if (!reviewOn || !aiSettings) {
    await pushInstant(sourceId, fresh);
    return;
  }

  const nonNoise = fresh.filter((f) => !matchesEntryNoise(f.title, aiSettings));
  if (!nonNoise.length) return;

  if (!shouldPassSourceToAi(sourceId, aiSettings)) {
    if (aiSettings.skipFreebieSources && FREEBIE_ONLY_SOURCES.has(sourceId)) {
      const autoReason = "纯白嫖专源免审直通";
      tx(() => {
        for (const f of nonNoise) {
          const verdict = {
            index: 0,
            keep: true,
            kind: "freebie" as const,
            category: f.category ?? "other",
            obtain: (f.obtain as ObtainMode | undefined) ?? "free",
            quality: 4,
            reason: autoReason,
          };
          f.aiKeep = true;
          f.kind = "freebie";
          f.aiReason = autoReason;
          run(
            "UPDATE items SET ai = ?, ai_keep = 1, kind = 'freebie', ai_quality = 4, obtain = COALESCE(obtain, 'free') WHERE id = ? AND ai IS NULL",
            JSON.stringify(verdict),
            f.id,
          );
        }
      });
      log(`[${sourceId}] 白嫖专源免送 AI，${nonNoise.length} 条直接放行`);
    }
    await pushInstant(sourceId, nonNoise);
    return;
  }

  if (pushSettings.pushTiming === "wait_ai") {
    const ranked = [...nonNoise].sort(
      (a, b) => (b.codes.length > 0 ? 1 : 0) - (a.codes.length > 0 ? 1 : 0) || b.score - a.score,
    );
    const limit = pushSettings.syncPrePushLimit;
    const syncBatch = ranked.slice(0, limit);
    const restBatch = ranked.slice(limit);
    const verdicts = await reviewFreshNow(
      syncBatch.map((f) => ({ itemId: f.id, sourceId, url: f.url, title: f.title, summary: f.summary ?? "" })),
    );
    for (const f of syncBatch) {
      const v = verdicts.get(f.id);
      if (!v) continue;
      f.aiKeep = v.aiKeep;
      f.kind = v.kind;
      if (v.category) f.category = v.category;
      if (v.obtain) f.obtain = v.obtain;
      if (v.reason) f.aiReason = v.reason;
      f.score = v.score;
    }
    log(`[${sourceId}] 推送前 AI 审核 ${syncBatch.length} 条（拦截 ${syncBatch.filter((f) => f.aiKeep === false).length} 条）`);
    await pushInstant(sourceId, syncBatch);
    if (restBatch.length) {
      enqueueForAi(
        restBatch.map((f) => ({
          itemId: f.id,
          sourceId,
          url: f.url,
          title: f.title,
          summary: f.summary ?? "",
          pushOnApprove: pushSettings.pushAfterBackfill,
        })),
      );
      log(`[${sourceId}] 其余 ${restBatch.length} 条入 AI 后台队列`);
    }
    return;
  }

  await pushInstant(sourceId, fresh);
  enqueueForAi(
    nonNoise.map((f) => ({
      itemId: f.id,
      sourceId,
      url: f.url,
      title: f.title,
      summary: f.summary ?? "",
      pushOnApprove: pushSettings.pushAfterBackfill,
    })),
  );
  log(`[${sourceId}] ${nonNoise.length}/${fresh.length} 条入 AI 异步审核队列`);
}
export function ingestItems(sourceId: string, items: RawItem[]): { inserted: number; skipped: number } {
  ensureSources();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runRow = run("INSERT INTO runs (source_id, started_at, status) VALUES (?, ?, 'running')", sourceId, startedAt);
  const runId = Number(runRow.lastInsertRowid);
  try {
    const saved = persist(sourceId, items, null);
    if (saved.fresh.length && (shouldReview() || pushEnabled)) {
      void dispatchFresh(sourceId, saved.fresh).catch(() => {});
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
  // 老库平滑升级：仅当历史源仍是旧版默认 config 时刷新过滤规则，绝不覆盖用户手动修改的配置与启停开关
  const upgrades: Array<[string, string, string]> = [
    [
      "rss-nodeseek",
      JSON.stringify({ feeds: [{ id: "nodeseek", url: "https://rss.nodeseek.com/", limit: 30 }] }),
      JSON.stringify(SEEDS.find((s) => s.id === "rss-nodeseek")?.config ?? {}),
    ],
    [
      "rss-nodeseek",
      JSON.stringify({
        feeds: [{
          id: "nodeseek",
          url: "https://rss.nodeseek.com/",
          limit: 30,
          includeCategories: ["info", "promotion"],
          titleKeywords: ["免费", "白嫖", "cdk", "兑换", "限免", "福利", "赠", "领", "送", "free", "0元"],
        }],
      }),
      JSON.stringify(SEEDS.find((s) => s.id === "rss-nodeseek")?.config ?? {}),
    ],
    [
      "rss-nodeseek",
      JSON.stringify({ feeds: [{ id: "nodeseek", url: "https://rss.nodeseek.com/", limit: 30, includeCategories: ["info", "promotion"] }] }),
      JSON.stringify(SEEDS.find((s) => s.id === "rss-nodeseek")?.config ?? {}),
    ],
    [
      "rss-sharewareonsale",
      JSON.stringify({ feeds: [{ id: "sharewareonsale", url: "https://sharewareonsale.com/feed", limit: 25 }] }),
      JSON.stringify(SEEDS.find((s) => s.id === "rss-sharewareonsale")?.config ?? {}),
    ],
  ];
  for (const [id, oldCfg, nextCfg] of upgrades) {
    run("UPDATE sources SET config = ? WHERE id = ? AND config = ?", nextCfg, id, oldCfg);
  }
  run("DELETE FROM sources WHERE id = 'mock-source' AND NOT EXISTS (SELECT 1 FROM items WHERE source_id = 'mock-source')");
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
  /** AI 语义审核结论：false 表示判定不是福利 */
  aiKeep?: boolean | null;
  /** AI 一句话理由，用于推送展示 */
  aiReason?: string | null;
  /** 归一化分类，用于推送分类过滤 */
  /** 内容形态：freebie / deal / opensource / info / noise */
  kind?: ContentKind | string | null;
  category?: string | null;
  /** 获取方式：free 才算完全白嫖，抽奖/试用/推广默认不推 */
  obtain?: string | null;
  /** 摘要文本，用于订阅关键词匹配 */
  summary?: string | null;
  /** 发布时间，用于拦截历史旧帖重复推送 */
  publishedAt?: string | null;
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
  const staleCutoffMs = Date.now() - Math.max(getRetention().keptDays, 7) * 86_400_000;
  tx(() => {
    for (let index = 0; index < items.length; index += 1) {
      const raw = items[index]!;
      const e = enrichItem(raw, sourceId);
      if (!e) {
        skipped += 1;
        continue;
      }

      const verdict = aiMap?.get(index) ?? null;
      const effectiveObtain = obtainOf(e, verdict);
      const effectiveKind = verdict
        ? resolveKind(verdict.kind, verdict.keep, {
            title: e.title,
            summary: e.summary ?? undefined,
            sourceId,
            category: verdict.category || e.category,
            obtain: effectiveObtain,
            isFree: e.isFree,
            price: e.price,
            freebieOnlySource: FREEBIE_ONLY_SOURCES.has(sourceId),
          })
        : e.kind;
      const effectiveQuality =
        typeof verdict?.quality === "number" && Number.isFinite(verdict.quality)
          ? Math.min(5, Math.max(1, Math.round(verdict.quality)))
          : null;
      const score = calibrateScoreByObtain(
        e.score,
        effectiveObtain,
        verdict ? verdict.keep : null,
        effectiveQuality,
        effectiveKind,
      );
      const aiJson = verdict ? JSON.stringify({ ...verdict, kind: effectiveKind }) : null;
      const status = e.keep ? "active" : "expired";
      const titleKey = resolveDbMergeKey(e.title);

      const existing = get<{
        id: number;
        title: string;
        ai_keep: number | null;
        obtain: string | null;
        ai: string | null;
        kind: string | null;
        ai_quality: number | null;
      }>(
        "SELECT id, title, ai_keep, obtain, ai, kind, ai_quality FROM items WHERE source_id = ? AND external_id = ?",
        sourceId,
        e.externalId,
      );
      if (existing) {
        let existingQuality: number | null = existing.ai_quality ?? null;
        if (existingQuality === null && existing.ai) {
          try {
            const q = (JSON.parse(existing.ai) as { quality?: number }).quality;
            if (typeof q === "number") existingQuality = q;
          } catch {
            existingQuality = null;
          }
        }
        const promotedFromUpcoming =
          existing.ai_keep === 0 &&
          /即将免费|预告/.test(existing.title) &&
          /本周免费|限时免费/.test(e.title);
        if (promotedFromUpcoming) {
          run("UPDATE items SET ai = NULL, ai_keep = NULL, ai_quality = NULL WHERE id = ?", existing.id);
          existing.ai = null;
          existing.ai_keep = null;
          existing.kind = null;
        }
        const nextKind = verdict ? effectiveKind : existing.ai_keep === null ? e.kind : existing.kind;
        const nextScore = verdict
          ? score
          : calibrateScoreByObtain(
              e.score,
              existing.obtain,
              existing.ai_keep === null ? null : existing.ai_keep === 1,
              existingQuality,
              nextKind,
            );
        run(
          `UPDATE items SET url = ?, url_key = ?, title = ?, title_key = ?, is_zh = ?, summary = ?, author = ?, category = ?,
             tags = ?, score = ?, expires_at = ?, published_at = ?, raw = ?, last_seen_at = ?,
             price = ?, is_free = ?,
             ai = COALESCE(?, ai),
             obtain = COALESCE(?, obtain),
             ai_keep = COALESCE(?, ai_keep),
             kind = COALESCE(?, kind),
             ai_quality = COALESCE(?, ai_quality),
             image_url = COALESCE(?, image_url),
             status = CASE WHEN status = 'ignored' THEN 'ignored' ELSE ? END
           WHERE id = ?`,
          e.url,
          e.urlKey,
          e.title,
          titleKey,
          isZhText(e.title) ? 1 : 0,
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
          verdict ? effectiveKind : existing.ai_keep === null ? e.kind : null,
          effectiveQuality,
          e.imageUrl,
          status,
          existing.id,
        );
        skipped += 1;
        continue;
      }
      if (e.publishedAt) {
        const pubMs = Date.parse(e.publishedAt);
        if (!Number.isNaN(pubMs) && pubMs < staleCutoffMs) {
          skipped += 1;
          continue;
        }
      }
      try {
        const res = run(
          `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, is_zh, summary, author, category,
             tags, score, expires_at, published_at, raw, status, ai, obtain, ai_keep, kind, ai_quality, image_url, content, codes, price, is_free, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          sourceId,
          e.externalId,
          e.url,
          e.urlKey,
          e.title,
          titleKey,
          isZhText(e.title) ? 1 : 0,
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
          effectiveObtain,
          verdict ? (verdict.keep ? 1 : 0) : null,
          effectiveKind,
          effectiveQuality,
          e.imageUrl,
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
          aiReason: verdict?.reason ?? null,
          kind: effectiveKind,
          category: verdict?.category || e.category,
          obtain: effectiveObtain,
          summary: e.summary ?? null,
          publishedAt: e.publishedAt ?? null,
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
    const saved = persist(sourceId, result.items, null);
    inserted = saved.inserted;
    skipped = saved.skipped;
    if (saved.fresh.length) {
      await dispatchFresh(sourceId, saved.fresh, log);
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

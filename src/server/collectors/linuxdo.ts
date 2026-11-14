import { XMLParser } from "fast-xml-parser";
import { flaresolverrGet, hasFlare } from "../flaresolverr.ts";
import { cleanText, extractImageFromHtml, parseDate } from "../enrich/normalize.ts";
import type { Collector, RawItem } from "./types.ts";

/**
 * linux.do 采集：走 Discourse 的 RSS，不走 JSON。
 *
 * 为什么不是 JSON：
 *  /c/36/l/latest.json 直连 403，只能过 FlareSolverr 解挑战，每轮 40-70 秒，
 *  送码帖的时效性直接被吃掉。RSS 小一个数量级，且 CF 对它的策略宽松得多。
 *
 * 取 RSS 的两条路：
 *  1. 直连（curl 能拿 200，几百毫秒）
 *  2. 直连被拦时切 FlareSolverr —— Node 的 fetch 用的是 undici，
 *     TLS 指纹和 curl 不同，linux.do 会单独给它 403，所以这条路必须留着。
 *     session 复用后单次约 1.4 秒，仍远快于 JSON 的 40-70 秒。
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  processEntities: false,
});

type FeedItem = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const t = (v as Record<string, unknown>)["#text"];
    if (typeof t === "string") return t;
    if (typeof t === "number") return String(t);
  }
  return "";
}

function parseRss(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = doc.rss as { channel?: { item?: FeedItem | FeedItem[] } } | undefined;
  if (!rss?.channel) throw new Error("不是合法的 RSS");
  return asArray(rss.channel.item);
}

/** 从 https://linux.do/t/xxx/3166375 里取话题 id */
function topicIdOf(link: string): string | null {
  const m = /\/t\/(?:[^/]+\/)?(\d+)/.exec(link);
  return m ? m[1]! : null;
}

function toRawItem(it: FeedItem, categoryName: string): RawItem | null {
  const title = textOf(it.title).trim();
  const link = textOf(it.link).trim();
  if (!title || !link) return null;
  const id = topicIdOf(link);
  if (!id) return null;

  const description = textOf(it.description);
  return {
    externalId: id,
    url: link,
    title: cleanText(title, 200),
    summary: cleanText(description, 400),
    // RSS 的 description 就是首帖摘要，做「送什么、什么条件」的判断够了，
    // 也省掉了原来每帖一次的正文请求（5 帖 = 5 次 FlareSolverr）
    content: cleanText(description, 1200),
    author: textOf(it["dc:creator"]) || null,
    publishedAt: parseDate(textOf(it.pubDate)),
    imageUrl: extractImageFromHtml(description, link),
    tags: [categoryName],
    raw: { category: categoryName, via: "rss" },
  };
}

type Ctx = {
  http: { text(url: string): Promise<{ status: number; body: string }> };
  log(msg: string): void;
};

/** 限流信号：采集器据此把本轮标记为 degraded 而不是 failed。 */
export class RateLimited extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimited";
  }
}

async function fetchRss(ctx: Ctx, url: string): Promise<string> {
  let lastStatus = 0;
  let lastName = "";
  try {
    const res = await ctx.http.text(url);
    if (res.status === 200 && res.body.includes("<rss")) {
      ctx.log(`直连 RSS ok ${url}`);
      return res.body;
    }
    // 429 是限流，不是拦截。回落 FlareSolverr 要花 30 秒重解挑战去拿同一份数据，
    // 拿到的还是被限流的内容，纯浪费——直接放弃本轮，等下一个采集周期。
    if (res.status === 429) {
      ctx.log(`直连被限流（HTTP 429），本轮跳过，不回落 FlareSolverr`);
      throw new RateLimited("HTTP 429 限流，本轮跳过");
    }
    lastStatus = res.status;
    ctx.log(`直连 RSS HTTP ${res.status}，切 FlareSolverr`);
  } catch (err) {
    if (err instanceof RateLimited) throw err;
    lastName = err instanceof Error ? err.message : String(err);
    ctx.log(`直连 RSS 失败（${lastName}），切 FlareSolverr`);
  }

  if (!hasFlare()) {
    throw new Error(
      lastName ? `直连失败（${lastName}）且未配置 FLARESOLVERR_URL` : `直连 HTTP ${lastStatus} 且未配置 FLARESOLVERR_URL`,
    );
  }
  const res = await flaresolverrGet(url);
  // FlareSolverr 也可能撞上限流，同样不该当失败重试
  if (res.status === 429) throw new RateLimited("FlareSolverr 也返回 429，本轮跳过");
  if (res.status !== 200) throw new Error("FlareSolverr 取 RSS HTTP " + res.status);
  return res.body;
}

type Cfg = { categoryId: number; rssSlug: string; categoryName: string };

export const linuxdoCollector: Collector = {
  kind: "linuxdo",
  label: "LINUX DO",
  defaults: { config: { categoryId: 36, rssSlug: "welfare", categoryName: "福利羊毛" } },
  async collect(ctx) {
    const cfg: Cfg = {
      categoryId: Number(ctx.config.categoryId ?? 36),
      rssSlug: String(ctx.config.rssSlug ?? ""),
      categoryName: String(ctx.config.categoryName ?? ""),
    };

    let items: RawItem[] = [];
    let degraded: string | null = null;

    // 1) 分类 RSS：精准，只有目标板块
    if (cfg.rssSlug) {
      try {
        const xml = await fetchRss(ctx as Ctx, `https://linux.do/c/${cfg.rssSlug}/${cfg.categoryId}.rss`);
        items = parseRss(xml)
          .map((it) => toRawItem(it, cfg.categoryName))
          .filter((x): x is RawItem => x !== null);
        ctx.log(`分类 RSS ${items.length} 条`);
      } catch (err) {
        // 被限流就别试 latest.rss 了，第二条同样会 429，白等一轮
        if (err instanceof RateLimited) {
          ctx.log(`${err.message}（本轮直接结束，不回落）`);
          return { items: [], cursor: ctx.cursor, degraded: err.message };
        }
        degraded = "分类 RSS 失败: " + (err instanceof Error ? err.message : String(err));
        ctx.log(degraded);
      }
    }

    // 2) 兜底：latest.rss + 按 category 过滤（只有最新 30 条，覆盖全部板块）
    if (!items.length) {
      try {
        const xml = await fetchRss(ctx as Ctx, "https://linux.do/latest.rss");
        const all = parseRss(xml);
        const filtered = cfg.categoryName ? all.filter((it) => textOf(it.category).trim() === cfg.categoryName) : all;
        items = filtered.map((it) => toRawItem(it, cfg.categoryName)).filter((x): x is RawItem => x !== null);
        ctx.log(`latest.rss ${all.length} 条，命中「${cfg.categoryName}」${items.length} 条`);
        if (!items.length) degraded = (degraded ? degraded + "; " : "") + "latest.rss 未命中板块";
      } catch (err) {
        if (err instanceof RateLimited) {
          ctx.log(`${err.message}（兜底也限流，本轮结束）`);
          return { items: [], cursor: ctx.cursor, degraded: err.message };
        }
        throw err;
      }
    }

    const cursor = items.length ? String(Math.max(...items.map((i) => Number(i.externalId) || 0))) : ctx.cursor;
    return { items: items.slice(0, ctx.maxItems), cursor, degraded };
  },
};

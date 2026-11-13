import { XMLParser } from "fast-xml-parser";
import { cleanText, parseDate } from "../enrich/normalize.ts";
import { flaresolverrGet, hasFlare } from "../flaresolverr.ts";
import type { Collector, RawItem } from "./types.ts";

type FeedSpec = {
  id: string;
  url: string;
  limit?: number;
  via?: "direct" | "flaresolverr";
  /** 仅保留命中指定 RSS <category> 的条目（如 NodeSeek 的 info / promotion） */
  includeCategories?: string[];
  /** 排除命中指定 RSS <category> 的条目 */
  excludeCategories?: string[];
  /** 标题或摘要必须包含至少一个关键词（大小写不敏感） */
  titleKeywords?: string[];
  /** 针对 itch.io sale RSS：仅保留 100% 免费（discountpercent=100 或 price=$0.00） */
  only100Off?: boolean;
};

// processEntities: false —— Reddit 的 atom feed 里实体太多，默认的展开上限（1000）会直接抛错；
// 实体在后续 cleanText / decodeEntities 里统一处理。
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  processEntities: false,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const t = o["#text"];
    if (typeof t === "string") return t;
    if (typeof t === "number") return String(t);
  }
  return "";
}

function categoriesOf(v: unknown): string[] {
  return asArray(v as unknown | unknown[])
    .map((c) => {
      if (typeof c === "string") return c.trim().toLowerCase();
      if (c && typeof c === "object") {
        const o = c as Record<string, unknown>;
        return String(o["#text"] ?? o["@_term"] ?? "").trim().toLowerCase();
      }
      return "";
    })
    .filter(Boolean);
}

function linkOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const alternates = v.filter(
      (item) => item && typeof item === "object" && (!("@_rel" in item) || (item as Record<string, unknown>)["@_rel"] === "alternate"),
    );
    for (const item of [...alternates, ...v]) {
      const l = linkOf(item);
      if (l && !l.includes("comments")) return l;
    }
    return "";
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const href = o["@_href"] ?? o["@_url"];
    if (typeof href === "string") return href;
  }
  return "";
}

type FeedItem = Record<string, unknown>;

function parseFeed(xml: string): { title: string; items: FeedItem[] } {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = doc.rss as { channel?: { title?: unknown; item?: FeedItem | FeedItem[] } } | undefined;
  if (rss?.channel) {
    return {
      title: textOf(rss.channel.title),
      items: asArray(rss.channel.item),
    };
  }
  const feed = doc.feed as { title?: unknown; entry?: FeedItem | FeedItem[] } | undefined;
  if (feed) {
    return { title: textOf(feed.title), items: asArray(feed.entry) };
  }
  throw new Error("无法识别的 feed 格式（既不是 rss 也不是 atom）");
}

export const rssCollector: Collector = {
  kind: "rss",
  label: "RSS / Atom",
  defaults: { config: { feeds: [] } },
  async collect(ctx) {
    const feeds = (ctx.config.feeds as FeedSpec[] | undefined) ?? [];
    if (!feeds.length) throw new Error("未配置 feeds");

    const items: RawItem[] = [];
    const problems: string[] = [];
    let okFeeds = 0;

    for (const feed of feeds) {
      const limit = Math.min(feed.limit ?? 30, ctx.maxItems);
      const viaFlare = feed.via === "flaresolverr" || (feed.via !== "direct" && hasFlare() && Boolean(ctx.config.preferFlare));
      try {
        let body: string;
        if (viaFlare) {
          const res = await flaresolverrGet(feed.url);
          if (res.status !== 200) throw new Error("HTTP " + res.status);
          body = res.body;
        } else {
          const res = await ctx.http.text(feed.url);
          if (res.status !== 200) throw new Error("HTTP " + res.status);
          body = res.body;
        }

        const parsed = parseFeed(body);
        ctx.log(feed.id + " ok:" + parsed.items.length + " items");
        okFeeds += 1;

        const incCats = (feed.includeCategories ?? []).map((s) => s.toLowerCase());
        const excCats = new Set((feed.excludeCategories ?? []).map((s) => s.toLowerCase()));
        const titleKws = (feed.titleKeywords ?? []).map((s) => s.toLowerCase()).filter(Boolean);

        // 先过滤后截断 limit，避免垃圾分类占满配额把真福利挤掉
        const scanPool = incCats.length || excCats.size || titleKws.length || feed.only100Off ? parsed.items : parsed.items.slice(0, limit);
        let keptForFeed = 0;

        for (const it of scanPool) {
          if (keptForFeed >= limit) break;
          const title = textOf(it.title);
          const link = linkOf(it.link) || textOf(it.guid) || textOf(it.id);
          if (!title || !link) continue;

          if (incCats.length || excCats.size) {
            const cats = categoriesOf(it.category);
            if (incCats.length && !cats.some((c) => incCats.includes(c))) continue;
            if (excCats.size && cats.some((c) => excCats.has(c))) continue;
          }

          if (feed.only100Off) {
            const discount = textOf(it.discountpercent).trim();
            const price = textOf(it.price).trim();
            if (discount !== "100" && price !== "$0.00") continue;
          }

          const cleanT = cleanText(title, 200);
          const rawSummary =
            textOf(it.description) || textOf(it.summary) || textOf(it["content:encoded"]) || textOf(it.content);
          const cleanS = cleanText(rawSummary, 400);

          if (titleKws.length) {
            const hay = cleanT.toLowerCase();
            if (!titleKws.some((k) => hay.includes(k))) continue;
          }

          const published =
            textOf(it.pubDate) || textOf(it.published) || textOf(it.updated) || textOf(it["dc:date"]);
          const saleEnds = it.saleends ? parseDate(textOf(it.saleends)) : null;
          const fullPrice = textOf(it.fullPrice).trim();

          items.push({
            externalId: (it.guid ? textOf(it.guid) : "") || textOf(it.id) || link,
            url: link,
            title: cleanT,
            summary: fullPrice && feed.only100Off ? `原价 ${fullPrice} 限时 100% 免费 · ${cleanS}`.slice(0, 400) : cleanS,
            author: textOf(it.author) || textOf(it["dc:creator"]) || null,
            publishedAt: parseDate(published),
            expiresAt: saleEnds,
            categoryHint: feed.only100Off ? "game" : undefined,
            tags: [feed.id],
            raw: { feed: feed.id },
          });
          keptForFeed += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        problems.push(feed.id + ": " + message);
        ctx.log(feed.id + " FAILED " + message);
      }
    }

    if (!okFeeds && problems.length) throw new Error("全部 feed 失败: " + problems.join("; "));

    return {
      items: items.slice(0, ctx.maxItems),
      cursor: null,
      degraded: problems.length ? problems.join("; ") : null,
    };
  },
};

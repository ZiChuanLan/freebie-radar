import { XMLParser } from "fast-xml-parser";
import { cleanText, parseDate } from "../enrich/normalize.ts";
import { flaresolverrGet, hasFlare } from "../flaresolverr.ts";
import type { Collector, RawItem } from "./types.ts";

type FeedSpec = { id: string; url: string; limit?: number; via?: "direct" | "flaresolverr" };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });

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

function linkOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    for (const item of v) {
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

        for (const it of parsed.items.slice(0, limit)) {
          const title = textOf(it.title);
          const link = linkOf(it.link) || textOf(it.guid) || textOf(it.id);
          if (!title || !link) continue;
          const summary =
            textOf(it.description) || textOf(it.summary) || textOf(it["content:encoded"]) || textOf(it.content);
          const published =
            textOf(it.pubDate) || textOf(it.published) || textOf(it.updated) || textOf(it["dc:date"]);
          items.push({
            externalId: String(it.guid ? textOf(it.guid) : link),
            url: link,
            title: cleanText(title, 200),
            summary: cleanText(summary, 400),
            author: textOf(it.author) || textOf(it["dc:creator"]) || null,
            publishedAt: parseDate(published),
            tags: [feed.id],
            raw: { feed: feed.id },
          });
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

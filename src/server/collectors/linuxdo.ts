import { flaresolverrGet, hasFlare } from "../flaresolverr.ts";
import type { Collector, RawItem } from "./types.ts";

type TopicTag = string | { name?: string; slug?: string };
type Topic = {
  id: number;
  title: string;
  slug?: string;
  created_at?: string;
  last_posted_at?: string;
  excerpt?: string;
  category_id?: number;
  tags?: TopicTag[];
  posts_count?: number;
  like_count?: number;
  views?: number;
};

function tagNames(tags: TopicTag[] | undefined): string[] {
  return (tags ?? [])
    .map((t) => (typeof t === "string" ? t : (t.name ?? t.slug ?? "")))
    .filter((t) => Boolean(t));
}

export const linuxdoCollector: Collector = {
  kind: "linuxdo",
  label: "LINUX DO",
  defaults: { config: { categoryId: 36 } },
  async collect(ctx) {
    const categoryId = Number(ctx.config.categoryId ?? 36);
    const url = "https://linux.do/c/" + categoryId + "/l/latest.json?order=created";
    ctx.log("GET " + url + (hasFlare() ? " via flaresolverr" : " direct"));

    let body: string;
    if (hasFlare()) {
      const res = await flaresolverrGet(url);
      if (res.status !== 200) throw new Error("linux.do HTTP " + res.status);
      body = res.body;
    } else {
      const res = await ctx.http.text(url);
      if (res.status !== 200) {
        throw new Error("linux.do HTTP " + res.status + "（未配置 FLARESOLVERR_URL，大概率被 Cloudflare 拦截）");
      }
      body = res.body;
    }

    let data: { topic_list?: { topics?: Topic[] } };
    try {
      data = JSON.parse(body) as typeof data;
    } catch {
      throw new Error("linux.do 返回非 JSON，可能仍是 Cloudflare 挑战页");
    }

    const topics = data.topic_list?.topics ?? [];
    const items: RawItem[] = topics.map((t) => ({
      externalId: String(t.id),
      url: "https://linux.do/t/" + (t.slug ? t.slug + "/" : "") + t.id,
      title: t.title,
      summary: t.excerpt ?? "",
      publishedAt: t.created_at ?? t.last_posted_at ?? null,
      tags: tagNames(t.tags),
      raw: { id: t.id, categoryId: t.category_id, views: t.views, likes: t.like_count },
    }));

    const cursor = topics.length ? String(Math.max(...topics.map((t) => t.id))) : ctx.cursor;
    return { items: items.slice(0, ctx.maxItems), cursor };
  },
};

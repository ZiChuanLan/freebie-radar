import { flaresolverrGet, hasFlare } from "../flaresolverr.ts";
import type { Collector, RawItem } from "./types.ts";

type V2Topic = {
  id: number;
  title: string;
  url: string;
  content?: string;
  content_rendered?: string;
  created?: number;
  last_modified?: number;
  replies?: number;
  member?: { username?: string };
  node?: { name?: string; title?: string };
};

function fromJson(body: string): V2Topic[] {
  const data = JSON.parse(body) as V2Topic[] | { message?: string };
  if (!Array.isArray(data)) throw new Error("V2EX 返回异常: " + JSON.stringify(data).slice(0, 160));
  return data;
}

export const v2exCollector: Collector = {
  kind: "v2ex",
  label: "V2EX · 免费赠送",
  defaults: { config: { node: "free" } },
  async collect(ctx) {
    const node = String(ctx.config.node ?? "free");
    const url = "https://www.v2ex.com/api/topics/show.json?node_name=" + encodeURIComponent(node);
    ctx.log("GET " + url + (hasFlare() ? " via flaresolverr" : " direct"));

    let topics: V2Topic[];
    if (hasFlare()) {
      const res = await flaresolverrGet(url);
      if (res.status !== 200) throw new Error("V2EX HTTP " + res.status);
      topics = fromJson(res.body);
    } else {
      const res = await ctx.http.json<V2Topic[]>(url);
      if (res.status !== 200) throw new Error("V2EX HTTP " + res.status);
      topics = Array.isArray(res.data) ? res.data : fromJson(res.response.body);
    }

    const items: RawItem[] = topics.map((t) => ({
      externalId: String(t.id),
      url: t.url || "https://www.v2ex.com/t/" + t.id,
      title: t.title,
      summary: (t.content ?? "").slice(0, 300),
      author: t.member?.username ?? null,
      publishedAt: t.created ? new Date(t.created * 1000).toISOString() : null,
      tags: t.node?.name ? [t.node.name] : [],
      raw: { id: t.id, replies: t.replies, node: t.node?.name },
    }));

    const cursor = topics.length ? String(Math.max(...topics.map((t) => t.id))) : ctx.cursor;
    return { items: items.slice(0, ctx.maxItems), cursor };
  },
};

import { cleanText } from "../enrich/normalize.ts";
import type { Collector, RawItem } from "./types.ts";

type BskyFeedItem = {
  post?: {
    uri?: string;
    author?: { handle?: string; displayName?: string };
    record?: { text?: string; createdAt?: string };
    embed?: { external?: { uri?: string; title?: string; description?: string } };
  };
};

function postUrl(handle: string, uri: string): string {
  const rkey = uri.split("/").pop() ?? "";
  return "https://bsky.app/profile/" + handle + "/post/" + rkey;
}

/**
 * Bluesky 公开接口（免登录、零反爬、JSON），用于聚合 X/游戏/羊毛博主的实时动态。
 */
export const bskyCollector: Collector = {
  kind: "bsky",
  label: "Bluesky 公开动态",
  defaults: { config: { actors: [], limitPerActor: 12 } },
  async collect(ctx) {
    const actors = (ctx.config.actors as string[] | undefined) ?? [];
    if (!actors.length) throw new Error("未配置 actors");
    const limitPer = Math.min(Number(ctx.config.limitPerActor ?? 12), 30);

    const items: RawItem[] = [];
    const problems: string[] = [];
    let ok = 0;

    for (const actor of actors) {
      const url =
        "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=" +
        encodeURIComponent(actor) +
        "&limit=" +
        limitPer +
        "&filter=posts_no_replies";
      try {
        const res = await ctx.http.json<{ feed?: BskyFeedItem[] }>(url);
        if (res.status !== 200) {
          problems.push(actor + " HTTP " + res.status);
          continue;
        }
        const feed = res.data?.feed ?? [];
        ok += 1;
        ctx.log(actor + " ok:" + feed.length);
        for (const entry of feed) {
          const p = entry.post;
          const txt = cleanText(p?.record?.text ?? "", 400);
          if (!p?.uri || !txt) continue;
          const handle = p.author?.handle || actor;
          const ext = p.embed?.external;
          const firstLine = txt.split(/\n|\r/)[0]?.trim() || txt;
          const title = ext?.title ? ext.title.slice(0, 140) + " — " + firstLine.slice(0, 60) : firstLine.slice(0, 160);
          items.push({
            externalId: p.uri,
            url: ext?.uri && /^https?:\/\//.test(ext.uri) ? ext.uri : postUrl(handle, p.uri),
            title,
            summary: cleanText([txt, ext?.description].filter(Boolean).join(" · "), 400),
            content: txt,
            author: p.author?.displayName || handle,
            publishedAt: p.record?.createdAt ?? null,
            tags: ["bsky", handle],
            raw: { actor, uri: p.uri, bskyUrl: postUrl(handle, p.uri) },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        problems.push(actor + ": " + msg);
        ctx.log(actor + " FAILED " + msg);
      }
    }

    if (!ok && problems.length) throw new Error("全部 Bluesky 账号失败: " + problems.join("; "));
    return {
      items: items.slice(0, ctx.maxItems),
      cursor: null,
      degraded: problems.length ? problems.join("; ") : null,
    };
  },
};

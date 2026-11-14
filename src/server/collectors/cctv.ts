import { cleanText, sanitizeImageUrl } from "../enrich/normalize.ts";
import type { Collector, RawItem } from "./types.ts";

type CctvChannelSpec = {
  channel: string;
  cb?: string;
  categoryHint?: string;
  limit?: number;
};

type CctvArticle = {
  id?: string;
  title?: string;
  brief?: string;
  url?: string;
  image?: string;
  keywords?: string;
  focus_date?: string;
};

function parseCctvDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed.replace(/\s+/, "T") + "+08:00");
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseJsonp(body: string, cb: string): { data?: { list?: CctvArticle[] } } {
  const escaped = cb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = body
    .trim()
    .replace(new RegExp(`^${escaped}\\(`), "")
    .replace(/\)\s*;?\s*$/, "");
  return JSON.parse(stripped) as { data?: { list?: CctvArticle[] } };
}

/**
 * 央视新闻（news.cctv.com）公开栏目接口：
 * 支持时政要闻（news / china）、国际要闻（world）、财经（economy_zixun）、科技（tech）。
 */
export const cctvCollector: Collector = {
  kind: "cctv",
  label: "央视新闻",
  defaults: {
    config: {
      channels: [
        { channel: "news", cb: "news", categoryHint: "headline", limit: 20 },
      ],
    },
  },
  async collect(ctx) {
    const channels = (ctx.config.channels as CctvChannelSpec[] | undefined) ?? [
      { channel: "news", cb: "news", categoryHint: "headline", limit: 20 },
    ];
    const items: RawItem[] = [];
    const seenIds = new Set<string>();
    const problems: string[] = [];
    let okCount = 0;

    for (const spec of channels) {
      const ch = spec.channel.trim();
      const cb = (spec.cb ?? ch).trim();
      const limit = Math.min(spec.limit ?? 20, ctx.maxItems);
      const apiUrl = `https://news.cctv.com/2019/07/gaiban/cmsdatainterface/page/${encodeURIComponent(ch)}_1.jsonp?cb=${encodeURIComponent(cb)}`;
      try {
        const res = await ctx.http.text(apiUrl);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const parsed = parseJsonp(res.body, cb);
        const list = parsed.data?.list ?? [];
        okCount += 1;
        for (const art of list.slice(0, limit)) {
          const title = cleanText(art.title ?? "", 200);
          const url = (art.url ?? "").trim();
          if (!title || !url) continue;
          const externalId = (art.id || url).trim();
          if (seenIds.has(externalId)) continue;
          seenIds.add(externalId);
          const summary = cleanText(art.brief ?? "", 400);
          const tags = (art.keywords ?? "")
            .split(/\s+/)
            .map((t) => t.trim())
            .filter((t) => t.length >= 2)
            .slice(0, 6);
          items.push({
            externalId,
            url,
            title,
            summary,
            author: "央视新闻",
            publishedAt: parseCctvDate(art.focus_date),
            categoryHint: spec.categoryHint ?? null,
            tags,
            imageUrl: sanitizeImageUrl(art.image, url),
            raw: { id: art.id, channel: ch, focus_date: art.focus_date },
          });
        }
        ctx.log(`cctv ${ch}: ${Math.min(list.length, limit)} 条`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        problems.push(`${ch}: ${msg}`);
        ctx.log(`cctv ${ch} 失败: ${msg}`);
      }
    }

    if (okCount === 0) {
      throw new Error(problems.join("; ") || "央视新闻全部频道拉取失败");
    }

    return {
      items: items.slice(0, ctx.maxItems),
      cursor: null,
      degraded: problems.length ? problems.join("; ") : null,
    };
  },
};

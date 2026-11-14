import type { Collector, RawItem } from "./types.ts";
import { decodeEntities } from "../enrich/normalize.ts";

function parseRows(html: string): { url: string; title: string; appId: string }[] {
  const out: { url: string; title: string; appId: string }[] = [];
  // Steam 的 <a> 上挂了很长的 onmouseover / data-* 属性，从 href 到 title 有 1-2KB，
  // 只给 800 字符会漏掉所有结果。
  const re = /<a href="(https:\/\/store\.steampowered\.com\/app\/[^"]+)"[\s\S]{0,3000}?<span class="title">([^<]+)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = (m[1] ?? "").split("?")[0] ?? "";
    const title = decodeEntities((m[2] ?? "").trim());
    const appId = /\/app\/(\d+)/.exec(url)?.[1] ?? url;
    if (url && title && !out.some((x) => x.appId === appId)) out.push({ url, title, appId });
  }
  return out;
}

/** Steam 商店搜索的 AJAX 接口：maxprice=free + specials=1 就是「限时免费 / 100% off」。 */
export const steamCollector: Collector = {
  kind: "steam",
  label: "Steam 限时免费",
  defaults: { config: { count: 50 } },
  async collect(ctx) {
    const count = Math.min(Number(ctx.config.count ?? 50), 100);
    const url =
      "https://store.steampowered.com/search/results/?query&start=0&count=" + count +
      "&maxprice=free&specials=1&infinite=1&cc=us&l=schinese";
    ctx.log("GET " + url);

    const res = await ctx.http.json<{ total_count?: number; results_html?: string }>(url);
    if (res.status !== 200) throw new Error("Steam HTTP " + res.status);
    const rows = parseRows(res.data?.results_html ?? "");

    const items: RawItem[] = rows.map((r) => ({
      externalId: r.appId,
      url: r.url,
      title: r.title,
      summary: "Steam 限时免费（100% off）",
      author: "Steam",
      publishedAt: null,
      imageUrl: /^\d+$/.test(r.appId)
        ? "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/" + r.appId + "/header.jpg"
        : null,
      tags: ["steam", "限时免费"],
      raw: { appId: r.appId },
    }));

    ctx.log("parsed " + items.length + " (total_count=" + (res.data?.total_count ?? "?") + ")");
    return { items: items.slice(0, ctx.maxItems), cursor: null };
  },
};

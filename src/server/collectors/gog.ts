import type { Collector, RawItem } from "./types.ts";

type GogProduct = {
  id: string;
  title: string;
  slug?: string;
  storeLink?: string;
  releaseDate?: string;
  genres?: { name?: string }[];
  tags?: { name?: string }[];
  price?: { finalMoney?: { amount?: string }; final?: string; base?: string; discount?: string };
};

function isoDate(d?: string): string | null {
  if (!d) return null;
  const m = /^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})$/.exec(d.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString();
}

function isFree(p: GogProduct): boolean {
  const amt = String(p.price?.finalMoney?.amount ?? p.price?.final ?? "");
  return amt === "0" || /^\$?0(\.0+)?$/.test(amt);
}

/** GOG 官方目录接口：discount=100 即 100% off（限时免费）。 */
export const gogCollector: Collector = {
  kind: "gog",
  label: "GOG 限时免费",
  defaults: { config: { country: "US", locale: "en-US", limit: 48 } },
  async collect(ctx) {
    const country = String(ctx.config.country ?? "US");
    const locale = String(ctx.config.locale ?? "en-US");
    const url =
      "https://catalog.gog.com/v1/catalog?limit=" + Number(ctx.config.limit ?? 48) +
      "&discount=100&productType=in:game&countryCode=" + country + "&locale=" + locale + "&currencyCode=USD";
    ctx.log("GET " + url);

    const res = await ctx.http.json<{ products?: GogProduct[] }>(url, { headers: { accept: "application/json" } });
    if (res.status !== 200) throw new Error("GOG HTTP " + res.status);
    const products = res.data?.products ?? [];
    const free = products.filter(isFree);

    const items: RawItem[] = free.map((p) => ({
      externalId: String(p.id),
      url: p.storeLink || "https://www.gog.com/en/game/" + (p.slug ?? ""),
      title: p.title,
      summary: [(p.genres ?? []).map((g) => g.name).filter(Boolean).slice(0, 3).join(" / "), p.price?.base ? "原价 " + p.price.base : ""]
        .filter(Boolean)
        .join(" · "),
      author: "GOG.com",
      publishedAt: isoDate(p.releaseDate),
      tags: ["gog", "100% off", ...(p.tags ?? []).map((t) => t.name ?? "").filter(Boolean).slice(0, 3)],
      raw: { id: p.id, slug: p.slug, discount: p.price?.discount },
    }));

    ctx.log("parsed " + items.length + " free of " + products.length);
    return { items: items.slice(0, ctx.maxItems), cursor: null };
  },
};

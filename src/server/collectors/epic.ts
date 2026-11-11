import type { Collector, RawItem } from "./types.ts";

type Offer = { startDate?: string; endDate?: string; discountSetting?: { discountPercentage?: number } };
type Promotion = { promotionalOffers?: Offer[] };
type Element = {
  id: string;
  title: string;
  description?: string;
  productSlug?: string | null;
  urlSlug?: string | null;
  url?: string | null;
  offerMappings?: { pageSlug?: string }[];
  price?: { totalPrice?: { discountPrice?: number; originalPrice?: number; fmtPrice?: { originalPrice?: string } } };
  promotions?: { promotionalOffers?: Promotion[]; upcomingPromotionalOffers?: Promotion[] };
};

function flatten(groups: Promotion[] | undefined): Offer[] {
  return (groups ?? []).flatMap((g) => g.promotionalOffers ?? []);
}

function slugOf(e: Element): string {
  const raw = e.productSlug || e.urlSlug || e.offerMappings?.[0]?.pageSlug || "";
  return raw.replace(/\/home$/, "");
}

/** Epic 官方免费游戏接口，能准确拿到「本周免费」与「即将免费」的起止时间。 */
export const epicCollector: Collector = {
  kind: "epic",
  label: "Epic Games 喜加一",
  defaults: { config: { includeUpcoming: true } },
  async collect(ctx) {
    const locale = String(ctx.config.locale ?? "zh-CN");
    const country = String(ctx.config.country ?? "CN");
    const url =
      "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=" +
      encodeURIComponent(locale) +
      "&country=" +
      encodeURIComponent(country) +
      "&allowCountries=" +
      encodeURIComponent(country);
    ctx.log("GET " + url);

    const res = await ctx.http.json<{ data?: { Catalog?: { searchStore?: { elements?: Element[] } } } }>(url);
    if (res.status !== 200) throw new Error("Epic HTTP " + res.status);
    const elements = res.data?.data?.Catalog?.searchStore?.elements ?? [];

    const includeUpcoming = ctx.config.includeUpcoming !== false;
    const items: RawItem[] = [];

    for (const e of elements) {
      const current = flatten(e.promotions?.promotionalOffers).filter(
        (o) => Number(o.discountSetting?.discountPercentage ?? -1) === 0,
      );
      const upcoming = includeUpcoming
        ? flatten(e.promotions?.upcomingPromotionalOffers).filter(
            (o) => Number(o.discountSetting?.discountPercentage ?? -1) === 0,
          )
        : [];

      if (!current.length && !upcoming.length) continue;
      const slug = slugOf(e);
      const isNow = current.length > 0;
      const window0 = (isNow ? current[0] : upcoming[0]) ?? {};
      const original = e.price?.totalPrice?.fmtPrice?.originalPrice ?? "";

      items.push({
        externalId: e.id,
        url: "https://store.epicgames.com/zh-CN/p/" + (slug || e.id),
        title: (isNow ? "【本周免费】" : "【即将免费】") + (e.title ?? ""),
        summary: [e.description, original ? "原价 " + original : ""].filter(Boolean).join(" · "),
        author: "Epic Games",
        publishedAt: window0.startDate ?? null,
        expiresAt: window0.endDate ?? null,
        tags: ["epic", isNow ? "当前免费" : "即将免费"],
        raw: { slug, id: e.id, isNow, start: window0.startDate, end: window0.endDate },
      });
    }

    ctx.log("parsed " + items.length + " epic freebies");
    return { items: items.slice(0, ctx.maxItems), cursor: null };
  },
};

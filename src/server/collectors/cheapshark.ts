import type { Collector, RawItem } from "./types.ts";

type Deal = {
  dealID: string;
  title: string;
  storeID: string;
  gameID: string;
  salePrice: string;
  normalPrice: string;
  savings: string;
  steamRatingText?: string | null;
  steamRatingPercent?: string | null;
  steamAppID?: string | null;
  releaseDate?: number;
  thumb?: string;
};

const STORE_NAME: Record<string, string> = {
  "1": "Steam",
  "2": "GamersGate",
  "3": "GreenManGaming",
  "7": "GOG",
  "8": "Origin",
  "11": "Humble",
  "13": "Uplay",
  "15": "Fanatical",
  "21": "WinGameStore",
  "23": "GameBillet",
  "25": "Epic Games",
  "27": "Gamesplanet",
  "31": "Blizzard",
  "35": "DreamGame",
};

/** CheapShark 免费与史低白菜游戏 API（免登录、JSON，覆盖 Steam/Epic/GOG/Fanatical/Humble 等）。 */
export const cheapsharkCollector: Collector = {
  kind: "cheapshark",
  label: "CheapShark 游戏免费与史低",
  defaults: { config: { upperPrice: 1, pageSize: 40 } },
  async collect(ctx) {
    const upperPrice = Number(ctx.config.upperPrice ?? 1);
    const pageSize = Math.min(Number(ctx.config.pageSize ?? 40), ctx.maxItems);
    const url = "https://www.cheapshark.com/api/1.0/deals?upperPrice=" + upperPrice + "&pageSize=" + pageSize + "&onSale=1";
    ctx.log("GET " + url);

    const res = await ctx.http.json<Deal[]>(url);
    if (res.status !== 200) throw new Error("CheapShark HTTP " + res.status);
    const list = Array.isArray(res.data) ? res.data : [];

    const items: RawItem[] = list.map((d) => {
      const sale = Number(d.salePrice ?? "0");
      const norm = Number(d.normalPrice ?? "0");
      const store = STORE_NAME[d.storeID] ?? "Store#" + d.storeID;
      const pct = Math.round(Number(d.savings ?? "0"));
      const tag = sale === 0 ? "【免费领】" : "【$" + d.salePrice + "】";
      const rating = d.steamRatingPercent && Number(d.steamRatingPercent) > 0 ? " · Steam 好评 " + d.steamRatingPercent + "%" : "";
      const dealUrl = d.steamAppID
        ? "https://store.steampowered.com/app/" + d.steamAppID
        : "https://www.cheapshark.com/redirect?dealID=" + encodeURIComponent(d.dealID);

      return {
        externalId: d.dealID,
        url: dealUrl,
        title: tag + " " + d.title + " (" + store + (norm > 0 ? " 原价 $" + d.normalPrice : "") + ")",
        summary: (sale === 0 ? "免费领取 (100% off)" : "折扣 -" + pct + "%，现价 $" + d.salePrice + "，原价 $" + d.normalPrice) + " · 商店：" + store + rating,
        author: store,
        publishedAt: null,
        categoryHint: "game",
        tags: ["game", store.toLowerCase(), sale === 0 ? "free" : "deal"],
        imageUrl: d.steamAppID
          ? "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/" + d.steamAppID + "/header.jpg"
          : d.thumb || null,
        raw: { dealID: d.dealID, salePrice: d.salePrice, normalPrice: d.normalPrice, store },
      };
    });

    ctx.log("parsed " + items.length + " deals");
    return { items: items.slice(0, ctx.maxItems), cursor: null };
  },
};

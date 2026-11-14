import type { Collector, RawItem } from "./types.ts";

type Giveaway = {
  id: number;
  title: string;
  worth?: string;
  description?: string;
  instructions?: string;
  open_giveaway_url?: string;
  gamerpower_url?: string;
  published_date?: string;
  end_date?: string;
  platforms?: string;
  type?: string;
  status?: string;
  users?: number;
  thumbnail?: string;
  image?: string;
};

/** GamerPower 聚合 Epic / Steam / GOG / Prime / itch.io / IndieGala 等平台的限时免费。 */
export const gamerpowerCollector: Collector = {
  kind: "gamerpower",
  label: "GamerPower 免费游戏聚合",
  defaults: { config: { query: "type=game", limit: 60 } },
  async collect(ctx) {
    const query = String(ctx.config.query ?? "type=game");
    const limit = Math.min(Number(ctx.config.limit ?? 60), ctx.maxItems);
    const url = "https://www.gamerpower.com/api/giveaways?" + query;
    ctx.log("GET " + url);

    const res = await ctx.http.json<Giveaway[]>(url);
    if (res.status !== 200) throw new Error("GamerPower HTTP " + res.status);
    const list = Array.isArray(res.data) ? res.data : [];

    const items: RawItem[] = list
      .filter((g) => g.status === "Active")
      .map((g) => ({
        externalId: String(g.id),
        url: g.open_giveaway_url || g.gamerpower_url || "https://www.gamerpower.com/",
        title: g.title,
        summary: [g.description, g.worth ? "价值 " + g.worth : ""].filter(Boolean).join(" · "),
        author: (g.platforms ?? "").split(",")[0]?.trim() || null,
        publishedAt: g.published_date || null,
        expiresAt: g.end_date && g.end_date !== "N/A" ? g.end_date : null,
        tags: [g.platforms ?? "", g.type ?? ""].flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean),
        raw: { worth: g.worth, users: g.users, platforms: g.platforms, type: g.type },
        imageUrl: g.image || g.thumbnail || null,
      }));

    ctx.log("parsed " + items.length + " active giveaways");
    return { items: items.slice(0, limit), cursor: null };
  },
};

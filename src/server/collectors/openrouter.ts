import type { Collector, RawItem } from "./types.ts";

type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
};

/**
 * OpenRouter 免费大模型实时上新探测：
 * 只取近期上线（默认 14 天内）且 prompt/completion 均为 0 的免费模型，
 * 避免一次性导入全量历史免费模型。
 */
export const openrouterCollector: Collector = {
  kind: "openrouter",
  label: "OpenRouter 免费模型",
  defaults: { config: { maxAgeDays: 14 } },
  async collect(ctx) {
    const maxAgeDays = Math.min(Math.max(Number(ctx.config.maxAgeDays ?? 14), 1), 90);
    const cutoffSec = Math.floor(Date.now() / 1000) - maxAgeDays * 86_400;

    const res = await ctx.http.json<{ data?: OpenRouterModel[] }>("https://openrouter.ai/api/v1/models");
    if (res.status !== 200) throw new Error("OpenRouter HTTP " + res.status);
    const models = res.data?.data ?? [];

    const freeModels = models
      .filter((m) => {
        if (!m.id) return false;
        const isFreePrice =
          m.id.endsWith(":free") ||
          (Number(m.pricing?.prompt ?? "1") === 0 && Number(m.pricing?.completion ?? "1") === 0);
        if (!isFreePrice) return false;
        if (m.created && m.created < cutoffSec) return false;
        return true;
      })
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));

    const items: RawItem[] = freeModels.slice(0, ctx.maxItems).map((m) => {
      const ctxLen = m.context_length ? `${Math.round(m.context_length / 1024)}K 上下文` : "";
      const desc = (m.description ?? "").replace(/\s+/g, " ").trim().slice(0, 260);
      return {
        externalId: m.id,
        url: `https://openrouter.ai/${m.id}`,
        title: `OpenRouter 新免费模型：${m.name || m.id}`,
        summary: [ctxLen, desc].filter(Boolean).join(" · ") || "OpenRouter 免费 API 模型调用额度",
        author: "OpenRouter",
        publishedAt: m.created ? new Date(m.created * 1000).toISOString() : null,
        categoryHint: "ai",
        tags: ["openrouter", "free", "ai"],
        raw: { id: m.id, context_length: m.context_length, created: m.created },
      };
    });

    ctx.log(`openrouter free recent(${maxAgeDays}d): ${items.length}`);
    return { items, cursor: null };
  },
};

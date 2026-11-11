import type { Collector } from "./types.ts";

const PAGE_SIZE = 2;
const TOTAL_PAGES = 3;

/** 自检用假源：验证 采集 → 入库 → 游标推进 → 失败隔离。 */
export const mockCollector: Collector = {
  kind: "mock",
  label: "Mock 源（自检用）",
  defaults: { config: { fail: false } },
  async collect(ctx) {
    if (ctx.config.fail === true) throw new Error("mock: 故意失败，用于验证失败隔离");
    const page = Number(ctx.cursor ?? "0") || 0;
    const now = Date.now();
    const items = [];
    for (let i = 0; i < PAGE_SIZE; i += 1) {
      const n = page * PAGE_SIZE + i;
      items.push({
        externalId: "mock-" + n,
        url: "https://example.com/freebie/" + n + "?utm_source=mock",
        title: "【Mock】免费领取测试额度 " + n,
        summary: "用于验证采集链路与去重的假数据",
        publishedAt: new Date(now - n * 3_600_000).toISOString(),
        tags: ["mock"],
        raw: { n },
      });
    }
    const next = page + 1;
    return { items: items.slice(0, ctx.maxItems), cursor: next >= TOTAL_PAGES ? "0" : String(next) };
  },
};

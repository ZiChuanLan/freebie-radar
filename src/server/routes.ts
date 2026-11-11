import type { Hono } from "hono";
import { all, get, run } from "./db.ts";
import { aiEnabled, config, pushEnabled } from "./config.ts";
import { ingestItems, markSourceFailure } from "./collectors/index.ts";
import type { RawItem } from "./collectors/types.ts";

export type ItemRow = {
  id: number;
  source_id: string;
  external_id: string;
  url: string;
  url_key: string;
  title: string;
  summary: string | null;
  author: string | null;
  category: string | null;
  tags: string;
  codes?: string;
  price?: number | null;
  is_free?: number;
  score: number;
  expires_at: string | null;
  published_at: string | null;
  raw: string;
  status: string;
  starred: number;
  ai: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

/** 订阅命中的关键词（都转小写比较），用于前端高亮与筛选。 */
function matchKeywords(row: ItemRow, keywords: string[]): string[] {
  if (!keywords.length) return [];
  const text = (row.title + " " + (row.summary ?? "")).toLowerCase();
  return keywords.filter((k) => text.includes(k.toLowerCase()));
}

function shape(row: ItemRow, keywords: string[] = []) {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    tags = [];
  }
  let codes: string[] = [];
  try {
    codes = JSON.parse(row.codes ?? '[]') as string[];
    if (!Array.isArray(codes)) codes = [];
  } catch {
    codes = [];
  }
  let ai: unknown = null;
  if (row.ai) {
    try {
      ai = JSON.parse(row.ai);
    } catch {
      ai = null;
    }
  }
  return {
    ...row,
    tags,
    codes,
    ai,
    starred: row.starred === 1,
    raw: undefined,
    matched: matchKeywords(row, keywords),
  };
}

const SORTS: Record<string, string> = {
  score: "score DESC, COALESCE(published_at, first_seen_at) DESC",
  newest: "COALESCE(published_at, first_seen_at) DESC",
  oldest: "COALESCE(published_at, first_seen_at) ASC",
};

export function registerApi(app: Hono) {
  app.get("/api/items", (c) => {
    const q = c.req.query();
    const limit = Math.min(Math.max(Number(q.limit ?? 40), 1), 200);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const where: string[] = [];
    const params: (string | number)[] = [];

    const status = q.status ?? "active";
    if (status !== "all") {
      where.push("status = ?");
      params.push(status);
    }
    if (q.source) {
      where.push("source_id = ?");
      params.push(q.source);
    }
    if (q.category) {
      where.push("category = ?");
      params.push(q.category);
    }
    if (q.starred === "1") where.push("starred = 1");
    if (q.search) {
      where.push("(title LIKE ? OR COALESCE(summary,'') LIKE ?)");
      params.push(`%${q.search}%`, `%${q.search}%`);
    }
    if (q.since) {
      where.push("COALESCE(published_at, first_seen_at) >= ?");
      params.push(q.since);
    }
    if (q.unexpired === "1") {
      where.push("(expires_at IS NULL OR expires_at > ?)");
      params.push(new Date().toISOString());
    }

    // 价格筛选：完全白嫖 / 最高能付多少（未知价格视为不匹配）
    if (q.freeOnly === "1") {
      where.push("(is_free = 1 OR price = 0)");
    }
    if (q.maxPrice) {
      const cap = Number(q.maxPrice);
      if (Number.isFinite(cap) && cap >= 0) {
        where.push("((is_free = 1 OR price = 0) OR (price IS NOT NULL AND price <= ?))");
        params.push(cap);
      }
    }

    // 订阅命中 / 即将过期 两个筛选项
    const subKeywords = all<{ keyword: string }>("SELECT keyword FROM subscriptions ORDER BY keyword").map((r) => r.keyword);
    if (q.subscribed === "1" && subKeywords.length) {
      const likes = subKeywords.map(() => "(title LIKE ? OR COALESCE(summary,'') LIKE ?)").join(" OR ");
      where.push("(" + likes + ")");
      for (const k of subKeywords) params.push(`%${k}%`, `%${k}%`);
    }
    if (q.expiring === "1") {
      const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
      where.push("expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?");
      params.push(new Date().toISOString(), soon);
    }

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const order = SORTS[q.sort ?? "score"] ?? SORTS.score;
    const rows = all<ItemRow>(`SELECT * FROM items ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset);
    const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM items ${clause}`, ...params)?.n ?? 0;
    return c.json({ total, limit, offset, items: rows.map((r) => shape(r, subKeywords)) });
  });

  app.get("/api/items/:id", (c) => {
    const row = get<ItemRow>("SELECT * FROM items WHERE id = ?", Number(c.req.param("id")));
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(shape(row));
  });

  app.patch("/api/items/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { starred?: boolean; status?: string };
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (typeof body.starred === "boolean") {
      sets.push("starred = ?");
      params.push(body.starred ? 1 : 0);
    }
    if (body.status && ["active", "ignored", "expired"].includes(body.status)) {
      sets.push("status = ?");
      params.push(body.status);
    }
    if (!sets.length) return c.json({ error: "nothing to update" }, 400);
    params.push(id);
    get(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`, ...params);
    const row = get<ItemRow>("SELECT * FROM items WHERE id = ?", id);
    return row ? c.json(shape(row)) : c.json({ error: "not found" }, 404);
  });

  app.get("/api/sources", (c) => {
    const sourceRows = all<Record<string, unknown>>("SELECT * FROM sources ORDER BY id");
    const stats = all<{ source_id: string; n: number; last_published: string | null }>(
      "SELECT source_id, COUNT(*) AS n, MAX(COALESCE(published_at, first_seen_at)) AS last_published FROM items GROUP BY source_id",
    );
    const byId = new Map(stats.map((s) => [s.source_id, s]));
    return c.json({
      sources: sourceRows.map((s) => ({
        ...s,
        enabled: s.enabled === 1,
        config: JSON.parse(String(s.config ?? "{}")),
        items: byId.get(String(s.id))?.n ?? 0,
        latest_item_at: byId.get(String(s.id))?.last_published ?? null,
      })),
    });
  });

  app.get("/api/runs", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
    return c.json({ runs: all("SELECT * FROM runs ORDER BY id DESC LIMIT ?", limit) });
  });

  app.get("/api/subscriptions", (c) => {
    const rows = all<{ id: number; keyword: string; created_at: string; last_hit_at: string | null }>(
      "SELECT id, keyword, created_at, last_hit_at FROM subscriptions ORDER BY keyword",
    );
    const hits = all<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE status = 'active'").at(0)?.n ?? 0;
    return c.json({ subscriptions: rows, activeItems: hits });
  });

  app.post("/api/subscriptions", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { keyword?: string } | null;
    const keyword = (body?.keyword ?? "").trim();
    if (!keyword || keyword.length > 40) return c.json({ error: "keyword 必填且不超过 40 字" }, 400);
    run(
      "INSERT INTO subscriptions (keyword, created_at) VALUES (?, ?) ON CONFLICT(keyword) DO NOTHING",
      keyword,
      new Date().toISOString(),
    );
    const rows = all<{ id: number; keyword: string; created_at: string; last_hit_at: string | null }>(
      "SELECT id, keyword, created_at, last_hit_at FROM subscriptions ORDER BY keyword",
    );
    return c.json({ subscriptions: rows });
  });

  app.delete("/api/subscriptions/:id", (c) => {
    run("DELETE FROM subscriptions WHERE id = ?", Number(c.req.param("id")));
    const rows = all<{ id: number; keyword: string; created_at: string; last_hit_at: string | null }>(
      "SELECT id, keyword, created_at, last_hit_at FROM subscriptions ORDER BY keyword",
    );
    return c.json({ subscriptions: rows });
  });
  app.get("/api/stats", (c) => {
    const totals = get<{ total: number; active: number; starred: number; expired: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN starred=1 THEN 1 ELSE 0 END) AS starred,
              SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= ? THEN 1 ELSE 0 END) AS expired
       FROM items`,
      new Date().toISOString(),
    );
    const byCategory = all<{ category: string | null; n: number }>(
      "SELECT category, COUNT(*) AS n FROM items WHERE status='active' GROUP BY category ORDER BY n DESC",
    );
    const bySource = all<{ source_id: string; n: number }>(
      "SELECT source_id, COUNT(*) AS n FROM items WHERE status='active' GROUP BY source_id ORDER BY n DESC",
    );
    const last24h = get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM items WHERE COALESCE(published_at, first_seen_at) >= ?",
      new Date(Date.now() - 86_400_000).toISOString(),
    );
    return c.json({
      totals: {
        total: totals?.total ?? 0,
        active: totals?.active ?? 0,
        starred: totals?.starred ?? 0,
        expired: totals?.expired ?? 0,
        last24h: last24h?.n ?? 0,
      },
      byCategory,
      bySource,
      price: get<{ free: number; under5: number; under10: number; known: number }>(
        `SELECT SUM(CASE WHEN is_free = 1 OR price = 0 THEN 1 ELSE 0 END) AS free,
                SUM(CASE WHEN price IS NOT NULL AND price > 0 AND price <= 5 THEN 1 ELSE 0 END) AS under5,
                SUM(CASE WHEN price IS NOT NULL AND price > 5 AND price <= 10 THEN 1 ELSE 0 END) AS under10,
                SUM(CASE WHEN price IS NOT NULL OR is_free = 1 THEN 1 ELSE 0 END) AS known
         FROM items WHERE status = 'active'`,
      ),
      features: { ai: aiEnabled, push: pushEnabled, pushChannel: config.pushChannel },
    });
  });

  app.post("/api/ingest", async (c) => {
    if (!config.ingestToken) return c.json({ error: "INGEST_TOKEN 未配置，拒绝写入" }, 403);
    const auth = c.req.header("authorization") ?? "";
    if (auth !== "Bearer " + config.ingestToken) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { sourceId?: string; items?: unknown[] } | null;
    if (!body?.sourceId || !Array.isArray(body.items)) return c.json({ error: "sourceId 与 items 必填" }, 400);
    const items = body.items.filter((i): i is RawItem => {
      const r = i as RawItem | null;
      return Boolean(r && typeof r.title === "string" && typeof r.url === "string");
    });
    const saved = ingestItems(body.sourceId, items);
    return c.json({ ok: true, received: body.items.length, ...saved });
  });

  app.post("/api/ingest/failed", async (c) => {
    if (!config.ingestToken) return c.json({ error: "INGEST_TOKEN 未配置" }, 403);
    const auth = c.req.header("authorization") ?? "";
    if (auth !== "Bearer " + config.ingestToken) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => null)) as { sourceId?: string; reason?: string; status?: string } | null;
    if (!body?.sourceId || !body.reason) return c.json({ error: "sourceId 与 reason 必填" }, 400);
    const status = body.status === "failed" ? "failed" : "degraded";
    return c.json(markSourceFailure(body.sourceId, body.reason, status));
  });
  app.get("/api/digests", (c) => {
    return c.json({ digests: all("SELECT date, item_ids, created_at, pushed_at FROM digests ORDER BY date DESC LIMIT 30") });
  });

  app.get("/api/digests/:date", (c) => {
    const date = c.req.param("date");
    const row = get<{ date: string; item_ids: string; payload: string; created_at: string; pushed_at: string | null }>(
      "SELECT date, item_ids, payload, created_at, pushed_at FROM digests WHERE date = ?",
      date,
    );
    if (!row) return c.json({ error: "not found" }, 404);
    let ids: number[] = [];
    try { ids = JSON.parse(row.item_ids) as number[]; } catch { ids = []; }
    let text = "";
    try { text = String((JSON.parse(row.payload) as { text?: string }).text ?? ""); } catch { text = ""; }
    const items = ids.length
      ? all<ItemRow>(`SELECT * FROM items WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids)
      : [];
    const subKeywords = all<{ keyword: string }>("SELECT keyword FROM subscriptions").map((r) => r.keyword);
    return c.json({ date: row.date, created_at: row.created_at, pushed_at: row.pushed_at, text, count: ids.length, items: items.map((r) => shape(r, subKeywords)) });
  });
}

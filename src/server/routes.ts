import type { Hono } from "hono";
import { all, get, run, type SqlValue } from "./db.ts";
import { aiEnabled, config, pushEnabled } from "./config.ts";
import { addCustomRssSource, ingestItems, markSourceFailure, runSource } from "./collectors/index.ts";
import type { RawItem } from "./collectors/types.ts";
import { sendTelegram } from "./digest.ts";
import {
  DEFAULT_SETTINGS,
  flushBatch,
  getPushSettings,
  inQuietHoursZoned,
  previewPush,
  pushStats,
  queueSize,
  recentPushLog,
  savePushSettings,
  type PushSettings,
} from "./push.ts";
import {
  compileRule,
  loadActiveBlockRules,
  matchBlockRules,
  PRESET_NOISE_PATTERNS,
  type BlockRule,
} from "./enrich/blocklist.ts";

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
  content?: string | null;
  status: string;
  starred: number;
  ai: string | null;
  read_at?: string | null;
  pushed_at?: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

/** 订阅命中的关键词（都转小写比较），用于前端高亮与筛选。 */
function matchKeywords(row: ItemRow, keywords: string[]): string[] {
  if (!keywords.length) return [];
  const text = (row.title + " " + (row.summary ?? "")).toLowerCase();
  return keywords.filter((k) => text.includes(k.toLowerCase()));
}

function shape(row: ItemRow, keywords: string[] = [], blockedBy: string | null = null) {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    tags = [];
  }
  let codes: string[] = [];
  try {
    codes = JSON.parse(row.codes ?? "[]") as string[];
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
    read: Boolean(row.read_at),
    raw: undefined,
    matched: matchKeywords(row, keywords),
    blockedBy,
  };
}

const SORTS: Record<string, string> = {
  score: "score DESC, COALESCE(published_at, first_seen_at) DESC",
  newest: "COALESCE(published_at, first_seen_at) DESC",
  oldest: "COALESCE(published_at, first_seen_at) ASC",
  price_asc: "CASE WHEN is_free = 1 THEN 0 WHEN price IS NOT NULL THEN price ELSE 999999 END ASC, score DESC",
};

function buildItemsQuery(q: Record<string, string | undefined>, rules: BlockRule[], includeBlocked: boolean) {
  const where: string[] = [];
  const params: SqlValue[] = [];

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
  if (q.unread === "1") where.push("read_at IS NULL");
  if (q.hasCodes === "1") where.push("codes != '[]' AND codes != ''");
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
  if (q.freeOnly === "1") where.push("(is_free = 1 OR price = 0)");
  if (q.maxPrice) {
    const cap = Number(q.maxPrice);
    if (Number.isFinite(cap) && cap >= 0) {
      where.push("((is_free = 1 OR price = 0) OR (price IS NOT NULL AND price <= ?))");
      params.push(cap);
    }
  }

  const subKeywords = all<{ keyword: string }>("SELECT keyword FROM subscriptions ORDER BY keyword").map((r) => r.keyword);
  if (q.subscribed === "1") {
    if (subKeywords.length) {
      const likes = subKeywords.map(() => "(title LIKE ? OR COALESCE(summary,'') LIKE ?)").join(" OR ");
      where.push("(" + likes + ")");
      for (const k of subKeywords) params.push(`%${k}%`, `%${k}%`);
    } else {
      where.push("1 = 0");
    }
  }
  if (q.expiring === "1") {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    where.push("expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?");
    params.push(new Date().toISOString(), soon);
  }

  // 屏蔽词下推：keyword 规则走 SQL NOT LIKE，regex 规则精确排除 id
  if (!includeBlocked && rules.length) {
    const regexRules: BlockRule[] = [];
    for (const r of rules) {
      if (r.mode === "regex") {
        regexRules.push(r);
        continue;
      }
      const pat = `%${r.pattern.toLowerCase()}%`;
      if (r.scope === "all") {
        where.push("LOWER(title || ' ' || COALESCE(summary,'')) NOT LIKE ?");
        params.push(pat);
      } else {
        where.push("(source_id != ? OR LOWER(title || ' ' || COALESCE(summary,'')) NOT LIKE ?)");
        params.push(r.scope, pat);
      }
    }
    if (regexRules.length) {
      const candidates = all<{ id: number; source_id: string; title: string; summary: string | null }>(
        "SELECT id, source_id, title, summary FROM items WHERE status = 'active'",
      );
      const blockedIds: number[] = [];
      const compiled = regexRules.map((r) => compileRule(r));
      for (const row of candidates) {
        const text = row.title + " " + (row.summary ?? "");
        if (compiled.some((fn) => fn(text, row.source_id))) blockedIds.push(row.id);
      }
      if (blockedIds.length) {
        where.push(`id NOT IN (${blockedIds.map(() => "?").join(",")})`);
        params.push(...blockedIds);
      }
    }
  }

  return { where, params, subKeywords };
}

export function registerApi(app: Hono) {
  app.get("/api/items", (c) => {
    const q = c.req.query();
    const limit = Math.min(Math.max(Number(q.limit ?? 40), 1), 200);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const includeBlocked = q.includeBlocked === "1";
    const rules = loadActiveBlockRules();

    const { where, params, subKeywords } = buildItemsQuery(q, rules, includeBlocked);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const order = SORTS[q.sort ?? "score"] ?? SORTS.score;
    const rows = all<ItemRow>(
      `SELECT * FROM items ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM items ${clause}`, ...params)?.n ?? 0;

    return c.json({
      total,
      limit,
      offset,
      items: rows.map((r) => {
        const hit = includeBlocked ? matchBlockRules(r, rules) : null;
        return shape(r, subKeywords, hit ? hit.pattern : null);
      }),
    });
  });

  app.get("/api/export", (c) => {
    const q = c.req.query();
    const format = q.format === "json" ? "json" : "md";
    const rules = loadActiveBlockRules();
    const { where, params, subKeywords } = buildItemsQuery(q, rules, false);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const order = SORTS[q.sort ?? "score"] ?? SORTS.score;
    const rows = all<ItemRow>(`SELECT * FROM items ${clause} ORDER BY ${order} LIMIT 300`, ...params);

    if (format === "json") {
      return c.json({ count: rows.length, items: rows.map((r) => shape(r, subKeywords)) });
    }
    const lines = [`# 白嫖雷达导出 (${new Date().toISOString().slice(0, 10)}) · ${rows.length} 条`, ""];
    for (const r of rows) {
      const s = shape(r, subKeywords);
      const tags = [s.source_id, s.category, s.is_free === 1 ? "白嫖" : s.price ? `≤${Math.round(s.price)}元` : null]
        .filter(Boolean)
        .join(" · ");
      lines.push(`- [${r.title}](${r.url}) — *${tags}*` + (s.codes.length ? ` \`${s.codes.join(" / ")}\`` : ""));
    }
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="freebie-radar-${new Date().toISOString().slice(0, 10)}.md"`);
    return c.body(lines.join("\n"));
  });

  app.get("/api/items/:id", (c) => {
    const row = get<ItemRow>("SELECT * FROM items WHERE id = ?", Number(c.req.param("id")));
    if (!row) return c.json({ error: "not found" }, 404);
    const subKeywords = all<{ keyword: string }>("SELECT keyword FROM subscriptions").map((r) => r.keyword);
    return c.json(shape(row, subKeywords));
  });

  app.patch("/api/items/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { starred?: boolean; status?: string; read?: boolean };
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (typeof body.starred === "boolean") {
      sets.push("starred = ?");
      params.push(body.starred ? 1 : 0);
    }
    if (body.status && ["active", "ignored", "expired"].includes(body.status)) {
      sets.push("status = ?");
      params.push(body.status);
    }
    if (typeof body.read === "boolean") {
      sets.push("read_at = ?");
      params.push(body.read ? new Date().toISOString() : null);
    }
    if (!sets.length) return c.json({ error: "nothing to update" }, 400);
    params.push(id);
    run(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`, ...params);
    const row = get<ItemRow>("SELECT * FROM items WHERE id = ?", id);
    return row ? c.json(shape(row)) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/items/batch", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { ids?: number[]; action?: string } | null;
    if (!body?.ids?.length || !body.action) return c.json({ error: "ids 与 action 必填" }, 400);
    const ids = body.ids.filter((n) => Number.isInteger(n)).slice(0, 200);
    if (!ids.length) return c.json({ updated: 0 });
    const ph = ids.map(() => "?").join(",");
    const now = new Date().toISOString();
    switch (body.action) {
      case "read":
        run(`UPDATE items SET read_at = ? WHERE id IN (${ph})`, now, ...ids);
        break;
      case "unread":
        run(`UPDATE items SET read_at = NULL WHERE id IN (${ph})`, ...ids);
        break;
      case "ignore":
        run(`UPDATE items SET status = 'ignored' WHERE id IN (${ph})`, ...ids);
        break;
      case "restore":
        run(`UPDATE items SET status = 'active' WHERE id IN (${ph})`, ...ids);
        break;
      default:
        return c.json({ error: "unsupported action" }, 400);
    }
    return c.json({ ok: true, updated: ids.length });
  });

  // ---- 屏蔽词管理 ----
  app.get("/api/block-rules", (c) => {
    const rules = all<BlockRule>("SELECT id, pattern, mode, scope, enabled, created_at FROM block_rules ORDER BY id DESC");
    const activeItems = all<{ id: number; source_id: string; title: string; summary: string | null }>(
      "SELECT id, source_id, title, summary FROM items WHERE status = 'active'",
    );
    const enriched = rules.map((r) => {
      const matcher = compileRule(r);
      let hits = 0;
      for (const it of activeItems) {
        if (matcher(it.title + " " + (it.summary ?? ""), it.source_id)) hits += 1;
      }
      return { ...r, enabled: r.enabled === 1, hits };
    });

    // 统计全部启用规则合计挡掉多少条
    const enabledRules = rules.filter((r) => r.enabled === 1);
    let totalBlocked = 0;
    if (enabledRules.length) {
      const matchers = enabledRules.map((r) => compileRule(r));
      for (const it of activeItems) {
        const text = it.title + " " + (it.summary ?? "");
        if (matchers.some((m) => m(text, it.source_id))) totalBlocked += 1;
      }
    }

    return c.json({ rules: enriched, totalBlocked, presets: PRESET_NOISE_PATTERNS });
  });

  app.post("/api/block-rules", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      pattern?: string;
      mode?: string;
      scope?: string;
      presets?: boolean;
    } | null;

    const now = new Date().toISOString();
    if (body?.presets) {
      for (const p of PRESET_NOISE_PATTERNS) {
        run(
          "INSERT INTO block_rules (pattern, mode, scope, enabled, created_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(pattern, scope) DO UPDATE SET enabled = 1",
          p.pattern,
          p.mode,
          p.scope,
          now,
        );
      }
      return c.json({ ok: true, added: PRESET_NOISE_PATTERNS.length });
    }

    const pattern = (body?.pattern ?? "").trim();
    if (!pattern || pattern.length > 80) return c.json({ error: "pattern 必填且不超过 80 字" }, 400);
    const mode = body?.mode === "regex" ? "regex" : "keyword";
    if (mode === "regex") {
      try {
        new RegExp(pattern, "i");
      } catch {
        return c.json({ error: "正则表达式语法无效" }, 400);
      }
    }
    const scope = (body?.scope ?? "all").trim() || "all";
    run(
      "INSERT INTO block_rules (pattern, mode, scope, enabled, created_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(pattern, scope) DO UPDATE SET mode = excluded.mode, enabled = 1",
      pattern,
      mode,
      scope,
      now,
    );
    return c.json({ ok: true });
  });

  app.patch("/api/block-rules/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") return c.json({ error: "enabled required" }, 400);
    run("UPDATE block_rules SET enabled = ? WHERE id = ?", body.enabled ? 1 : 0, id);
    return c.json({ ok: true });
  });

  app.delete("/api/block-rules/:id", (c) => {
    run("DELETE FROM block_rules WHERE id = ?", Number(c.req.param("id")));
    return c.json({ ok: true });
  });

  // ---- 数据源管理与手动触发 ----
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

  app.post("/api/sources", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: string; url?: string; intervalSec?: number } | null;
    const name = (body?.name ?? "").trim();
    const url = (body?.url ?? "").trim();
    if (!name || !/^https?:\/\//i.test(url)) return c.json({ error: "名称与合法的 http(s) RSS 地址必填" }, 400);
    const id = addCustomRssSource({ name, url, intervalSec: body?.intervalSec });
    const summary = await runSource(id).catch((err) => ({
      sourceId: id,
      status: "failed" as const,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      durationMs: 0,
      error: err instanceof Error ? err.message : String(err),
      cursor: null,
    }));
    return c.json({ ok: true, id, summary });
  });

  app.patch("/api/sources/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean; interval_sec?: number };
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (typeof body.enabled === "boolean") {
      sets.push("enabled = ?");
      params.push(body.enabled ? 1 : 0);
    }
    if (typeof body.interval_sec === "number" && Number.isFinite(body.interval_sec) && body.interval_sec >= 60) {
      sets.push("interval_sec = ?");
      params.push(Math.round(body.interval_sec));
    }
    if (!sets.length) return c.json({ error: "nothing to update" }, 400);
    params.push(id);
    run(`UPDATE sources SET ${sets.join(", ")} WHERE id = ?`, ...params);
    return c.json({ ok: true });
  });

  app.post("/api/sources/:id/collect", async (c) => {
    const id = c.req.param("id");
    const src = get<{ id: string; kind: string }>("SELECT id, kind FROM sources WHERE id = ?", id);
    if (!src) return c.json({ error: "source not found" }, 404);
    if (src.kind === "ingest") return c.json({ error: "该源由本机 Playwright 定时采集，无法从服务端直采" }, 400);
    const summary = await runSource(id);
    return c.json({ ok: true, summary });
  });

  app.get("/api/runs", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
    return c.json({ runs: all("SELECT * FROM runs ORDER BY id DESC LIMIT ?", limit) });
  });

  // ---- 订阅 ----
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
    const totals = get<{ total: number; active: number; starred: number; expired: number; withCodes: number; unread: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN starred=1 THEN 1 ELSE 0 END) AS starred,
              SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= ? THEN 1 ELSE 0 END) AS expired,
              SUM(CASE WHEN status='active' AND codes != '[]' AND codes != '' THEN 1 ELSE 0 END) AS withCodes,
              SUM(CASE WHEN status='active' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
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
    const blockRules = get<{ n: number }>("SELECT COUNT(*) AS n FROM block_rules WHERE enabled = 1")?.n ?? 0;

    return c.json({
      totals: {
        total: totals?.total ?? 0,
        active: totals?.active ?? 0,
        starred: totals?.starred ?? 0,
        expired: totals?.expired ?? 0,
        withCodes: totals?.withCodes ?? 0,
        unread: totals?.unread ?? 0,
        last24h: last24h?.n ?? 0,
        blockRules,
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

  // ---- 推送设置 / 预览 / 记录 ----
  app.get("/api/push", (c) => {
    return c.json({
      settings: getPushSettings(),
      defaults: DEFAULT_SETTINGS,
      stats: pushStats(),
      channel: config.pushChannel,
      ready: pushEnabled,
      quiet: (() => {
        const s = getPushSettings();
        return inQuietHoursZoned(s.quietHours, s.timezone);
      })(),
    });
  });

  app.patch("/api/push", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<PushSettings> | null;
    if (!body) return c.json({ error: "无效的请求体" }, 400);
    const settings = savePushSettings(body);
    return c.json({ settings, stats: pushStats(), quiet: inQuietHoursZoned(settings.quietHours, settings.timezone) });
  });

  app.get("/api/push/preview", (c) => {
    return c.json(previewPush(Math.min(Math.max(Number(c.req.query("limit") ?? 6), 1), 12)));
  });

  app.get("/api/push/log", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 30), 1), 100);
    return c.json({ logs: recentPushLog(limit) });
  });

  app.post("/api/push/flush", async (c) => {
    const sent = await flushBatch(true);
    return c.json({ ok: true, sent, queued: queueSize() });
  });

  app.post("/api/push/test", async (c) => {
    if (!pushEnabled || config.pushChannel !== "telegram" || !config.telegramBotToken || !config.telegramChatId) {
      return c.json({ error: "Telegram 推送未启用或缺少凭据" }, 400);
    }
    await sendTelegram("🛰 白嫖雷达测试消息 · " + new Date().toLocaleString("zh-CN"));
    return c.json({ ok: true });
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
    try {
      ids = JSON.parse(row.item_ids) as number[];
    } catch {
      ids = [];
    }
    let text = "";
    try {
      text = String((JSON.parse(row.payload) as { text?: string }).text ?? "");
    } catch {
      text = "";
    }
    const items = ids.length
      ? all<ItemRow>(`SELECT * FROM items WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids)
      : [];
    const subKeywords = all<{ keyword: string }>("SELECT keyword FROM subscriptions").map((r) => r.keyword);
    return c.json({
      date: row.date,
      created_at: row.created_at,
      pushed_at: row.pushed_at,
      text,
      count: ids.length,
      items: items.map((r) => shape(r, subKeywords)),
    });
  });
}

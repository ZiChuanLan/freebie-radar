import { aiEnabled, config } from "../config.ts";
import { all, get, run, tx } from "../db.ts";
import { enrichItem } from "../enrich/index.ts";
import { reviewItems, type AiVerdict } from "../enrich/ai.ts";
import { createHttp, type HttpClient } from "../http.ts";
import { mockCollector } from "./mock.ts";
import { linuxdoCollector } from "./linuxdo.ts";
import { v2exCollector } from "./v2ex.ts";
import { githubCollector } from "./github.ts";
import { rssCollector } from "./rss.ts";
import { telegramCollector } from "./telegram.ts";
import type { Collector, RawItem, SourceSeed } from "./types.ts";

export const COLLECTORS: Collector[] = [mockCollector, linuxdoCollector, v2exCollector, githubCollector, rssCollector, telegramCollector];
const BY_KIND = new Map(COLLECTORS.map((c) => [c.kind, c]));

/** 内置源清单；collector 落地后在此追加。 */
export const SEEDS: SourceSeed[] = [
  { id: "linuxdo-welfare", name: "LINUX DO · 福利羊毛", kind: "linuxdo", enabled: true, config: { categoryId: 36 } },
  { id: "linuxdo-resource", name: "LINUX DO · 资源荟萃", kind: "linuxdo", enabled: true, config: { categoryId: 14 } },
  { id: "v2ex-free", name: "V2EX · 免费赠送", kind: "v2ex", enabled: true, config: { node: "free" } },
  { id: "github-free-for-dev", name: "GitHub · free-for-dev", kind: "github-readme", enabled: true, config: { repos: [{ repo: "ripienaar/free-for-dev", limit: 60 }] } },
  { id: "rss-fuliba", name: "福利吧", kind: "rss", enabled: true, config: { feeds: [{ id: "fuliba", url: "https://fuliba.net/feed", limit: 30 }] } },
  { id: "rss-52pojie", name: "吾爱破解", kind: "rss", enabled: true, config: { feeds: [{ id: "52pojie", url: "https://www.52pojie.cn/forum.php?mod=rss", limit: 20 }] } },
  { id: "rss-smzdm", name: "什么值得买", kind: "rss", enabled: true, config: { feeds: [{ id: "smzdm", url: "https://www.smzdm.com/rss/", limit: 20 }] } },
  { id: "tg-channels", name: "Telegram 羊毛频道", kind: "telegram", enabled: false, config: { channels: [] } },
  { id: "mock-source", name: "Mock 源", kind: "mock", enabled: false, config: {} },
];

type SourceRow = {
  id: string;
  name: string;
  kind: string;
  enabled: number;
  config: string;
  cursor: string | null;
};

export function ensureSources(seeds: SourceSeed[] = SEEDS): void {
  const now = new Date().toISOString();
  for (const s of seeds) {
    run(
      `INSERT INTO sources (id, name, kind, enabled, config, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind`,
      s.id,
      s.name,
      s.kind,
      s.enabled === false ? 0 : 1,
      JSON.stringify(s.config ?? {}),
      now,
    );
  }
}

export type RunSummary = {
  sourceId: string;
  status: "ok" | "degraded" | "failed";
  fetched: number;
  inserted: number;
  skipped: number;
  durationMs: number;
  error: string | null;
  cursor: string | null;
};

function persist(
  sourceId: string,
  items: RawItem[],
  aiMap?: Map<number, AiVerdict> | null,
): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  tx(() => {
    for (let index = 0; index < items.length; index += 1) {
      const raw = items[index]!;
      const e = enrichItem(raw, sourceId);
      if (!e) {
        skipped += 1;
        continue;
      }

      const verdict = aiMap?.get(index) ?? null;
      const score = verdict && !verdict.keep ? Math.round(e.score * 0.5) : e.score;
      const aiJson = verdict ? JSON.stringify(verdict) : null;
      const status = e.keep ? "active" : "expired";

      const existing = get<{ id: number }>(
        "SELECT id FROM items WHERE source_id = ? AND external_id = ?",
        sourceId,
        e.externalId,
      );
      if (existing) {
        run(
          `UPDATE items SET url = ?, url_key = ?, title = ?, summary = ?, author = ?, category = ?,
             tags = ?, score = ?, expires_at = ?, published_at = ?, raw = ?, last_seen_at = ?,
             ai = COALESCE(?, ai),
             status = CASE WHEN status = 'ignored' THEN 'ignored' ELSE ? END
           WHERE id = ?`,
          e.url,
          e.urlKey,
          e.title,
          e.summary ?? "",
          e.author ?? null,
          e.category,
          JSON.stringify(e.tags),
          score,
          e.expiresAt,
          e.publishedAt ?? null,
          JSON.stringify(e.raw ?? {}),
          now,
          aiJson,
          status,
          existing.id,
        );
        skipped += 1;
        continue;
      }
      try {
        run(
          `INSERT INTO items (source_id, external_id, url, url_key, title, summary, author, category,
             tags, score, expires_at, published_at, raw, status, ai, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          sourceId,
          e.externalId,
          e.url,
          e.urlKey,
          e.title,
          e.summary ?? "",
          e.author ?? null,
          e.category,
          JSON.stringify(e.tags),
          score,
          e.expiresAt,
          e.publishedAt ?? null,
          JSON.stringify(e.raw ?? {}),
          status,
          aiJson,
          now,
          now,
        );
        inserted += 1;
      } catch (err) {
        if (/UNIQUE/i.test(String(err))) {
          skipped += 1;
        } else {
          throw err;
        }
      }
    }
  });

  return { inserted, skipped };
}

export async function runSource(
  sourceId: string,
  options: { http?: HttpClient; maxItems?: number; log?: (message: string) => void } = {},
): Promise<RunSummary> {
  ensureSources();
  const log = options.log ?? ((m: string) => console.log(m));
  const source = get<SourceRow>("SELECT * FROM sources WHERE id = ?", sourceId);
  if (!source) throw new Error(`unknown source: ${sourceId}`);

  const collector = BY_KIND.get(source.kind);
  if (!collector) throw new Error(`no collector registered for kind: ${source.kind}`);

  const http =
    options.http ??
    createHttp({ proxy: config.httpsProxy || config.httpProxy, timeoutMs: config.fetchTimeoutMs, gapMs: config.minRequestGapMs });
  const maxItems = options.maxItems ?? config.maxItemsPerRun;

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runRow = run(
    "INSERT INTO runs (source_id, started_at, status) VALUES (?, ?, 'running')",
    sourceId,
    startedAt,
  );
  const runId = Number(runRow.lastInsertRowid);

  let status: RunSummary["status"] = "ok";
  let fetched = 0;
  let inserted = 0;
  let skipped = 0;
  let error: string | null = null;
  let cursor = source.cursor;

  try {
    const result = await collector.collect({
      sourceId,
      config: JSON.parse(source.config || "{}") as Record<string, unknown>,
      cursor: source.cursor,
      maxItems,
      http,
      log: (m) => log(`[${sourceId}] ${m}`),
    });
    fetched = result.items.length;
    let aiMap: Map<number, AiVerdict> | null = null;
    if (aiEnabled && result.items.length) {
      try {
        aiMap = await reviewItems(result.items);
        if (aiMap) {
          const rejected = [...aiMap.values()].filter((v) => !v.keep).length;
          log(`[${sourceId}] AI 二审 ${aiMap.size} 条，判定非福利 ${rejected} 条`);
        }
      } catch (err) {
        log(`[${sourceId}] AI 二审失败，降级为规则模式: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const saved = persist(sourceId, result.items, aiMap);
    inserted = saved.inserted;
    skipped = saved.skipped;
    if (result.cursor !== undefined) cursor = result.cursor;
    if (result.degraded) {
      status = "degraded";
      error = result.degraded;
    }
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  const durationMs = Date.now() - t0;
  const finishedAt = new Date().toISOString();

  run(
    "UPDATE runs SET finished_at = ?, status = ?, fetched = ?, inserted = ?, skipped = ?, duration_ms = ?, error = ? WHERE id = ?",
    finishedAt,
    status,
    fetched,
    inserted,
    skipped,
    durationMs,
    error,
    runId,
  );
  run(
    "UPDATE sources SET cursor = ?, last_run_at = ?, last_status = ?, last_error = ? WHERE id = ?",
    cursor,
    startedAt,
    status,
    error,
    sourceId,
  );

  log(
    `[collect] ${sourceId} fetched=${fetched} inserted=${inserted} skipped=${skipped} duration=${durationMs}ms status=${status}${
      error ? ` error=${error}` : ""
    }`,
  );

  return { sourceId, status, fetched, inserted, skipped, durationMs, error, cursor };
}

export async function runAll(
  options: { http?: HttpClient; maxItems?: number; log?: (message: string) => void } = {},
): Promise<RunSummary[]> {
  ensureSources();
  const rows = all<{ id: string }>("SELECT id FROM sources WHERE enabled = 1 ORDER BY id").map((r) => r.id);
  const filter = config.enabledSources;
  const targets = filter.length ? rows.filter((id) => filter.includes(id)) : rows;
  const out: RunSummary[] = [];
  for (const id of targets) {
    try {
      out.push(await runSource(id, options));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      (options.log ?? console.log)(`[collect] ${id} 启动失败: ${message}`);
      out.push({ sourceId: id, status: "failed", fetched: 0, inserted: 0, skipped: 0, durationMs: 0, error: message, cursor: null });
    }
  }
  return out;
}

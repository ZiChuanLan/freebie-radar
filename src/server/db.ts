import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./config.ts";

let db: DatabaseSync | null = null;

const SCHEMA_VERSION = 1;

const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE IF NOT EXISTS sources (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    config       TEXT NOT NULL DEFAULT '{}',
    cursor       TEXT,
    last_run_at  TEXT,
    last_status  TEXT,
    last_error   TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id    TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    status       TEXT NOT NULL DEFAULT 'running',
    fetched      INTEGER NOT NULL DEFAULT 0,
    inserted     INTEGER NOT NULL DEFAULT 0,
    skipped      INTEGER NOT NULL DEFAULT 0,
    duration_ms  INTEGER,
    error        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_runs_source ON runs(source_id, started_at DESC);

  CREATE TABLE IF NOT EXISTS items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id     TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    url           TEXT NOT NULL,
    url_key       TEXT NOT NULL,
    title         TEXT NOT NULL,
    summary       TEXT,
    author        TEXT,
    category      TEXT,
    tags          TEXT NOT NULL DEFAULT '[]',
    score         REAL NOT NULL DEFAULT 0,
    expires_at    TEXT,
    published_at  TEXT,
    raw           TEXT NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'active',
    starred       INTEGER NOT NULL DEFAULT 0,
    ai            TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    UNIQUE(source_id, external_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_items_url_key ON items(url_key);
  CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_items_score ON items(score DESC);
  CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
  CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);

  CREATE TABLE IF NOT EXISTS digests (
    date        TEXT PRIMARY KEY,
    item_ids    TEXT NOT NULL DEFAULT '[]',
    payload     TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    pushed_at   TEXT
  );
  `,

  /* v2：关键词订阅与提醒 */
  `
  CREATE TABLE IF NOT EXISTS subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword     TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL,
    last_hit_at TEXT

  );
  CREATE INDEX IF NOT EXISTS idx_subs_keyword ON subscriptions(keyword);
  `,

  /* v3：时效性 —— 每源采集间隔、正文快照、抽取到的兑换码 */
  `
  ALTER TABLE sources ADD COLUMN interval_sec INTEGER NOT NULL DEFAULT 10800;
  ALTER TABLE items ADD COLUMN content TEXT;
  ALTER TABLE items ADD COLUMN codes TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE items ADD COLUMN pushed_at TEXT;
  CREATE INDEX IF NOT EXISTS idx_items_codes ON items(codes);
  `,

  /* v4：价格 —— 「最高能付多少」筛选 */
  `
  ALTER TABLE items ADD COLUMN price REAL;
  ALTER TABLE items ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_items_price ON items(price);
  `,

  /* v5：屏蔽词规则 + 已读标记 */
  `
  CREATE TABLE IF NOT EXISTS block_rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern    TEXT NOT NULL,
    mode       TEXT NOT NULL DEFAULT 'keyword',
    scope      TEXT NOT NULL DEFAULT 'all',
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_block_unique ON block_rules(pattern, scope);
  ALTER TABLE items ADD COLUMN read_at TEXT;
  `,

  /* v6：推送设置 + 推送记录 + 标题归一化去重 */
  `
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    item_ids   TEXT NOT NULL DEFAULT '[]',
    text       TEXT NOT NULL DEFAULT '',
    count      INTEGER NOT NULL DEFAULT 0,
    ok         INTEGER NOT NULL DEFAULT 1,
    error      TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_push_log_time ON push_log(created_at DESC);
  ALTER TABLE items ADD COLUMN title_key TEXT;
  CREATE INDEX IF NOT EXISTS idx_items_title_key ON items(title_key);
  `,

  /* v7：把 AI 判定摊平成独立列 —— 用 json_extract 过滤会让 4000+ 行的查询从 0.7s 掉到 90s 超时 */
  `
  ALTER TABLE items ADD COLUMN ai_keep INTEGER;
  CREATE INDEX IF NOT EXISTS idx_items_ai_keep ON items(ai_keep);
  UPDATE items SET ai_keep = json_extract(ai, '$.keep') WHERE ai IS NOT NULL AND ai_keep IS NULL;
  `,

  /* v8：列表默认按 status + ai_keep 过滤再按 score 排序，5000+ 行没复合索引要 4 秒 */
  `
  CREATE INDEX IF NOT EXISTS idx_items_feed ON items(status, ai_keep, score DESC);
  CREATE INDEX IF NOT EXISTS idx_items_score ON items(score DESC);
  `,

  /* v9：不带 ai_keep 条件时，(status, ai_keep, score) 用不上排序，退化成全表排序 */
  `
  CREATE INDEX IF NOT EXISTS idx_items_status_score ON items(status, score DESC);
  `,

  /* v10：获取方式 —— 区分「直接白嫖」与抽奖/试用/推广/有条件，单独隔离 */
  `
  ALTER TABLE items ADD COLUMN obtain TEXT;
  CREATE INDEX IF NOT EXISTS idx_items_obtain ON items(obtain);
  `,

  /* v11：保鲜期查询要按 COALESCE(published_at, first_seen_at) 过滤，普通索引覆盖不到 */
  `
  CREATE INDEX IF NOT EXISTS idx_items_effective_time ON items(COALESCE(published_at, first_seen_at));
  `,

  /* v12：双语跨源别名字典，让英文与纯中文报道在同一 title_key 下合并 */
  `
  CREATE TABLE IF NOT EXISTS title_aliases (
    alias     TEXT PRIMARY KEY,
    canonical TEXT NOT NULL
  );
  `,

  /* v13：停用实测 0 留存的纯新闻/硬折扣/静态清单源，避免白占 AI 一审配额 */
  `
  UPDATE sources SET enabled = 0
   WHERE id IN (
     'rss-hnrss',
     'rss-9to5toys',
     'rss-52pojie',
     'rss-fuliba',
     'github-public-apis',
     'github-awesome-ai',
     'github-selfhosted'
   );
  `,

  /* v14：清理与 NodeSeek 重复的 tg-cn-deals 及实测 <1% 留存的泛资讯/静态源；Reddit 拉长周期防 429 */
  `
  UPDATE sources SET enabled = 0
   WHERE id IN (
     'tg-cn-deals',
     'rss-smzdm',
     'rss-ithome',
     'linuxdo-resource',
     'v2ex-share',
     'rss-producthunt',
     'rss-sspai',
     'rss-appinn',
     'rss-ruanyifeng',
     'rss-iapps',
     'github-free-for-dev'
   );
  UPDATE sources SET interval_sec = 2700
   WHERE id LIKE 'rss-reddit-%' AND interval_sec < 2700;
  `,
];

export function dbPath(): string {
  const p = config.databasePath;
  return p === ":memory:" ? p : resolve(process.cwd(), p);
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const path = dbPath();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // 调度器与手动 CLI 是两个进程共用一个 SQLite 文件，写锁竞争时多等一会儿，
  // 避免出现 "database is locked"（跑一次全量采集要几秒）。
  db.exec("PRAGMA busy_timeout = 20000;");
  db.function("is_zh", { deterministic: true }, (v) => {
    const t = typeof v === "string" ? v : "";
    let zh = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (c >= 0x4e00 && c <= 0x9fff) zh += 1;
    }
    return zh >= 2 && zh / Math.max(t.length, 1) >= 0.12 ? 1 : 0;
  });
  return db;
}

export function migrate(): number {
  const conn = getDb();
  const row = conn.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  const current = Number(row?.user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v += 1) {
    conn.exec(MIGRATIONS[v]!);
    conn.exec(`PRAGMA user_version = ${v + 1}`);
  }
  return Math.max(current, MIGRATIONS.length);
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export type SqlValue = string | number | bigint | null | Uint8Array;

export function all<T>(sql: string, ...params: SqlValue[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SqlValue[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SqlValue[]) {
  return getDb().prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  const conn = getDb();
  conn.exec("BEGIN");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

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
  db.exec("PRAGMA busy_timeout = 5000;");
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

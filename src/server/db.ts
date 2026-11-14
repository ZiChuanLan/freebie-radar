/**
 * 数据库后端抽象：默认 Durable Object SQLite（storage.sql，同步 API，
 * 与原 node:sqlite 语义一致）。测试用 initDbBackend() 注入 node:sqlite 适配器。
 *
 * 初始化：RadarDO 构造时调用 initDb(ctx.storage)。
 */

export type SqlValue = string | number | bigint | null | Uint8Array;

export type ExecResult = { rows: Record<string, unknown>[]; rowsWritten: number };

export interface DbBackend {
  exec(query: string, params: SqlValue[]): ExecResult;
  transactionSync<T>(fn: () => T): T;
}

let backend: DbBackend | null = null;

export function initDb(storage: DurableObjectStorage): void {
  backend = {
    exec: (query, params) => {
      const cur = storage.sql.exec(query, ...params);
      const rows = cur.toArray() as Record<string, unknown>[];
      return { rows, rowsWritten: cur.rowsWritten };
    },
    transactionSync: (fn) => storage.transactionSync(fn),
  };
}

/** 测试/脚本专用：注入自定义后端（如 node:sqlite 适配器） */
export function initDbBackend(b: DbBackend): void {
  backend = b;
}

export function closeDb(): void {
  backend = null;
}

function S(): DbBackend {
  if (!backend) throw new Error("db not initialized — call initDb()/initDbBackend() first");
  return backend;
}

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

  /* v15：引入内容形态 kind 与 AI 质量分 ai_quality，解耦「低噪有效」与「必须免费白嫖」 */
  `
  ALTER TABLE items ADD COLUMN kind TEXT;
  ALTER TABLE items ADD COLUMN ai_quality INTEGER;
  CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
  UPDATE items
     SET kind = CASE
       WHEN ai_keep = 0 THEN 'noise'
       WHEN category = 'opensource' THEN 'opensource'
       WHEN obtain = 'paid' THEN 'deal'
       ELSE 'freebie'
     END
   WHERE kind IS NULL;
  UPDATE items
     SET ai_quality = json_extract(ai, '$.quality')
   WHERE ai IS NOT NULL AND ai_quality IS NULL;
  `,

  /* v16：保存封面图 URL，支撑 2/3 列图文卡片布局 */
  `
  ALTER TABLE items ADD COLUMN image_url TEXT;
  `,

  /* v17：is_zh 从 SQLite UDF 改落入库列 —— DO sqlite 不支持自定义函数 */
  `
  ALTER TABLE items ADD COLUMN is_zh INTEGER;
  `,
];

export function migrate(): number {
  const conn = S();
  // DO sqlite 禁 PRAGMA user_version —— 版本落在自建表里
  conn.exec("CREATE TABLE IF NOT EXISTS __migrations (v INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)", []);
  const row = conn.exec("SELECT MAX(v) AS v FROM __migrations", []).rows[0] as { v: number | null } | undefined;
  const current = Number(row?.v ?? 0);
  for (let v = current; v < MIGRATIONS.length; v += 1) {
    conn.exec(MIGRATIONS[v]!, []);
    conn.exec("INSERT INTO __migrations (v, applied_at) VALUES (?, ?)", [v + 1, new Date().toISOString()]);
  }
  // v17 回填：老数据迁移进来时补算（全新部署为空表，秒过）
  if (current <= 16) {
    const rows = conn.exec("SELECT id, title FROM items WHERE is_zh IS NULL", []).rows as { id: number; title: string }[];
    for (const r of rows) conn.exec("UPDATE items SET is_zh = ? WHERE id = ?", [isZhText(r.title) ? 1 : 0, r.id]);
  }
  return Math.max(current, MIGRATIONS.length);
}

/** 与旧 node:sqlite 版 db.function("is_zh") 同一判据，供入库时写列与迁移回填共用 */
export function isZhText(t: string): boolean {
  let zh = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0x4e00 && c <= 0x9fff) zh += 1;
  }
  return zh >= 2 && zh / Math.max(t.length, 1) >= 0.12;
}

export function all<T>(sql: string, ...params: SqlValue[]): T[] {
  return S().exec(sql, params).rows as T[];
}

export function get<T>(sql: string, ...params: SqlValue[]): T | undefined {
  return S().exec(sql, params).rows[0] as T | undefined;
}

export function run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint } {
  const res = S().exec(sql, params);
  let lastInsertRowid: number | bigint = 0;
  if (/^\s*insert/i.test(sql)) {
    const r = S().exec("SELECT last_insert_rowid() AS id", []).rows[0] as { id: number } | undefined;
    lastInsertRowid = r?.id ?? 0;
  }
  return { changes: res.rowsWritten, lastInsertRowid };
}

export function tx<T>(fn: () => T): T {
  return S().transactionSync(fn);
}

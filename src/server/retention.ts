import { all, get, run } from "./db.ts";

/**
 * 数据保留策略：站点跑久了 items 会无限增长（现在已 7000+），
 * 但真正有价值的只有最近一段时间内的福利，老数据既占空间又拖慢列表。
 *
 * 原则：
 *  - 收藏的永不删
 *  - AI 判定是福利的多留一段时间
 *  - 手动关闭（ignored）的尽快清掉
 *  - 推送日志、日报只留最近一段
 */
export type RetentionSettings = {
  /** 普通条目保留天数：超过且非福利、非收藏的删掉 */
  itemDays: number;
  /** AI 判定是福利的条目保留天数（通常比普通条目长） */
  keptDays: number;
  /** 手动关闭（ignored）的保留天数 */
  ignoredDays: number;
  /** 推送日志保留天数 */
  pushLogDays: number;
  /** 每日精选保留天数 */
  digestDays: number;
  /** 是否每天自动清理 */
  auto: boolean;
};

export const DEFAULT_RETENTION: RetentionSettings = {
  itemDays: 60,
  keptDays: 180,
  ignoredDays: 14,
  pushLogDays: 30,
  digestDays: 90,
  auto: true,
};

const KEY = "retention";

function numOr(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

export function getRetention(): RetentionSettings {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", KEY);
  if (!row) return { ...DEFAULT_RETENTION };
  try {
    const raw = JSON.parse(row.value) as Partial<RetentionSettings>;
    return {
      itemDays: numOr(raw.itemDays, DEFAULT_RETENTION.itemDays, 1, 3650),
      keptDays: numOr(raw.keptDays, DEFAULT_RETENTION.keptDays, 1, 3650),
      ignoredDays: numOr(raw.ignoredDays, DEFAULT_RETENTION.ignoredDays, 1, 3650),
      pushLogDays: numOr(raw.pushLogDays, DEFAULT_RETENTION.pushLogDays, 1, 3650),
      digestDays: numOr(raw.digestDays, DEFAULT_RETENTION.digestDays, 1, 3650),
      auto: raw.auto !== false,
    };
  } catch {
    return { ...DEFAULT_RETENTION };
  }
}

export function saveRetention(patch: Partial<RetentionSettings>): RetentionSettings {
  const cur = getRetention();
  const next: RetentionSettings = {
    itemDays: numOr(patch.itemDays ?? cur.itemDays, cur.itemDays, 1, 3650),
    keptDays: numOr(patch.keptDays ?? cur.keptDays, cur.keptDays, 1, 3650),
    ignoredDays: numOr(patch.ignoredDays ?? cur.ignoredDays, cur.ignoredDays, 1, 3650),
    pushLogDays: numOr(patch.pushLogDays ?? cur.pushLogDays, cur.pushLogDays, 1, 3650),
    digestDays: numOr(patch.digestDays ?? cur.digestDays, cur.digestDays, 1, 3650),
    auto: typeof patch.auto === "boolean" ? patch.auto : cur.auto,
  };
  run(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    KEY,
    JSON.stringify(next),
    new Date().toISOString(),
  );
  return next;
}

export type CleanupReport = {
  deleted: Record<string, number>;
  remaining: number;
  at: string;
};

/** 执行一次清理，返回删了多少。dryRun 只统计不删。 */
export function runCleanup(s?: RetentionSettings, dryRun = false): CleanupReport {
  const cfg = s ?? getRetention();
  const now = Date.now();
  const iso = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const deleted: Record<string, number> = {};

  const plans: { label: string; sql: string; params: (string | number)[] }[] = [
    {
      label: "过期非福利条目",
      sql: `DELETE FROM items
            WHERE starred = 0 AND status = 'active'
              AND COALESCE(ai_keep, 0) != 1
              AND COALESCE(published_at, first_seen_at) < ?`,
      params: [iso(cfg.itemDays)],
    },
    {
      label: "过期福利条目",
      sql: `DELETE FROM items
            WHERE starred = 0
              AND COALESCE(ai_keep, 0) = 1
              AND COALESCE(published_at, first_seen_at) < ?`,
      params: [iso(cfg.keptDays)],
    },
    {
      label: "手动关闭的条目",
      sql: `DELETE FROM items WHERE starred = 0 AND status = 'ignored' AND COALESCE(published_at, first_seen_at) < ?`,
      params: [iso(cfg.ignoredDays)],
    },
    {
      label: "推送日志",
      sql: "DELETE FROM push_log WHERE created_at < ?",
      params: [iso(cfg.pushLogDays)],
    },
    {
      label: "每日精选",
      sql: "DELETE FROM digests WHERE created_at < ?",
      params: [iso(cfg.digestDays)],
    },
  ];

  for (const p of plans) {
    if (dryRun) {
      const n = get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM (" + p.sql.replace(/^DELETE FROM/, "SELECT 1 FROM") + ")",
        ...p.params,
      );
      deleted[p.label] = n?.n ?? 0;
    } else {
      const info = run(p.sql, ...p.params);
      deleted[p.label] = Number(info.changes);
    }
  }

  const remaining = get<{ n: number }>("SELECT COUNT(*) AS n FROM items")?.n ?? 0;
  return { deleted, remaining, at: new Date().toISOString() };
}

/** 数据库体积（MB），用于判断清理是否必要。 */
export function dbSizeMb(path: string): number {
  try {
    // 这里不在运行时读文件，交给调用方；保留占位避免引入 fs 依赖
    return 0;
  } catch {
    return 0;
  }
}

export function itemCounts(): { total: number; active: number; ignored: number; starred: number } {
  const r = get<{ total: number; active: number; ignored: number; starred: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status='ignored' THEN 1 ELSE 0 END) AS ignored,
            SUM(CASE WHEN starred=1 THEN 1 ELSE 0 END) AS starred
     FROM items`,
  );
  return { total: r?.total ?? 0, active: r?.active ?? 0, ignored: r?.ignored ?? 0, starred: r?.starred ?? 0 };
}

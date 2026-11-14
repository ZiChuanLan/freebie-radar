/**
 * 推送模块的历史入口，实际实现已迁到 push.ts（设置、攒批、静默时段、日志都在那里）。
 * 保留这些导出，避免改动 collectors 里已有调用点。
 */
export {
  pushInstant,
  pushReviewedByIds,
  pushStats,
  previewPush,
  flushBatch,
  queueSize,
  recentPushLog,
  startPushScheduler,
  getPushSettings,
  savePushSettings,
  detectLang,
  inQuietHoursZoned,
  isQuietNow,
  sourceLabel,
  type PushSettings,
  type PushRoute,
  type PushTiming,
  type AiFallbackMode,
  type PushSourceMode,
  type QuietAction,
  DEFAULT_SETTINGS,
} from "./push.ts";

import { all, get } from "./db.ts";

/** 兼容旧调用：返回最近推过的条目（不含正文，避免列表过大）。 */
export function recentPushed(limit = 20) {
  return all(
    "SELECT id, source_id, title, url, score, codes, pushed_at FROM items WHERE pushed_at IS NOT NULL ORDER BY pushed_at DESC LIMIT ?",
    limit,
  );
}

export function instantStats(): { pushedLastHour: number; totalPushed: number } {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  return {
    pushedLastHour:
      get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM items WHERE pushed_at IS NOT NULL AND pushed_at >= ?",
        since,
      )?.n ?? 0,
    totalPushed: get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE pushed_at IS NOT NULL")?.n ?? 0,
  };
}

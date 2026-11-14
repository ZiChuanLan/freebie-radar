import { config } from "./config.ts";
import { all, get, run } from "./db.ts";
import { runSource } from "./collectors/index.ts";
import { digestExists, runDaily } from "./digest.ts";
import { getRetention, runCleanup } from "./retention.ts";

/** 极简 5 段 cron 匹配：分 时 日 月 周；支持 * , - /。 */
export function matchCron(expr: string, date: Date, utc = false): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const get = utc
    ? [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()]
    : [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  return parts.every((part, i) => matchField(part, get[i]!, ranges[i]![0], ranges[i]![1]));
}

export function matchField(field: string, value: number, min: number, max: number): boolean {
  for (const chunk of field.split(",")) {
    const [rangePart, stepPart] = chunk.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step <= 0) return false;
    let start = min;
    let end = max;
    if (rangePart && rangePart !== "*") {
      const [a, b] = rangePart.split("-");
      start = Number(a);
      end = b === undefined ? (stepPart ? max : start) : Number(b);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    if (value < start || value > end) continue;
    if ((value - start) % step === 0) return true;
  }
  return false;
}

let collectBusy = false;

/**
 * CF 版：setInterval 换成 DO.tick()（由 Cron Trigger 每分钟驱动）。
 * due 源查询与原 interval scheduler 同一逻辑：到点就跑、串行避免打爆上游。
 * busy 标志替代原来的「tick 重入」防护 —— DO 可能并发处理 fetch 与 RPC。
 */
export async function collectTick(log: (m: string) => void = (m) => console.log(m)): Promise<void> {
  if (collectBusy) return;
  collectBusy = true;
  try {
    const due = all<{ id: string; interval_sec: number; last_run_at: string | null }>(
      `SELECT id, interval_sec, last_run_at FROM sources
        WHERE enabled = 1 AND kind != 'ingest'
          AND (last_run_at IS NULL OR datetime(last_run_at, '+' || interval_sec || ' seconds') <= datetime('now'))
        ORDER BY last_run_at IS NOT NULL, last_run_at ASC`,
    );
    const filter = config.enabledSources;
    for (const s of due) {
      if (filter.length && !filter.includes(s.id)) continue;
      try {
        await runSource(s.id);
      } catch (err) {
        log(`[cron] ${s.id} 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    collectBusy = false;
  }
}

let lastDailyKey = "";

/** 日报仍按 DAILY_CRON 触发；同一分钟内 cron 可能重复触发用 lastDailyKey 去重 */
export async function dailyTick(now = new Date(), log: (m: string) => void = (m) => console.log(m)): Promise<void> {
  if (!config.enableScheduler || !matchCron(config.dailyCron, now)) return;
  const key = now.toISOString().slice(0, 16);
  if (key === lastDailyKey) return;
  lastDailyKey = key;
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (digestExists(day)) return;
  try {
    await runDaily({ date: now });
  } catch (err) {
    log(`[cron] 日报失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const CLEANUP_EVERY_MS = 12 * 3600_000;

/** 按保留策略清理过期条目与日志（收藏的永不删），最多每 12h 一次 */
export function cleanupTick(log: (m: string) => void = (m) => console.log(m)): void {
  try {
    const last = get<{ value: string }>("SELECT value FROM settings WHERE key = 'last_cleanup_at'");
    if (last && Date.now() - Date.parse(last.value) < CLEANUP_EVERY_MS) return;
    const cfg = getRetention();
    if (cfg.auto) {
      const r = runCleanup(cfg);
      const total = Object.values(r.deleted).reduce((a, b) => a + b, 0);
      if (total > 0) log(`[cleanup] ${JSON.stringify(r.deleted)} 剩余 ${r.remaining}`);
    }
    run(
      "INSERT INTO settings (key, value, updated_at) VALUES ('last_cleanup_at', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      new Date().toISOString(),
      new Date().toISOString(),
    );
  } catch (err) {
    log(`[cleanup] 失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

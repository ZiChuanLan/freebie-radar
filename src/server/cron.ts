import { config } from "./config.ts";

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

let timer: NodeJS.Timeout | null = null;
let lastKey = "";

export function startScheduler(task: { collect: () => Promise<unknown>; daily: () => Promise<unknown>; log?: (m: string) => void }): void {
  if (timer) return;
  const log = task.log ?? ((m: string) => console.log(m));
  timer = setInterval(() => {
    const now = new Date();
    const key = now.toISOString().slice(0, 16);
    if (key === lastKey) return;
    lastKey = key;
    if (config.enableScheduler && matchCron(config.collectCron, now)) {
      log("[cron] 触发采集");
      task.collect().catch((e) => log(`[cron] 采集失败: ${String(e)}`));
    }
    if (config.enableScheduler && matchCron(config.dailyCron, now)) {
      log("[cron] 触发日报");
      task.daily().catch((e) => log(`[cron] 日报失败: ${String(e)}`));
    }
  }, 30_000);
  log(`[cron] scheduler started collect="${config.collectCron}" daily="${config.dailyCron}"`);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

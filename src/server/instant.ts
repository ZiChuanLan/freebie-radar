import { config, pushEnabled } from "./config.ts";
import { all, get, run } from "./db.ts";
import { URGENT } from "./enrich/codes.ts";
import { sendTelegram } from "./digest.ts";
import type { FreshItem } from "./collectors/index.ts";

/** 每小时最多推几条即时消息，避免刷屏。 */
const MAX_PER_HOUR = 24;

const SOURCE_SHORT: Record<string, string> = {
  "linuxdo-welfare": "LINUX DO 福利",
  "linuxdo-resource": "LINUX DO 资源",
  "v2ex-free": "V2EX",
  "xiaoheihe-search": "小黑盒",
  "zhihu-search": "知乎",
  "xhs-search": "小红书",
  gamerpower: "GamerPower",
  "epic-free": "Epic",
  "steam-free": "Steam",
  "rss-reddit-freegames": "Reddit",
  "rss-keylol": "其乐",
};

function decide(item: FreshItem): { push: boolean; reason: string } {
  if (item.codes.length > 0) return { push: true, reason: "含兑换码" };
  if (URGENT.test(item.title)) return { push: true, reason: "限量/限时" };
  if (item.score >= 70) return { push: true, reason: "高分福利" };
  return { push: false, reason: "" };
}

/**
 * 采集后立刻判断：带码 / 限量 / 高分的条目马上推送，不等日报。
 * 这是「送码 1 分钟被抢」的核心对策。
 */
export async function pushInstant(sourceId: string, fresh: FreshItem[]): Promise<number> {
  if (!pushEnabled || config.pushChannel !== "telegram") return 0;
  if (!config.telegramBotToken || !config.telegramChatId) return 0;
  if (!fresh.length) return 0;

  const since = new Date(Date.now() - 3_600_000).toISOString();
  const pushedLastHour = get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE pushed_at IS NOT NULL AND pushed_at >= ?", since)?.n ?? 0;
  if (pushedLastHour >= MAX_PER_HOUR) return 0;

  const picked = fresh
    .map((it) => ({ it, ...decide(it) }))
    .filter((x) => x.push)
    .slice(0, Math.min(5, MAX_PER_HOUR - pushedLastHour));

  if (!picked.length) return 0;

  let sent = 0;
  for (const { it, reason } of picked) {
    const lines = [
      "⚡ 新羊毛 · " + reason,
      "",
      it.title.slice(0, 120),
      (SOURCE_SHORT[sourceId] ?? sourceId) + (it.score ? " · 评分 " + Math.round(it.score) : ""),
    ];
    if (it.codes.length) lines.push("兑换码：" + it.codes.join(" / "));
    lines.push(it.url);
    try {
      await sendTelegram(lines.join("\n"));
      run("UPDATE items SET pushed_at = ? WHERE id = ?", new Date().toISOString(), it.id);
      sent += 1;
    } catch (err) {
      console.error("[instant] 推送失败:", err instanceof Error ? err.message : String(err));
      break;
    }
  }
  if (sent) console.log("[instant] " + sourceId + " 即时推送 " + sent + " 条");
  return sent;
}

export function instantStats(): { pushedLastHour: number; totalPushed: number } {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  return {
    pushedLastHour: get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE pushed_at IS NOT NULL AND pushed_at >= ?", since)?.n ?? 0,
    totalPushed: get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE pushed_at IS NOT NULL")?.n ?? 0,
  };
}

export function recentPushed(limit = 20) {
  return all("SELECT id, source_id, title, url, score, codes, pushed_at FROM items WHERE pushed_at IS NOT NULL ORDER BY pushed_at DESC LIMIT ?", limit);
}

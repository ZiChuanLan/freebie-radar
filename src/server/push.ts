import { aiEnabled, config, pushEnabled } from "./config.ts";
import { all, get, run } from "./db.ts";
import { DEAL_HINT, NOISE_TITLE, URGENT } from "./enrich/noise.ts";
import { isBlocked, loadActiveBlockRules } from "./enrich/blocklist.ts";
import { sendTelegram } from "./telegram.ts";
import type { FreshItem } from "./collectors/index.ts";

/* ------------------------------------------------------------------ *
 * 推送设置（存在 settings 表，网页可改，无需重启）
 * ------------------------------------------------------------------ */

export type PushSettings = {
  /** 总开关；关掉后即时和攒批都不发，日报仍可单独触发 */
  enabled: boolean;
  /** 立即推送的评分阈值 */
  instantScore: number;
  /** 进攒批队列的评分阈值 */
  batchScore: number;
  /** 含兑换码/邀请码是否立即推 */
  instantOnCodes: boolean;
  /** 标题含「限量/先到先得」等词是否立即推 */
  instantOnUrgent: boolean;
  /** 每小时最多推几条（含批次里的单条计数） */
  maxPerHour: number;
  /** 单次立即推送最多几条 */
  maxPerInstant: number;
  /** 攒批间隔（分钟）；0 表示关闭攒批 */
  batchIntervalMin: number;
  /** 一批最多合并几条 */
  maxPerBatch: number;
  /** 静默时段 "23:30-08:00"，静默期内的立即推送转入攒批 */
  quietHours: string;
  /** 静默时段按哪个时区算 */
  timezone: string;
  /** 语言偏好：all 全部 / zh 只看中文 / en 只看英文 */
  langMode: "all" | "zh" | "en";
  /** 推送里是否带价格 */
  includePrice: boolean;
  /** 推送里是否带截止时间 */
  includeDeadline: boolean;
  /** 是否按标题去重（同一游戏被多个源报道只推一次） */
  dedupeByTitle: boolean;
  /** 最高价格上限：null 不限 / 0 仅完全白嫖 / 正数为人民币上限 */
  maxPrice: number | null;
  /** 只推 AI 判定真福利（以及无 AI 结论时的强福利信号） */
  onlyAiKeep: boolean;
  /** 允许推送的获取方式；空数组表示不限制。默认只推 free */
  obtainModes: string[];
  /** 允许推送的分类白名单；空数组表示全部允许 */
  categories: string[];
  /** 命中「我的订阅」关键词时优先走即时推送 */
  prioritizeSubscribed: boolean;
  /** 将价格、分类、语言、AI 筛选同步应用到每日精选 */
  applyToDigest: boolean;
};

export const DEFAULT_SETTINGS: PushSettings = {
  enabled: true,
  instantScore: 70,
  batchScore: 60,
  instantOnCodes: true,
  instantOnUrgent: true,
  maxPerHour: 24,
  maxPerInstant: 5,
  batchIntervalMin: 30,
  maxPerBatch: 8,
  quietHours: "23:30-08:00",
  timezone: "Asia/Shanghai",
  langMode: "all",
  includePrice: true,
  includeDeadline: true,
  dedupeByTitle: true,
  maxPrice: null,
  onlyAiKeep: true,
  obtainModes: ["free"],
  categories: [],
  prioritizeSubscribed: true,
  applyToDigest: true,
};

const SETTINGS_KEY = "push";
const VALID_CATEGORIES = new Set(["ai", "cloud", "domain", "opensource", "software", "media", "game", "goods", "invite", "edu", "other"]);

function numOr(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function normalizeMaxPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "all") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n * 100) / 100, 10000);
}

function normalizeCategories(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && VALID_CATEGORIES.has(x)))];
}

const VALID_OBTAIN = new Set(["free", "conditional", "lottery", "trial", "promo", "paid"]);

function normalizeObtain(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && VALID_OBTAIN.has(x)))];
}

function normalizeSettings(raw: Partial<PushSettings>): PushSettings {
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SETTINGS.enabled,
    instantScore: numOr(raw.instantScore, DEFAULT_SETTINGS.instantScore, 0, 100),
    batchScore: numOr(raw.batchScore, DEFAULT_SETTINGS.batchScore, 0, 100),
    instantOnCodes: raw.instantOnCodes !== false,
    instantOnUrgent: raw.instantOnUrgent !== false,
    maxPerHour: numOr(raw.maxPerHour, DEFAULT_SETTINGS.maxPerHour, 1, 200),
    maxPerInstant: numOr(raw.maxPerInstant, DEFAULT_SETTINGS.maxPerInstant, 1, 10),
    batchIntervalMin: numOr(raw.batchIntervalMin, DEFAULT_SETTINGS.batchIntervalMin, 0, 720),
    maxPerBatch: numOr(raw.maxPerBatch, DEFAULT_SETTINGS.maxPerBatch, 1, 20),
    quietHours: typeof raw.quietHours === "string" ? raw.quietHours : DEFAULT_SETTINGS.quietHours,
    timezone: typeof raw.timezone === "string" && raw.timezone ? raw.timezone : DEFAULT_SETTINGS.timezone,
    langMode: raw.langMode === "zh" || raw.langMode === "en" ? raw.langMode : "all",
    includePrice: raw.includePrice !== false,
    includeDeadline: raw.includeDeadline !== false,
    dedupeByTitle: raw.dedupeByTitle !== false,
    maxPrice: "maxPrice" in raw ? normalizeMaxPrice(raw.maxPrice) : DEFAULT_SETTINGS.maxPrice,
    onlyAiKeep: raw.onlyAiKeep !== false,
    obtainModes: "obtainModes" in raw ? normalizeObtain(raw.obtainModes) : DEFAULT_SETTINGS.obtainModes,
    categories: "categories" in raw ? normalizeCategories(raw.categories) : DEFAULT_SETTINGS.categories,
    prioritizeSubscribed: raw.prioritizeSubscribed !== false,
    applyToDigest: raw.applyToDigest !== false,
  };
}

export function getPushSettings(): PushSettings {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", SETTINGS_KEY);
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(row.value) as Partial<PushSettings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function savePushSettings(patch: Partial<PushSettings>): PushSettings {
  const merged = normalizeSettings({ ...getPushSettings(), ...patch });
  run(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    SETTINGS_KEY,
    JSON.stringify(merged),
    new Date().toISOString(),
  );
  return merged;
}

/* ------------------------------------------------------------------ *
 * 语言识别 / 标题归一化 / 过滤判定（与前端筛选同源）
 * ------------------------------------------------------------------ */

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/g;

export function detectLang(text: string): "zh" | "en" {
  const cjk = (text.match(CJK) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cjk === 0) return "en";
  return cjk / Math.max(cjk + latin, 1) > 0.15 ? "zh" : "en";
}

/** 标题归一化：去掉【】/[]、价格标签、emoji 与标点，用于跨源去重。 */
export function titleKey(title: string): string {
  return title
    .replace(/【[^】]*】|\[[^\]]*\]/g, " ")
    .replace(/[（(][^)）]*[)）]/g, " ")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 1)
    .slice(0, 12)
    .join(" ");
}

function langAllowed(item: { title: string }, s: PushSettings): boolean {
  if (s.langMode === "all") return true;
  return detectLang(item.title) === s.langMode;
}

export function priceAllowed(
  item: { price?: number | null; isFree?: boolean; obtain?: string | null },
  maxPrice: number | null,
): boolean {
  if (maxPrice === null) return true;
  // AI 判定「要实付钱」的，别信 is_free 规则——标题里的「免费试用/首单 0 元」会被价格抽取误当成 0 元
  if (item.obtain === "paid") return false;
  // 抽奖/试用/推广不是「白嫖」，即使标价 0 元也不该进最高价筛选
  if (maxPrice === 0 && item.obtain && item.obtain !== "free" && item.obtain !== "conditional") return false;
  const free = item.isFree === true || item.price === 0;
  if (maxPrice === 0) return free;
  if (free) return true;
  return typeof item.price === "number" && item.price <= maxPrice;
}

export function aiAllowed(
  item: { title: string; score: number; codes: string[]; aiKeep?: boolean | null },
  onlyAiKeep: boolean,
): boolean {
  if (item.aiKeep === false) return false;
  if (!onlyAiKeep) return true;
  if (item.aiKeep === true) return true;
  // 还没有 AI 结论的（比如 AI 未开或本地脚本刚入库）：如果有兑换码或高分+福利信号才放行
  if (!aiEnabled) return true;
  return item.codes.length > 0 || (item.score >= 70 && DEAL_HINT.test(item.title));
}

export function categoryAllowed(category: string | null | undefined, allow: string[]): boolean {
  if (!allow.length) return true;
  return Boolean(category && allow.includes(category));
}

/** 获取方式白名单：空数组不限制；无结论的条目按 free 处理（关键词兜底已覆盖多数）。 */
export function obtainAllowed(obtain: string | null | undefined, allow: string[]): boolean {
  if (!allow.length) return true;
  return allow.includes(obtain ?? "free");
}

/** 推送与日报共用的筛选检查：语言 / 分类 / 最高价格 / AI 验真 / 获取方式。 */
export function passesPushFilters(
  item: {
    title: string;
    score: number;
    codes: string[];
    price?: number | null;
    isFree?: boolean;
    aiKeep?: boolean | null;
    category?: string | null;
    obtain?: string | null;
  },
  s: PushSettings,
): boolean {
  if (!langAllowed(item, s)) return false;
  if (!categoryAllowed(item.category, s.categories)) return false;
  if (!priceAllowed(item, s.maxPrice)) return false;
  if (!aiAllowed(item, s.onlyAiKeep)) return false;
  if (!obtainAllowed(item.obtain, s.obtainModes)) return false;
  return true;
}

function matchSubscriptions(item: { title: string; summary?: string | null }, keywords: string[]): string[] {
  if (!keywords.length) return [];
  const text = (item.title + " " + (item.summary ?? "")).toLowerCase();
  return keywords.filter((k) => text.includes(k.toLowerCase()));
}

function fmtPrice(item: FreshItem): string | null {
  if (item.isFree) return "免费";
  if (typeof item.price !== "number" || item.price <= 0) return null;
  const v = item.price < 1 ? "<1" : String(Math.round(item.price));
  return "约 ¥" + v;
}

function fmtDeadline(item: FreshItem): string | null {
  if (!item.expiresAt) return null;
  const t = new Date(item.expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "今天截止";
  if (days <= 14) return days + " 天后截止";
  return null;
}

const SOURCE_SHORT: Record<string, string> = {
  "linuxdo-welfare": "LINUX DO 福利",
  "linuxdo-resource": "LINUX DO 资源",
  "v2ex-free": "V2EX 免费赠送",
  "v2ex-deals": "V2EX 优惠",
  "v2ex-share": "V2EX 分享",
  "v2ex-promotions": "V2EX 推广",
  "v2ex-cloud": "V2EX 云",
  "xiaoheihe-search": "小黑盒",
  "zhihu-search": "知乎",
  "xhs-search": "小红书",
  gamerpower: "GamerPower",
  "epic-free": "Epic 喜加一",
  "steam-free": "Steam 限免",
  "cheapshark-free": "CheapShark",
  "rss-isthereanydeal": "ITAD 喜加一",
  "rss-reddit-freegames": "Reddit",
  "rss-reddit-freegamesonsteam": "Reddit",
  "rss-keylol": "其乐",
  "tg-freegames": "TG 游戏情报",
  "tg-cn-deals": "TG 中文羊毛",
  "bsky-gamedeals": "Bluesky 游戏",
  "bsky-plugins": "Bluesky 插件",
  "rss-nodeseek": "NodeSeek",
  "rss-sharewareonsale": "正版限免",
  "rss-tickcoupon": "终身限免",
};

function sourceLabel(id: string): string {
  return SOURCE_SHORT[id] ?? id;
}


/* ------------------------------------------------------------------ *
 * 静默时段
 * ------------------------------------------------------------------ */

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function inQuietHours(quiet: string, at = new Date()): boolean {
  const [from, to] = quiet.split("-");
  const a = parseHHMM(from ?? "");
  const b = parseHHMM(to ?? "");
  if (a === null || b === null) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  if (a === b) return false;
  if (a < b) return now >= a && now < b;
  return now >= a || now < b;
}

function zonedMinutes(timezone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return (h % 24) * 60 + m;
  } catch {
    return at.getHours() * 60 + at.getMinutes();
  }
}

export function inQuietHoursZoned(quiet: string, timezone: string, at = new Date()): boolean {
  const [from, to] = quiet.split("-");
  const a = parseHHMM(from ?? "");
  const b = parseHHMM(to ?? "");
  if (a === null || b === null) return false;
  const now = zonedMinutes(timezone, at);
  if (a === b) return false;
  if (a < b) return now >= a && now < b;
  return now >= a || now < b;
}

/* ------------------------------------------------------------------ *
 * 候选筛选
 * ------------------------------------------------------------------ */

type Decision = { push: boolean; reason: string; urgent: boolean };

function decide(item: FreshItem, s: PushSettings, subHits: string[]): Decision {
  if (NOISE_TITLE.test(item.title)) return { push: false, reason: "", urgent: false };
  if (item.aiKeep === false) return { push: false, reason: "", urgent: false };
  if (s.prioritizeSubscribed && subHits.length > 0) {
    return { push: true, reason: "订阅命中：" + subHits.join("/"), urgent: true };
  }
  if (s.instantOnCodes && item.codes.length > 0) return { push: true, reason: "含兑换码", urgent: true };
  if (s.instantOnUrgent && URGENT.test(item.title) && item.score >= 40) {
    return { push: true, reason: "限量/限时", urgent: true };
  }
  if (item.score >= s.instantScore) return { push: true, reason: "高分 " + Math.round(item.score), urgent: false };
  return { push: false, reason: "", urgent: false };
}

function recentTitleKeys(): Set<string> {
  const rows = all<{ title_key: string | null }>(
    "SELECT title_key FROM items WHERE pushed_at IS NOT NULL AND pushed_at >= ? AND title_key IS NOT NULL",
    new Date(Date.now() - 86_400_000).toISOString(),
  );
  return new Set(rows.map((r) => r.title_key ?? "").filter(Boolean));
}

function pushedLastHour(): number {
  return (
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM items WHERE pushed_at IS NOT NULL AND pushed_at >= ?",
      new Date(Date.now() - 3_600_000).toISOString(),
    )?.n ?? 0
  );
}

/* ------------------------------------------------------------------ *
 * 攒批队列
 * ------------------------------------------------------------------ */

type QueueItem = { id: number; sourceId: string; item: FreshItem; subHits?: string[] };
let queue: QueueItem[] = [];
let flushTimer: NodeJS.Timeout | null = null;

export function queueSize(): number {
  return queue.length;
}

function enqueue(entries: QueueItem[]): void {
  const seen = new Set(queue.map((q) => q.id));
  for (const e of entries) if (!seen.has(e.id)) queue.push(e);
  if (queue.length > 200) queue = queue.slice(-200);
}

function scheduleFlush(): void {
  if (flushTimer) return;
  const s = getPushSettings();
  if (s.batchIntervalMin <= 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBatch();
    scheduleFlush();
  }, s.batchIntervalMin * 60_000);
  flushTimer.unref?.();
}

export function startPushScheduler(): void {
  const s = getPushSettings();
  if (!s.enabled || !pushEnabled) return;
  scheduleFlush();
  console.log("[push] 攒批调度已启动，间隔 " + s.batchIntervalMin + " 分钟");
}

/* ------------------------------------------------------------------ *
 * 消息组装
 * ------------------------------------------------------------------ */

function itemBlock(sourceId: string, it: FreshItem, s: PushSettings, seq?: number, subHits: string[] = []): string[] {
  const lines: string[] = [];
  const prefix = seq === undefined ? "" : seq + ". ";
  const meta: string[] = [sourceLabel(sourceId)];
  const price = s.includePrice ? fmtPrice(it) : null;
  if (price) meta.push(price);
  if (s.includeDeadline) {
    const dl = fmtDeadline(it);
    if (dl) meta.push(dl);
  }
  if (subHits.length) meta.push("订阅：" + subHits.join("/"));
  if (detectLang(it.title) === "en" && s.langMode === "all") meta.push("EN");
  lines.push(prefix + it.title.slice(0, 110));
  lines.push("   " + meta.join(" · ") + (it.score ? " · " + Math.round(it.score) + " 分" : ""));
  if (it.codes.length) lines.push("   码：" + it.codes.join(" / "));
  lines.push("   " + it.url);
  return lines;
}

/* ------------------------------------------------------------------ *
 * 即时推送
 * ------------------------------------------------------------------ */

export async function pushInstant(sourceId: string, fresh: FreshItem[]): Promise<number> {
  const s = getPushSettings();
  if (!s.enabled || !pushEnabled || config.pushChannel !== "telegram") return 0;
  if (!config.telegramBotToken || !config.telegramChatId) return 0;
  if (!fresh.length) return 0;

  const rules = loadActiveBlockRules();
  const subKeywords = all<{ keyword: string }>("SELECT keyword FROM subscriptions").map((r) => r.keyword);
  const seenTitles = s.dedupeByTitle ? recentTitleKeys() : new Set<string>();

  const candidates = fresh.filter((it) => {
    if (isBlocked({ ...it, sourceId }, rules)) return false;
    return passesPushFilters(it, s);
  });

  const instant: { it: FreshItem; reason: string; subHits: string[] }[] = [];
  const batched: QueueItem[] = [];
  const quiet = inQuietHoursZoned(s.quietHours, s.timezone);

  for (const it of candidates) {
    const key = titleKey(it.title);
    const subHits = matchSubscriptions(it, subKeywords);
    const d = decide(it, s, subHits);
    const dup = s.dedupeByTitle && key && seenTitles.has(key);
    if (dup) continue;

    if (d.push && !quiet) {
      instant.push({ it, reason: d.reason, subHits });
      if (key) seenTitles.add(key);
      continue;
    }
    const noisy = NOISE_TITLE.test(it.title) || !DEAL_HINT.test(it.title) || it.aiKeep === false;
    if (!noisy && (it.score >= s.batchScore || d.push)) {
      batched.push({ id: it.id, sourceId, item: it, subHits });
      if (key) seenTitles.add(key);
    }
  }

  if (batched.length) enqueue(batched);
  if (quiet && (instant.length || batched.length)) {
    console.log("[push] 静默时段 " + s.quietHours + "，" + (instant.length + batched.length) + " 条转入攒批");
  }

  const budget = Math.max(0, s.maxPerHour - pushedLastHour());
  const picked = instant.slice(0, Math.min(s.maxPerInstant, budget));
  if (!picked.length) return 0;

  let sent = 0;
  for (const { it, reason, subHits } of picked) {
    const lines = ["⚡ 新羊毛 · " + reason, "", ...itemBlock(sourceId, it, s, undefined, subHits)];
    const text = lines.join("\n");
    try {
      await sendTelegram(text);
      const now = new Date().toISOString();
      run("UPDATE items SET pushed_at = ?, title_key = ? WHERE id = ?", now, titleKey(it.title), it.id);
      logPush("instant", [it.id], text, 1, true, null);
      sent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[push] 即时推送失败:", msg);
      logPush("instant", [it.id], text, 0, false, msg);
      break;
    }
  }
  if (sent) console.log("[push] " + sourceId + " 即时推送 " + sent + " 条");
  return sent;
}

/* ------------------------------------------------------------------ *
 * 攒批推送
 * ------------------------------------------------------------------ */

export async function flushBatch(force = false): Promise<number> {
  if (!queue.length) return 0;
  const s = getPushSettings();
  if (!s.enabled || !pushEnabled) return 0;
  if (!force && inQuietHoursZoned(s.quietHours, s.timezone)) return 0;

  const budget = Math.max(0, s.maxPerHour - pushedLastHour());
  if (!budget) return 0;

  const take = queue.splice(0, Math.min(s.maxPerBatch, budget));
  const blocks: string[] = [];
  take.forEach((q, i) => {
    blocks.push(...itemBlock(q.sourceId, q.item, s, i + 1, q.subHits ?? []));
    blocks.push("");
  });
  const text = ["📦 本轮新发现 " + take.length + " 条", "", ...blocks].join("\n").trim();

  try {
    await sendTelegram(text);
    const now = new Date().toISOString();
    for (const q of take) {
      run("UPDATE items SET pushed_at = ?, title_key = ? WHERE id = ?", now, titleKey(q.item.title), q.id);
    }
    logPush("batch", take.map((q) => q.id), text, take.length, true, null);
    console.log("[push] 攒批推送 " + take.length + " 条");
    return take.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[push] 攒批推送失败:", msg);
    logPush("batch", take.map((q) => q.id), text, 0, false, msg);
    queue.unshift(...take);
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * 推送记录与状态
 * ------------------------------------------------------------------ */

function logPush(kind: string, ids: number[], text: string, count: number, ok: boolean, error: string | null): void {
  run(
    "INSERT INTO push_log (kind, item_ids, text, count, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    kind,
    JSON.stringify(ids),
    text.slice(0, 4000),
    count,
    ok ? 1 : 0,
    error?.slice(0, 400) ?? null,
    new Date().toISOString(),
  );
}

export function recentPushLog(limit = 30) {
  return all<{
    id: number;
    kind: string;
    item_ids: string;
    text: string;
    count: number;
    ok: number;
    error: string | null;
    created_at: string;
  }>("SELECT * FROM push_log ORDER BY id DESC LIMIT ?", limit);
}

export function pushStats() {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const day = new Date(Date.now() - 86_400_000).toISOString();
  return {
    pushedLastHour: pushedLastHour(),
    pushedLast24h:
      get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE pushed_at IS NOT NULL AND pushed_at >= ?", day)?.n ?? 0,
    totalPushed: get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE pushed_at IS NOT NULL")?.n ?? 0,
    queued: queue.length,
    lastHourLogs: get<{ n: number }>("SELECT COUNT(*) AS n FROM push_log WHERE created_at >= ?", since)?.n ?? 0,
    failures: get<{ n: number }>("SELECT COUNT(*) AS n FROM push_log WHERE ok = 0 AND created_at >= ?", day)?.n ?? 0,
  };
}

/* ------------------------------------------------------------------ *
 * 预览：按当前全套推送筛选条件算一遍
 * ------------------------------------------------------------------ */

export function previewPush(limit = 6): {
  instant: string[];
  batch: string[];
  queued: number;
  scanned: number;
  matched: number;
} {
  const s = getPushSettings();
  const rules = loadActiveBlockRules();
  const subKeywords = all<{ keyword: string }>("SELECT keyword FROM subscriptions").map((r) => r.keyword);
  const rows = all<{
    id: number;
    source_id: string;
    title: string;
    summary: string | null;
    url: string;
    category: string | null;
    score: number;
    codes: string;
    price: number | null;
    is_free: number;
    obtain: string | null;
    expires_at: string | null;
    pushed_at: string | null;
    ai: string | null;
  }>(
    `SELECT id, source_id, title, summary, url, category, score, codes, price, is_free, obtain, expires_at, pushed_at, ai
     FROM items WHERE status = 'active' AND pushed_at IS NULL AND COALESCE(published_at, first_seen_at) >= ?
     ORDER BY score DESC LIMIT 180`,
    new Date(Date.now() - 7 * 86_400_000).toISOString(),
  );

  const instant: string[] = [];
  const batch: string[] = [];
  let matched = 0;

  for (const r of rows) {
    if (isBlocked(r, rules)) continue;
    let codes: string[] = [];
    try {
      codes = JSON.parse(r.codes ?? "[]") as string[];
    } catch {
      codes = [];
    }
    let aiKeep: boolean | null = null;
    if (r.ai) {
      try {
        aiKeep = (JSON.parse(r.ai) as { keep?: boolean }).keep ?? null;
      } catch {
        aiKeep = null;
      }
    }
    const fresh: FreshItem = {
      id: r.id,
      title: r.title,
      url: r.url,
      score: r.score,
      codes,
      expiresAt: r.expires_at,
      price: r.price,
      isFree: r.is_free === 1,
      aiKeep,
      category: r.category,
      obtain: r.obtain,
      summary: r.summary,
    };
    if (!passesPushFilters(fresh, s)) continue;

    matched += 1;
    const subHits = matchSubscriptions(fresh, subKeywords);
    const d = decide(fresh, s, subHits);
    const block = itemBlock(r.source_id, fresh, s, undefined, subHits).join("\n");
    if (d.push && instant.length < limit) instant.push("⚡ " + d.reason + "\n" + block);
    else if (
      !NOISE_TITLE.test(fresh.title) &&
      DEAL_HINT.test(fresh.title) &&
      fresh.score >= s.batchScore &&
      batch.length < limit
    ) {
      batch.push(block);
    }
  }
  return { instant, batch, queued: queue.length, scanned: rows.length, matched };
}

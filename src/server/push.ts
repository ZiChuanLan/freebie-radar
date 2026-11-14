import { config, pushEnabled } from "./config.ts";
import { all, get, run } from "./db.ts";
import { matchesEntryNoise, shouldReview } from "./enrich/ai.ts";
import { mergeKey, TitleDeduper, type DedupeEntry } from "./enrich/index.ts";
import { hasValueSignal, URGENT } from "./enrich/noise.ts";
import { KIND_LABEL, type ContentKind } from "./enrich/kind.ts";
import { OBTAIN_LABEL } from "./enrich/obtain.ts";
import { isBlocked, loadActiveBlockRules } from "./enrich/blocklist.ts";
import { sendTelegram } from "./telegram.ts";
import type { FreshItem } from "./collectors/index.ts";

/* ------------------------------------------------------------------ *
 * 推送设置（存在 settings 表，网页可改，无需重启）
 * ------------------------------------------------------------------ */

export type PushTiming = "wait_ai" | "instant_first";
export type AiFallbackMode = "strict" | "rule_fallback" | "ignore_ai";
export type PushSourceMode = "all" | "include" | "exclude";
export type QuietAction = "batch" | "drop";

export type PushRoute = {
  id: string;
  name: string;
  enabled: boolean;
  /** 允许的内容形态：freebie / deal / opensource / info；空数组表示不限（自动排除 noise） */
  kinds: string[];
  /** 允许的分类；空数组表示不限 */
  categories: string[];
  /** 允许的获取方式；空数组表示不限 */
  obtainModes: string[];
  /** 主题关键词（任一命中即可）；空数组表示不限 */
  keywords: string[];
  /** 最高价格上限：null 不限 / 0 仅免费 */
  maxPrice: number | null;
  /** 最低评分要求（0-100） */
  minScore: number;
  /** true = 满足高分/急迫条件可即时推送；false = 仅进攒批汇总 */
  instant: boolean;
  /** 可选自定义消息头前缀（覆盖全局 customHeader） */
  header?: string;
};
export type PushSettings = {
  /** 总开关；关掉后即时和攒批都不发，日报仍可单独触发 */
  enabled: boolean;
  /** 推送时机：wait_ai = 先过 AI 审核再推（防误推）；instant_first = 极速抢码先推再后台补审 */
  pushTiming: PushTiming;
  /** wait_ai 时每轮推送前最多同步等几条过 AI（5-60）；超出部分进后台队列并在审完后自动补推 */
  syncPrePushLimit: number;
  /** 后台 AI 补审（超出同步上限或极速模式补审）判定为真福利后，自动补进推送管道 */
  pushAfterBackfill: boolean;
  /** AI 未出结果/被拒绝时的处理：strict = 必须 AI 验真；rule_fallback = 未审到按强信号放行；ignore_ai = 忽略 AI 仅用规则 */
  aiFallbackMode: AiFallbackMode;
  /** 兼容旧字段：等同于 aiFallbackMode !== "ignore_ai" */
  onlyAiKeep: boolean;
  /** 立即推送的评分阈值 */
  instantScore: number;
  /** 进攒批队列的评分阈值 */
  batchScore: number;
  /** 含兑换码是否立即推 */
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
  /** 是否开启夜间免打扰 */
  quietEnabled: boolean;
  /** 静默时段 "23:30-08:00" */
  quietHours: string;
  /** 静默时段行为：batch = 转入攒批早上发；drop = 静默期内不发送也不攒批 */
  quietAction: QuietAction;
  /** 静默时段按哪个时区算 */
  timezone: string;
  /** 新帖时效上限（小时）；0 表示不限，默认 72 小时 */
  maxAgeHours: number;
  /** 语言偏好：all 全部 / zh 只看中文 / en 只看英文 */
  langMode: "all" | "zh" | "en";
  /** 数据源过滤模式：all 全部 / include 仅推指定源 / exclude 排除指定源 */
  sourceMode: PushSourceMode;
  /** 配合 sourceMode 使用的数据源 ID 列表 */
  sourceIds: string[];
  /** 推送里是否带价格 */
  includePrice: boolean;
  /** 推送里是否带截止时间 */
  includeDeadline: boolean;
  /** 推送里是否带综合评分 */
  includeScore: boolean;
  /** 推送里是否带获取方式标签（如 有条件/抽奖） */
  includeObtain: boolean;
  /** 推送里是否附带 AI 推荐理由 */
  includeAiReason: boolean;
  /** 自定义即时/攒批消息头前缀（留空使用默认） */
  customHeader: string;
  /** 是否按标题去重（同一游戏被多个源报道只推一次） */
  dedupeByTitle: boolean;
  /** 最高价格上限：null 不限 / 0 仅完全白嫖 / 正数为人民币上限 */
  maxPrice: number | null;
  /** 允许推送的获取方式；空数组表示不限制。默认只推 free */
  obtainModes: string[];
  /** 允许推送的内容形态（freebie / deal / opensource / info）；空数组表示不限（排除 noise） */
  kinds: string[];
  /** 多频道推送路由：非空且有启用路由时，按路由各自条件分流匹配 */
  routes: PushRoute[];
  /** 允许推送的分类白名单；空数组表示全部允许 */
  categories: string[];
  /** 命中「我的订阅」关键词时优先走即时推送 */
  prioritizeSubscribed: boolean;
  /** 将价格、分类、语言、源、AI 筛选同步应用到每日精选 */
  applyToDigest: boolean;
};

export const DEFAULT_SETTINGS: PushSettings = {
  enabled: true,
  pushTiming: "wait_ai",
  syncPrePushLimit: 20,
  pushAfterBackfill: true,
  aiFallbackMode: "rule_fallback",
  onlyAiKeep: true,
  instantScore: 70,
  batchScore: 60,
  instantOnCodes: true,
  instantOnUrgent: true,
  maxPerHour: 24,
  maxPerInstant: 5,
  batchIntervalMin: 30,
  maxPerBatch: 8,
  quietEnabled: true,
  quietHours: "23:30-08:00",
  quietAction: "batch",
  timezone: "Asia/Shanghai",
  maxAgeHours: 72,
  langMode: "all",
  sourceMode: "all",
  sourceIds: [],
  includePrice: true,
  includeDeadline: true,
  includeScore: true,
  includeObtain: true,
  includeAiReason: true,
  customHeader: "",
  dedupeByTitle: true,
  maxPrice: null,
  obtainModes: ["free"],
  kinds: ["freebie"],
  routes: [],
  categories: [],
  prioritizeSubscribed: true,
  applyToDigest: true,
};

const SETTINGS_KEY = "push";
const VALID_CATEGORIES = new Set(["ai", "cloud", "vps", "domain", "opensource", "software", "dev", "design", "security", "hardware", "media", "game", "carpool", "trade", "headline", "finance", "news", "goods", "invite", "edu", "other"]);
const VALID_OBTAIN = new Set(["free", "conditional", "lottery", "trial", "promo", "paid"]);
const VALID_KINDS = new Set(["freebie", "deal", "opensource", "info"]);

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

function normalizeObtain(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && VALID_OBTAIN.has(x)))];
}

function normalizeKinds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && VALID_KINDS.has(x)))];
}

function normalizeRoutes(v: unknown): PushRoute[] {
  if (!Array.isArray(v)) return [];
  const out: PushRoute[] = [];
  for (let i = 0; i < Math.min(v.length, 20); i += 1) {
    const raw = v[i] as Partial<PushRoute> | null;
    if (!raw || typeof raw !== "object") continue;
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 40) : "";
    if (!name) continue;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 40) : `route-${i + 1}`;
    const keywords = Array.isArray(raw.keywords)
      ? [...new Set(raw.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean))].slice(0, 30)
      : [];
    out.push({
      id,
      name,
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
      kinds: normalizeKinds(raw.kinds),
      categories: normalizeCategories(raw.categories),
      obtainModes: normalizeObtain(raw.obtainModes),
      keywords,
      maxPrice: normalizeMaxPrice(raw.maxPrice),
      minScore: numOr(raw.minScore, 55, 0, 100),
      instant: typeof raw.instant === "boolean" ? raw.instant : true,
      header: typeof raw.header === "string" ? raw.header.trim().slice(0, 40) : undefined,
    });
  }
  return out;
}
function normalizeSourceIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean))].slice(0, 200);
}

function normalizeSettings(raw: Partial<PushSettings>, base: PushSettings = DEFAULT_SETTINGS): PushSettings {
  const instantScore = numOr(raw.instantScore, base.instantScore, 0, 100);
  const rawBatchScore = numOr(raw.batchScore, base.batchScore, 0, 100);
  const batchScore = Math.min(rawBatchScore, instantScore);

  let aiFallbackMode: AiFallbackMode = base.aiFallbackMode;
  if (raw.aiFallbackMode === "strict" || raw.aiFallbackMode === "rule_fallback" || raw.aiFallbackMode === "ignore_ai") {
    aiFallbackMode = raw.aiFallbackMode;
  } else if (typeof raw.onlyAiKeep === "boolean") {
    if (!raw.onlyAiKeep) aiFallbackMode = "ignore_ai";
    else if (base.aiFallbackMode === "ignore_ai") aiFallbackMode = "rule_fallback";
  }

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    pushTiming: raw.pushTiming === "instant_first" || raw.pushTiming === "wait_ai" ? raw.pushTiming : base.pushTiming,
    syncPrePushLimit: numOr(raw.syncPrePushLimit, base.syncPrePushLimit, 5, 60),
    pushAfterBackfill: typeof raw.pushAfterBackfill === "boolean" ? raw.pushAfterBackfill : base.pushAfterBackfill,
    aiFallbackMode,
    onlyAiKeep: aiFallbackMode !== "ignore_ai",
    instantScore,
    batchScore,
    instantOnCodes: typeof raw.instantOnCodes === "boolean" ? raw.instantOnCodes : base.instantOnCodes,
    instantOnUrgent: typeof raw.instantOnUrgent === "boolean" ? raw.instantOnUrgent : base.instantOnUrgent,
    maxPerHour: numOr(raw.maxPerHour, base.maxPerHour, 1, 200),
    maxPerInstant: numOr(raw.maxPerInstant, base.maxPerInstant, 1, 10),
    batchIntervalMin: numOr(raw.batchIntervalMin, base.batchIntervalMin, 0, 720),
    maxPerBatch: numOr(raw.maxPerBatch, base.maxPerBatch, 1, 20),
    quietEnabled: typeof raw.quietEnabled === "boolean" ? raw.quietEnabled : base.quietEnabled,
    quietHours: typeof raw.quietHours === "string" ? raw.quietHours : base.quietHours,
    quietAction: raw.quietAction === "drop" || raw.quietAction === "batch" ? raw.quietAction : base.quietAction,
    timezone: typeof raw.timezone === "string" && raw.timezone ? raw.timezone : base.timezone,
    maxAgeHours: numOr(raw.maxAgeHours, base.maxAgeHours, 0, 720),
    langMode: raw.langMode === "zh" || raw.langMode === "en" || raw.langMode === "all" ? raw.langMode : base.langMode,
    sourceMode: raw.sourceMode === "include" || raw.sourceMode === "exclude" || raw.sourceMode === "all" ? raw.sourceMode : base.sourceMode,
    sourceIds: "sourceIds" in raw ? normalizeSourceIds(raw.sourceIds) : base.sourceIds,
    includePrice: typeof raw.includePrice === "boolean" ? raw.includePrice : base.includePrice,
    includeDeadline: typeof raw.includeDeadline === "boolean" ? raw.includeDeadline : base.includeDeadline,
    includeScore: typeof raw.includeScore === "boolean" ? raw.includeScore : base.includeScore,
    includeObtain: typeof raw.includeObtain === "boolean" ? raw.includeObtain : base.includeObtain,
    includeAiReason: typeof raw.includeAiReason === "boolean" ? raw.includeAiReason : base.includeAiReason,
    customHeader: typeof raw.customHeader === "string" ? raw.customHeader.trim().slice(0, 60) : base.customHeader,
    dedupeByTitle: typeof raw.dedupeByTitle === "boolean" ? raw.dedupeByTitle : base.dedupeByTitle,
    maxPrice: "maxPrice" in raw ? normalizeMaxPrice(raw.maxPrice) : base.maxPrice,
    obtainModes: "obtainModes" in raw ? normalizeObtain(raw.obtainModes) : base.obtainModes,
    kinds: "kinds" in raw ? normalizeKinds(raw.kinds) : base.kinds,
    routes: "routes" in raw ? normalizeRoutes(raw.routes) : base.routes,
    categories: "categories" in raw ? normalizeCategories(raw.categories) : base.categories,
    prioritizeSubscribed: typeof raw.prioritizeSubscribed === "boolean" ? raw.prioritizeSubscribed : base.prioritizeSubscribed,
    applyToDigest: typeof raw.applyToDigest === "boolean" ? raw.applyToDigest : base.applyToDigest,
  };
}

export function getPushSettings(): PushSettings {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", SETTINGS_KEY);
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(row.value) as Partial<PushSettings>, DEFAULT_SETTINGS);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function savePushSettings(patch: Partial<PushSettings>): PushSettings {
  const cur = getPushSettings();
  const merged = normalizeSettings(patch, cur);
  run(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    SETTINGS_KEY,
    JSON.stringify(merged),
    new Date().toISOString(),
  );
  // 热更新攒批定时器：避免从 0 改成 10 分钟或缩短周期后要重启或干等上一周期
  if (schedulerStarted) rescheduleFlush();
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

export function titleKey(title: string): string {
  return mergeKey(title);
}

function langAllowed(item: { title: string }, s: PushSettings): boolean {
  if (s.langMode === "all") return true;
  return detectLang(item.title) === s.langMode;
}

export function sourceAllowed(sourceId: string | undefined, s: PushSettings): boolean {
  if (s.sourceMode === "all" || !sourceId) return true;
  if (s.sourceMode === "include") return s.sourceIds.includes(sourceId);
  if (s.sourceMode === "exclude") return !s.sourceIds.includes(sourceId);
  return true;
}

export function priceAllowed(
  item: { price?: number | null; isFree?: boolean; obtain?: string | null },
  maxPrice: number | null,
): boolean {
  if (maxPrice === null) return true;
  const free = item.isFree === true || item.price === 0;
  if (maxPrice === 0) {
    if (item.obtain === "paid") return false;
    if (item.obtain && item.obtain !== "free" && item.obtain !== "conditional") return false;
    return free;
  }
  if (free) return true;
  return typeof item.price === "number" && item.price <= maxPrice;
}

export function aiAllowed(
  item: { title: string; score: number; codes: string[]; aiKeep?: boolean | null; kind?: string | null },
  onlyAiKeepOrSettings: boolean | PushSettings,
): boolean {
  const mode: AiFallbackMode =
    typeof onlyAiKeepOrSettings === "boolean"
      ? onlyAiKeepOrSettings
        ? "rule_fallback"
        : "ignore_ai"
      : onlyAiKeepOrSettings.aiFallbackMode;

  if (mode === "ignore_ai") return true;
  if (item.aiKeep === false || item.kind === "noise") return false;
  if (item.aiKeep === true) return true;
  // 还没有 AI 结论（aiKeep === null | undefined）
  if (!shouldReview()) return true;
  if (mode === "strict") return false;
  return item.codes.length > 0 || (item.score >= 70 && hasValueSignal(item.title, item.kind));
}

export function categoryAllowed(category: string | null | undefined, allow: string[]): boolean {
  if (!allow.length) return true;
  return Boolean(category && allow.includes(category));
}

export function obtainAllowed(obtain: string | null | undefined, allow: string[]): boolean {
  if (!allow.length) return true;
  return allow.includes(obtain ?? "free");
}

export function kindAllowed(kind: string | null | undefined, allow: string[]): boolean {
  if (!allow.length) return kind !== "noise";
  return allow.includes(kind ?? "freebie");
}

export function matchPushRoute(
  item: {
    title: string;
    summary?: string | null;
    score: number;
    price?: number | null;
    isFree?: boolean;
    kind?: string | null;
    category?: string | null;
    obtain?: string | null;
  },
  routes: PushRoute[],
): PushRoute | null {
  const enabled = routes.filter((r) => r.enabled);
  if (!enabled.length) return null;
  const hay = (item.title + " " + (item.summary ?? "")).toLowerCase();
  for (const r of enabled) {
    if (!kindAllowed(item.kind, r.kinds)) continue;
    if (!categoryAllowed(item.category, r.categories)) continue;
    if (!obtainAllowed(item.obtain, r.obtainModes)) continue;
    if (!priceAllowed(item, r.maxPrice)) continue;
    if (r.keywords.length && !r.keywords.some((kw) => hay.includes(kw.toLowerCase()))) continue;
    if (item.score < r.minScore) continue;
    return r;
  }
  return null;
}

export function freshEnoughForPush(
  publishedAt: string | null | undefined,
  maxAgeHours = 72,
  nowMs = Date.now(),
): boolean {
  if (maxAgeHours <= 0 || !publishedAt) return true;
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return true;
  return nowMs - ts <= maxAgeHours * 3_600_000;
}

export type FilterRejectReason = "stale" | "source" | "lang" | "kind" | "category" | "price" | "ai" | "obtain" | "route";

export function checkPushFilter(
  item: {
    sourceId?: string;
    title: string;
    summary?: string | null;
    score: number;
    codes: string[];
    price?: number | null;
    isFree?: boolean;
    aiKeep?: boolean | null;
    kind?: string | null;
    category?: string | null;
    obtain?: string | null;
    publishedAt?: string | null;
  },
  s: PushSettings,
): FilterRejectReason | null {
  if (!freshEnoughForPush(item.publishedAt, s.maxAgeHours)) return "stale";
  if (!sourceAllowed(item.sourceId, s)) return "source";
  if (!langAllowed(item, s)) return "lang";
  if (!aiAllowed(item, s)) return "ai";

  const hasEnabledRoutes = s.routes?.some((r) => r.enabled);
  if (hasEnabledRoutes) {
    return matchPushRoute(item, s.routes) ? null : "route";
  }

  if (!kindAllowed(item.kind, s.kinds ?? [])) return "kind";
  if (!categoryAllowed(item.category, s.categories)) return "category";
  if (!priceAllowed(item, s.maxPrice)) return "price";
  if (!obtainAllowed(item.obtain, s.obtainModes)) return "obtain";
  return null;
}

/** 推送与日报共用的筛选检查：时效 / 源 / 语言 / 形态 / 分类 / 最高价格 / AI 验真 / 获取方式 / 多路由。 */
export function passesPushFilters(
  item: {
    sourceId?: string;
    title: string;
    summary?: string | null;
    score: number;
    codes: string[];
    price?: number | null;
    isFree?: boolean;
    aiKeep?: boolean | null;
    kind?: string | null;
    category?: string | null;
    obtain?: string | null;
    publishedAt?: string | null;
  },
  s: PushSettings,
): boolean {
  return checkPushFilter(item, s) === null;
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

export const SOURCE_SHORT: Record<string, string> = {
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
  "gog-free": "GOG 限免",
  "cheapshark-free": "CheapShark",
  "rss-isthereanydeal": "ITAD 喜加一",
  "rss-indiegamebundles": "IndieGameBundles",
  "rss-ggdeals": "GG.deals",
  "rss-reddit-freegames": "Reddit 游戏",
  "rss-reddit-freegamesonsteam": "Reddit Steam",
  "rss-reddit-efreebies": "Reddit 电子福利",
  "rss-reddit-gamedeals": "Reddit GameDeals",
  "rss-reddit-freebies": "Reddit Freebies",
  "rss-reddit-apphookup": "AppHookup 限免",
  "rss-reddit-freeebooks": "Reddit 电子书",
  "rss-reddit-googleplay": "GooglePlay 限免",
  "rss-keylol": "其乐",
  "rss-slickdeals": "Slickdeals",
  "rss-heyitsfree": "HeyItsFree",
  "rss-freebieshark": "FreebieShark",
  "rss-giveawayoftheday": "今日限免软件",
  "rss-vonbeau": "VonBeau",
  "rss-hip2save": "Hip2Save",
  "rss-ozbargain": "OzBargain",
  "rss-lowendbox": "LowEndBox",
  "rss-iplaysoft": "异次元软件",
  "tg-freegames": "TG 游戏情报",
  "tg-cn-deals": "TG 中文羊毛",
  "bsky-gamedeals": "Bluesky 游戏",
  "bsky-plugins": "Bluesky 插件",
  "rss-nodeseek": "NodeSeek",
  "rss-sharewareonsale": "正版限免",
  "rss-tickcoupon": "终身限免",
  "rss-fuliba": "福利吧",
  "rss-52pojie": "吾爱破解",
  "rss-smzdm": "什么值得买",
  "github-free-for-dev": "GitHub",
};

export function sourceLabel(id: string): string {
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

export function isQuietNow(s = getPushSettings(), at = new Date()): boolean {
  if (!s.quietEnabled) return false;
  return inQuietHoursZoned(s.quietHours, s.timezone, at);
}

/* ------------------------------------------------------------------ *
 * 候选筛选
 * ------------------------------------------------------------------ */

type Decision = { push: boolean; reason: string; urgent: boolean; route?: PushRoute | null };

function decide(item: FreshItem, s: PushSettings, subHits: string[], route: PushRoute | null = null): Decision {
  if (matchesEntryNoise(item.title)) return { push: false, reason: "", urgent: false, route };
  if (s.aiFallbackMode !== "ignore_ai" && (item.aiKeep === false || item.kind === "noise")) {
    return { push: false, reason: "", urgent: false, route };
  }
  const routeTag = route ? `[${route.name}] ` : "";
  if (route && !route.instant) {
    return { push: false, reason: "", urgent: false, route };
  }
  if (s.prioritizeSubscribed && subHits.length > 0) {
    return { push: true, reason: routeTag + "订阅命中：" + subHits.join("/"), urgent: true, route };
  }
  if (s.instantOnCodes && item.codes.length > 0) return { push: true, reason: routeTag + "含兑换码", urgent: true, route };
  if (s.instantOnUrgent && URGENT.test(item.title) && item.score >= 40) {
    return { push: true, reason: routeTag + "限量/限时", urgent: true, route };
  }
  const scoreGate = route ? Math.max(s.instantScore, route.minScore) : s.instantScore;
  if (item.score >= scoreGate) return { push: true, reason: routeTag + "高分 " + Math.round(item.score), urgent: false, route };
  return { push: false, reason: "", urgent: false, route };
}

function canEnterBatch(item: FreshItem, s: PushSettings, d: Decision): boolean {
  if (matchesEntryNoise(item.title)) return false;
  if (s.aiFallbackMode !== "ignore_ai" && (item.aiKeep === false || item.kind === "noise")) return false;
  // 已通过 AI 验真或命中白嫖/特价/开源任一频道价值信号即可进攒批，不再被纯中文 DEAL_HINT 卡死
  const hasSignal = item.aiKeep === true || hasValueSignal(item.title, item.kind);
  if (!hasSignal && !d.push) return false;
  const batchGate = d.route ? d.route.minScore : s.batchScore;
  return item.score >= batchGate || d.push;
}

function recentPushedSeeds(includeQueue = true): DedupeEntry[] {
  const rows = all<{ title: string; urlKey: string | null }>(
    "SELECT title, url_key AS urlKey FROM items WHERE pushed_at IS NOT NULL AND pushed_at >= ?",
    new Date(Date.now() - 86_400_000).toISOString(),
  );
  if (!includeQueue || !queue.length) return rows;
  return [...rows, ...queue.map((q) => ({ title: q.item.title }))];
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

type QueueItem = { id: number; sourceId: string; item: FreshItem; subHits?: string[]; route?: PushRoute | null };
let queue: QueueItem[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let schedulerStarted = false;

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
  if (!s.enabled || !pushEnabled || s.batchIntervalMin <= 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBatch();
    scheduleFlush();
  }, s.batchIntervalMin * 60_000);
  flushTimer.unref?.();
}

function rescheduleFlush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  scheduleFlush();
}

export function startPushScheduler(): void {
  schedulerStarted = true;
  const s = getPushSettings();
  if (!s.enabled || !pushEnabled) return;
  scheduleFlush();
  console.log("[push] 攒批调度已启动，间隔 " + s.batchIntervalMin + " 分钟");
}

/* ------------------------------------------------------------------ *
 * 消息组装
 * ------------------------------------------------------------------ */

function parseAiMeta(aiRaw: string | null): { aiKeep: boolean | null; aiReason: string | null } {
  if (!aiRaw) return { aiKeep: null, aiReason: null };
  try {
    const parsed = JSON.parse(aiRaw) as { keep?: boolean; reason?: string };
    return {
      aiKeep: typeof parsed.keep === "boolean" ? parsed.keep : null,
      aiReason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : null,
    };
  } catch {
    return { aiKeep: null, aiReason: null };
  }
}

function itemBlock(sourceId: string, it: FreshItem, s: PushSettings, seq?: number, subHits: string[] = []): string[] {
  const lines: string[] = [];
  const prefix = seq === undefined ? "" : seq + ". ";
  const meta: string[] = [sourceLabel(sourceId)];
  const kindTag = it.kind && it.kind !== "freebie" && it.kind !== "noise" ? KIND_LABEL[it.kind as ContentKind] : null;
  if (kindTag) meta.push(kindTag);
  const price = s.includePrice ? fmtPrice(it) : null;
  if (price) meta.push(price);
  if (s.includeObtain && it.obtain && it.obtain !== "free") {
    meta.push(OBTAIN_LABEL[it.obtain as keyof typeof OBTAIN_LABEL] ?? it.obtain);
  }
  if (s.includeDeadline) {
    const dl = fmtDeadline(it);
    if (dl) meta.push(dl);
  }
  if (subHits.length) meta.push("订阅：" + subHits.join("/"));
  if (detectLang(it.title) === "en" && s.langMode === "all") meta.push("EN");
  if (s.includeScore && it.score) meta.push(Math.round(it.score) + " 分");

  lines.push(prefix + it.title.slice(0, 110));
  lines.push("   " + meta.join(" · "));
  if (s.includeAiReason && it.aiReason) lines.push("   💡 " + it.aiReason);
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
  const candidates = fresh.filter((it) => {
    if (isBlocked({ ...it, sourceId }, rules)) return false;
    return passesPushFilters({ ...it, sourceId }, s);
  });
  const deduper = s.dedupeByTitle ? new TitleDeduper(candidates, recentPushedSeeds(true)) : null;

  const instant: { it: FreshItem; reason: string; subHits: string[]; route: PushRoute | null }[] = [];
  const batched: QueueItem[] = [];
  const quiet = isQuietNow(s);
  const hasRoutes = s.routes?.some((r) => r.enabled);

  for (const it of candidates) {
    if (deduper?.isDuplicate(it)) continue;
    const subHits = matchSubscriptions(it, subKeywords);
    const route = hasRoutes ? matchPushRoute(it, s.routes) : null;
    const d = decide(it, s, subHits, route);

    if (d.push && !quiet) {
      instant.push({ it, reason: d.reason, subHits, route });
      deduper?.markSeen(it);
      continue;
    }
    if (quiet && s.quietAction === "drop") continue;
    if (canEnterBatch(it, s, d)) {
      batched.push({ id: it.id, sourceId, item: it, subHits, route });
      deduper?.markSeen(it);
    }
  }

  if (batched.length && s.batchIntervalMin > 0) enqueue(batched);
  if (quiet && (instant.length || batched.length)) {
    console.log(
      `[push] 静默时段 ${s.quietHours}（${s.quietAction === "drop" ? "已跳过" : "转入攒批 " + batched.length + " 条"}）`,
    );
  }

  const budget = Math.max(0, s.maxPerHour - pushedLastHour());
  const picked = instant.slice(0, Math.min(s.maxPerInstant, budget));
  if (!picked.length) return 0;

  let sent = 0;
  for (const { it, reason, subHits, route } of picked) {
    const prefix = route?.header ? route.header + " · " : s.customHeader ? s.customHeader + " · " : "⚡ 新动态 · ";
    const lines = [prefix + reason, "", ...itemBlock(sourceId, it, s, undefined, subHits)];
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

/** 供后台 AI 补审队列调用：对刚审完通过、尚未推送过的条目触发一次推送判定。 */
export async function pushReviewedByIds(sourceId: string, itemIds: number[]): Promise<number> {
  if (!itemIds.length) return 0;
  const s = getPushSettings();
  if (!s.enabled || !s.pushAfterBackfill || !pushEnabled) return 0;

  const ph = itemIds.map(() => "?").join(",");
  const rows = all<{
    id: number;
    title: string;
    summary: string | null;
    url: string;
    category: string | null;
    kind: string | null;
    score: number;
    codes: string;
    price: number | null;
    is_free: number;
    obtain: string | null;
    expires_at: string | null;
    published_at: string | null;
    ai: string | null;
  }>(
    `SELECT id, title, summary, url, category, kind, score, codes, price, is_free, obtain, expires_at, published_at, ai
       FROM items
      WHERE id IN (${ph}) AND status = 'active' AND pushed_at IS NULL`,
    ...itemIds,
  );
  if (!rows.length) return 0;

  const fresh: FreshItem[] = rows.map((r) => {
    let codes: string[] = [];
    try {
      codes = JSON.parse(r.codes ?? "[]") as string[];
    } catch {
      codes = [];
    }
    const aiMeta = parseAiMeta(r.ai);
    return {
      id: r.id,
      title: r.title,
      url: r.url,
      score: r.score,
      codes,
      expiresAt: r.expires_at,
      publishedAt: r.published_at,
      price: r.price,
      isFree: r.is_free === 1,
      aiKeep: aiMeta.aiKeep,
      aiReason: aiMeta.aiReason,
      kind: r.kind,
      category: r.category,
      obtain: r.obtain,
      summary: r.summary,
    };
  });

  return pushInstant(sourceId, fresh);
}

/* ------------------------------------------------------------------ *
 * 攒批推送（发送前二次回查 DB 最新状态 / 最新屏蔽词 / 最新推送规则）
 * ------------------------------------------------------------------ */

export async function flushBatch(force = false): Promise<number> {
  if (!queue.length) return 0;
  const s = getPushSettings();
  if (!s.enabled || !pushEnabled) return 0;
  if (!force && isQuietNow(s)) return 0;

  const budget = Math.max(0, s.maxPerHour - pushedLastHour());
  if (!budget) return 0;

  const rawTake = queue.splice(0, Math.min(s.maxPerBatch, budget));
  if (!rawTake.length) return 0;

  // 二次回查 DB，避免「队列等待期间被用户关闭 / 加了屏蔽词 / 后台 AI 判非福利」仍然发出去
  const ids = rawTake.map((q) => q.id);
  const ph = ids.map(() => "?").join(",");
  const dbRows = all<{
    id: number;
    source_id: string;
    title: string;
    summary: string | null;
    url: string;
    category: string | null;
    kind: string | null;
    score: number;
    codes: string;
    price: number | null;
    is_free: number;
    obtain: string | null;
    expires_at: string | null;
    published_at: string | null;
    pushed_at: string | null;
    status: string;
    ai: string | null;
  }>(
    `SELECT id, source_id, title, summary, url, category, kind, score, codes, price, is_free, obtain, expires_at, published_at, pushed_at, status, ai
       FROM items WHERE id IN (${ph})`,
    ...ids,
  );
  const rowMap = new Map(dbRows.map((r) => [r.id, r]));
  const rules = loadActiveBlockRules();
  const subKeywords = all<{ keyword: string }>("SELECT keyword FROM subscriptions").map((r) => r.keyword);
  const hasRoutes = s.routes?.some((r) => r.enabled);

  const refreshed: QueueItem[] = [];
  for (const q of rawTake) {
    const r = rowMap.get(q.id);
    // 若 DB 中已不存在（如测试/手动删除）或已关闭/已推，跳过；若是在库中则严格按最新状态重检
    if (!r || r.status !== "active" || r.pushed_at !== null) continue;
    if (isBlocked(r, rules)) continue;
    let codes: string[] = [];
    try {
      codes = JSON.parse(r.codes ?? "[]") as string[];
    } catch {
      codes = [];
    }
    const aiMeta = parseAiMeta(r.ai);
    const fresh: FreshItem = {
      id: r.id,
      title: r.title,
      url: r.url,
      score: r.score,
      codes,
      expiresAt: r.expires_at,
      publishedAt: r.published_at,
      price: r.price,
      isFree: r.is_free === 1,
      aiKeep: aiMeta.aiKeep,
      aiReason: aiMeta.aiReason,
      kind: r.kind,
      category: r.category,
      obtain: r.obtain,
      summary: r.summary,
    };
    if (!passesPushFilters({ ...fresh, sourceId: r.source_id }, s)) continue;
    const subHits = matchSubscriptions(fresh, subKeywords);
    const route = hasRoutes ? matchPushRoute(fresh, s.routes) : null;
    const d = decide(fresh, s, subHits, route);
    if (!canEnterBatch(fresh, s, d)) continue;
    refreshed.push({ id: r.id, sourceId: r.source_id, item: fresh, subHits, route });
  }

  let take = refreshed;
  if (s.dedupeByTitle && refreshed.length) {
    const entries = refreshed.map((q) => ({ title: q.item.title, q }));
    const deduper = new TitleDeduper(entries, recentPushedSeeds(false));
    take = [];
    for (const entry of entries) {
      if (deduper.isDuplicate(entry)) continue;
      deduper.markSeen(entry);
      take.push(entry.q);
    }
  }
  if (!take.length) return 0;

  const blocks: string[] = [];
  take.forEach((q, i) => {
    if (hasRoutes && q.route) {
      blocks.push(`[${q.route.header || q.route.name}]`);
    }
    blocks.push(...itemBlock(q.sourceId, q.item, s, i + 1, q.subHits ?? []));
    blocks.push("");
  });
  const batchTitle = s.customHeader
    ? `${s.customHeader} · 汇总 ${take.length} 条`
    : `📦 本轮新发现 ${take.length} 条`;
  const text = [batchTitle, "", ...blocks].join("\n").trim();

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
 * 预览：按当前全套推送筛选条件算一遍，并给出各维度拦截诊断
 * ------------------------------------------------------------------ */

export function previewPush(limit = 6): {
  instant: string[];
  batch: string[];
  queued: number;
  scanned: number;
  matched: number;
  rejectedBy: {
    blocked: number;
    duplicate: number;
    stale: number;
    source: number;
    lang: number;
    kind: number;
    category: number;
    price: number;
    ai: number;
    obtain: number;
    route: number;
    lowScore: number;
  };
} {
  const s = getPushSettings();
  const rules = loadActiveBlockRules();
  const subKeywords = all<{ keyword: string }>("SELECT keyword FROM subscriptions").map((r) => r.keyword);
  const lookbackHours = s.maxAgeHours > 0 ? Math.min(s.maxAgeHours, 168) : 168;
  const rows = all<{
    id: number;
    source_id: string;
    title: string;
    summary: string | null;
    url: string;
    category: string | null;
    kind: string | null;
    score: number;
    codes: string;
    price: number | null;
    is_free: number;
    obtain: string | null;
    expires_at: string | null;
    pushed_at: string | null;
    published_at: string | null;
    ai: string | null;
  }>(
    `SELECT id, source_id, title, summary, url, category, kind, score, codes, price, is_free, obtain, expires_at, pushed_at, published_at, ai
     FROM items WHERE status = 'active' AND pushed_at IS NULL AND COALESCE(published_at, first_seen_at) >= ?
     ORDER BY score DESC LIMIT 180`,
    new Date(Date.now() - lookbackHours * 3_600_000).toISOString(),
  );

  const instant: string[] = [];
  const batch: string[] = [];
  let matched = 0;
  const rejectedBy = {
    blocked: 0,
    duplicate: 0,
    stale: 0,
    source: 0,
    lang: 0,
    kind: 0,
    category: 0,
    price: 0,
    ai: 0,
    obtain: 0,
    route: 0,
    lowScore: 0,
  };
  const deduper = s.dedupeByTitle ? new TitleDeduper(rows, recentPushedSeeds(true)) : null;
  const hasRoutes = s.routes?.some((r) => r.enabled);

  for (const r of rows) {
    if (isBlocked(r, rules)) {
      rejectedBy.blocked += 1;
      continue;
    }
    if (deduper?.isDuplicate(r)) {
      rejectedBy.duplicate += 1;
      continue;
    }
    let codes: string[] = [];
    try {
      codes = JSON.parse(r.codes ?? "[]") as string[];
    } catch {
      codes = [];
    }
    const aiMeta = parseAiMeta(r.ai);
    const fresh: FreshItem = {
      id: r.id,
      title: r.title,
      url: r.url,
      score: r.score,
      codes,
      expiresAt: r.expires_at,
      publishedAt: r.published_at,
      price: r.price,
      isFree: r.is_free === 1,
      aiKeep: aiMeta.aiKeep,
      aiReason: aiMeta.aiReason,
      kind: r.kind,
      category: r.category,
      obtain: r.obtain,
      summary: r.summary,
    };
    const reject = checkPushFilter({ ...fresh, sourceId: r.source_id }, s);
    if (reject) {
      rejectedBy[reject] = (rejectedBy[reject] ?? 0) + 1;
      continue;
    }

    matched += 1;
    const subHits = matchSubscriptions(fresh, subKeywords);
    const route = hasRoutes ? matchPushRoute(fresh, s.routes) : null;
    const d = decide(fresh, s, subHits, route);
    const block = itemBlock(r.source_id, fresh, s, undefined, subHits).join("\n");
    if (d.push && instant.length < limit) {
      const prefix = route?.header ? route.header + " · " : s.customHeader ? s.customHeader + " · " : "⚡ ";
      instant.push(prefix + d.reason + "\n" + block);
      deduper?.markSeen(r);
    } else if (canEnterBatch(fresh, s, d) && batch.length < limit) {
      const routeNote = hasRoutes && route ? `[路由: ${route.name}]\n` : "";
      batch.push(routeNote + block);
      deduper?.markSeen(r);
    } else if (!d.push && !canEnterBatch(fresh, s, d)) {
      rejectedBy.lowScore += 1;
    }
  }
  return { instant, batch, queued: queue.length, scanned: rows.length, matched, rejectedBy };
}

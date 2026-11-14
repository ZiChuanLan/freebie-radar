import { all, get } from "./db.ts";
import { TitleDeduper } from "./enrich/dedup.ts";

/** 通用虚词 + 福利域里的「无信息量」词：这类词每条标题都有，进词云只会淹没真正的热点 */
const CJK_STOP = new Set(
  (
    "的 了 和 与 或 在 是 有 我 你 他 她 它 这 那 我们 你们 他们 自己 一个 一些 什么 怎么 如何 为什么 " +
    "可以 可能 应该 需要 支持 使用 开始 时候 之后 之前 现在 今天 昨天 明天 已经 还有 就是 不是 没有 " +
    "这个 那个 一下 以及 因为 所以 但是 如果 然后 而且 不过 还有 大家 目前 直接 一键 详情 地址 原文 " +
    "介绍 教程 方法 官网 最新 更新 发布 上线 新增 新增至 免费 免费领 领取 分享 福利 白嫖 限时 限量 名额 " +
    "先到先得 手慢无 速度 来了 好价 只要 超过 以上 以下 左右 更多 全部 部分 各种 一起 另外 同时 注意 " +
    "建议 推荐 官方 活动 时间 问题 内容 东西 进行 通过 东西 真的 非常 特别 完全 一直 还是 也是 都有 " +
    "没用 有用 有人 有点 一点 很多 不少 几个 两个 三个 一次 两次 免费获取 免费下载 免费试用 " +
    "剩余 剩余名额 价值 哪些 一台 到底 名额 现车 入口 直达 秒 元 月 年 个 张 只 份 次 天 小时 分钟 " +
    "真的 心里 心碎 为何 是不是 有没有 能不能 要不要 怎么样 什么样 一句话 全程 全新 全新上线"
  ).split(/\s+/),
);

const EN_STOP = new Set(
  (
    "the and for with you your free new get now from this that are was were will can could should would " +
    "all any out one two three day days today more than about into over just like use using used how what " +
    "why when where which who not but its it's has have had been they them their our my his her she he we " +
    "us me i'm don't doesn to of at by is in on or as an it be if so no do up im nov dec oct jan feb mar " +
    "apr may jun jul aug sep november december october january february march april june july august " +
    "september until below see thread reddit redd it fgf via amp gt lt quot nbsp http https www com net org " +
    "html htm php gif png jpg jpeg webp pdf rss feed blog post posts news site page link links edit update " +
    "updates version release releases available offer offers sale deal deals today only also than then " +
    "when where very much many more most some such take still even ever never again here there both each " +
    "other another own same after before between during without within under above off " +
    "set one two new use brand store shop buy sell price cost cheap best top big small high low"
  )
      .split(/\s+/)
      .filter(Boolean),
);

/** 纯数字、纯标点、纯符号的碎片直接丢掉 */
const JUNK = /^[0-9\p{P}\p{S}\s]+$/u;

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

/** 把标题切成候选词：中文按词、英文按 ≥3 字母的单词，过滤停用词与碎片 */
export function tokenize(title: string): string[] {
  const cleaned = title.replace(/https?:\/\/\S+/gi, " ").replace(/\b[a-z0-9-]+\.(?:ly|to|cc|gg|io|me|co|com|net|org|cn)\b/gi, " ");
  const out: string[] = [];
  for (const part of segmenter.segment(cleaned)) {
    if (!part.isWordLike) continue;
    const raw = part.segment.trim();
    if (raw.length < 2 || JUNK.test(raw)) continue;
    const word = raw.toLowerCase();
    if (/^[a-z]/.test(word)) {
      if (word.length < 3 || word.includes(".") || EN_STOP.has(word)) continue;
    } else if (CJK_STOP.has(word)) {
      continue;
    }
    out.push(word);
  }
  return out;
}

export type HotScope = "all" | "deals" | "news" | "info";
export type HotWord = { w: string; n: number; prev: number; delta: number };
export type HotBucket = { key: string; n: number; prev: number; delta: number };

export type HotTopItem = {
  id: number;
  title: string;
  url: string;
  source_id: string;
  category: string | null;
  kind: string | null;
  obtain?: string | null;
  score: number;
  quality: number | null;
  dupCount?: number;
};

export type HotReport = {
  windowHours: number;
  scope: HotScope;
  from: string;
  to: string;
  /** 窗口内参与统计的条目数（跨源事件去重后） */
  scanned: number;
  prevScanned: number;
  /** 去重前原始条目数 */
  rawScanned: number;
  words: HotWord[];
  categories: HotBucket[];
  kinds: HotBucket[];
  /** 「这个窗口最值得抢」：严格只包含真福利与高性价比好价（已去重，绝不混入新闻/资讯/水帖） */
  top: HotTopItem[];
  /** 「热点新闻与行业资讯」：重要新闻、经济股票、科技前沿与开源项目（已去重） */
  topNews: HotTopItem[];
};

type Row = {
  id: number;
  title: string;
  url: string;
  urlKey: string | null;
  source_id: string;
  category: string | null;
  kind: string | null;
  obtain: string | null;
  codes: string | null;
  score: number;
  ai_quality: number | null;
  ai_keep: number | null;
  published_at: string | null;
  first_seen_at: string;
  publishedAt: string | null;
};

const TOP_WORDS = 40;
const TOP_ITEMS = 8;

function bump(map: Map<string, HotBucket>, key: string, inCurrent: boolean) {
  let row = map.get(key);
  if (!row) {
    row = { key, n: 0, prev: 0, delta: 0 };
    map.set(key, row);
  }
  if (inCurrent) row.n += 1;
  else row.prev += 1;
}

function bumpWord(map: Map<string, HotWord>, w: string, inCurrent: boolean) {
  let row = map.get(w);
  if (!row) {
    row = { w, n: 0, prev: 0, delta: 0 };
    map.set(w, row);
  }
  if (inCurrent) row.n += 1;
  else row.prev += 1;
}

function normalizeScope(raw?: string): HotScope {
  return raw === "deals" || raw === "news" || raw === "info" ? raw : "all";
}

function matchesScope(r: Row, scope: HotScope): boolean {
  const k = r.kind ?? "freebie";
  if (scope === "deals") return k === "freebie" || k === "deal";
  if (scope === "news") return k === "news";
  if (scope === "info") return k === "info" || k === "opensource";
  return true;
}

/** 用 TitleDeduper 折叠同事件/同福利条目，返回代表条 + 聚合来源数 */
function clusterDedupe(rows: Row[]): Array<{ row: Row; count: number }> {
  if (!rows.length) return [];
  const deduper = new TitleDeduper(rows);
  const groups = new Map<number, { row: Row; count: number }>();
  for (const r of rows) {
    const root = deduper.rootOf(r);
    const existing = groups.get(root);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(root, { row: r, count: 1 });
    }
  }
  return [...groups.values()];
}

const cache = new Map<string, HotReport>();

export function buildHotReport(windowHours = 24, rawScope?: string): HotReport {
  const hours = Math.min(Math.max(Math.round(windowHours), 1), 168);
  const scope = normalizeScope(rawScope);
  const now = new Date();
  const sig = get<{ n: number; maxId: number }>(
    "SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS maxId FROM items WHERE status = 'active'",
  );
  const bucket = `${hours}:${scope}:${Math.floor(now.getTime() / 600_000)}:${sig?.n ?? 0}:${sig?.maxId ?? 0}`;
  const hit = cache.get(bucket);
  if (hit) return hit;
  if (cache.size > 8) cache.clear();

  const to = now.toISOString();
  const from = new Date(now.getTime() - hours * 3_600_000).toISOString();

  const rows = all<Row>(
    `SELECT id, title, url, url_key AS urlKey, source_id, category, kind, obtain, codes,
            score, ai_quality, ai_keep, published_at, first_seen_at,
            COALESCE(published_at, first_seen_at) AS publishedAt
       FROM items
      WHERE status = 'active'
        AND (ai_keep = 1 OR ai_keep IS NULL)
        AND (kind IS NULL OR kind != 'noise')
        AND COALESCE(published_at, first_seen_at) >= ?
      ORDER BY COALESCE(ai_quality, 0) DESC, score DESC, COALESCE(published_at, first_seen_at) DESC`,
    new Date(now.getTime() - 2 * hours * 3_600_000).toISOString(),
  );

  const rawCurrent: Row[] = [];
  const rawPrev: Row[] = [];
  const kinds = new Map<string, HotBucket>();

  for (const row of rows) {
    const at = row.published_at ?? row.first_seen_at;
    const inCurrent = at >= from;
    if (inCurrent) rawCurrent.push(row);
    else rawPrev.push(row);
    if (row.kind) bump(kinds, row.kind, inCurrent);
  }

  // 按所选范围过滤并做同事件去重，避免多源转帖把某个热词放大 5-10 倍
  const scopedCurrent = clusterDedupe(rawCurrent.filter((r) => matchesScope(r, scope)));
  const scopedPrev = clusterDedupe(rawPrev.filter((r) => matchesScope(r, scope)));

  const words = new Map<string, HotWord>();
  const categories = new Map<string, HotBucket>();

  for (const { row } of scopedCurrent) {
    for (const w of tokenize(row.title)) bumpWord(words, w, true);
    if (row.category) bump(categories, row.category, true);
  }
  for (const { row } of scopedPrev) {
    for (const w of tokenize(row.title)) bumpWord(words, w, false);
    if (row.category) bump(categories, row.category, false);
  }

  const rank = (a: HotWord) => a.n * 2 + Math.max(0, a.n - a.prev);
  const wordList = [...words.values()]
    .filter((w) => w.n >= 1 && (w.n >= 2 || w.prev >= 2))
    .sort((a, b) => rank(b) - rank(a) || a.w.localeCompare(b.w))
    .slice(0, TOP_WORDS)
    .map((w) => ({ w: w.w, n: w.n, prev: w.prev, delta: w.n - w.prev }));

  const bucketList = (m: Map<string, HotBucket>) =>
    [...m.entries()]
      .map(([key, v]) => ({ key, n: v.n, prev: v.prev, delta: v.n - v.prev }))
      .sort((a, b) => b.n - a.n || b.delta - a.delta);

  // 「这个窗口最值得抢」：严格只取 freebie / deal，排除新闻/资讯/开源/水帖与纯二手/纯商业推广，并按同事件去重
  const dealCandidates = rawCurrent.filter((r) => {
    const k = r.kind ?? "freebie";
    if (k !== "freebie" && k !== "deal") return false;
    if (r.category === "trade" || r.category === "carpool") return false;
    if (r.obtain === "promo") return false;
    return true;
  });
  const top = clusterDedupe(dealCandidates)
    .sort(
      (a, b) =>
        (b.row.ai_quality ?? 0) - (a.row.ai_quality ?? 0) ||
        (b.row.kind === "freebie" ? 1 : 0) - (a.row.kind === "freebie" ? 1 : 0) ||
        b.row.score - a.row.score ||
        (b.row.published_at ?? b.row.first_seen_at).localeCompare(a.row.published_at ?? a.row.first_seen_at),
    )
    .slice(0, TOP_ITEMS)
    .map(({ row: r, count }) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      source_id: r.source_id,
      category: r.category,
      kind: r.kind,
      obtain: r.obtain,
      score: Math.round(r.score),
      quality: r.ai_quality,
      dupCount: count,
    }));

  // 「热点新闻与行业资讯」：重要新闻、经济股票、科技前沿与开源项目（同样跨源去重）
  const newsCandidates = rawCurrent.filter((r) => {
    const k = r.kind ?? "freebie";
    return k === "news" || k === "info" || k === "opensource";
  });
  const topNews = clusterDedupe(newsCandidates)
    .sort(
      (a, b) =>
        (b.row.ai_quality ?? 0) - (a.row.ai_quality ?? 0) ||
        (b.row.kind === "news" ? 1 : 0) - (a.row.kind === "news" ? 1 : 0) ||
        b.row.score - a.row.score ||
        (b.row.published_at ?? b.row.first_seen_at).localeCompare(a.row.published_at ?? a.row.first_seen_at),
    )
    .slice(0, TOP_ITEMS)
    .map(({ row: r, count }) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      source_id: r.source_id,
      category: r.category,
      kind: r.kind,
      obtain: r.obtain,
      score: Math.round(r.score),
      quality: r.ai_quality,
      dupCount: count,
    }));

  const report: HotReport = {
    windowHours: hours,
    scope,
    from,
    to,
    scanned: scopedCurrent.length,
    prevScanned: scopedPrev.length,
    rawScanned: rawCurrent.filter((r) => matchesScope(r, scope)).length,
    words: wordList,
    categories: bucketList(categories),
    kinds: bucketList(kinds),
    top,
    topNews,
  };
  cache.set(bucket, report);
  return report;
}

/**
 * 来源质量榜：按源的 AI 留存率、平均质量分与推送命中率排，用来判断哪些源在浪费采集与 AI 额度。
 * 留存率 = AI 判为有效的条数 / 已审条数；未审核的条目单独计数，不掺进分母。
 */
export function sourceQuality(sinceDays = 7): {
  id: string;
  name: string;
  total: number;
  reviewed: number;
  kept: number;
  rejected: number;
  keepRate: number | null;
  avgQuality: number | null;
  pushed: number;
  lastRun: string | null;
  enabled: number;
  lastError: string | null;
}[] {
  const days = Math.min(Math.max(Math.round(sinceDays), 1), 90);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = all<{
    id: string;
    name: string;
    enabled: number;
    last_run_at: string | null;
    last_error: string | null;
    total: number;
    reviewed: number;
    kept: number;
    rejected: number;
    avgQuality: number | null;
    pushed: number;
  }>(
    `SELECT s.id,
            s.name,
            s.enabled,
            s.last_run_at,
            s.last_error,
            COUNT(i.id) AS total,
            SUM(CASE WHEN i.ai_keep IS NOT NULL THEN 1 ELSE 0 END) AS reviewed,
            SUM(CASE WHEN i.ai_keep = 1 THEN 1 ELSE 0 END) AS kept,
            SUM(CASE WHEN i.ai_keep = 0 THEN 1 ELSE 0 END) AS rejected,
            AVG(CASE WHEN i.ai_quality IS NOT NULL THEN i.ai_quality END) AS avgQuality,
            SUM(CASE WHEN i.pushed_at IS NOT NULL THEN 1 ELSE 0 END) AS pushed
       FROM sources s
       LEFT JOIN items i
         ON i.source_id = s.id
        AND i.status = 'active'
        AND COALESCE(i.published_at, i.first_seen_at) >= ?
      GROUP BY s.id
      ORDER BY s.id`,
    since,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    total: Number(r.total ?? 0),
    reviewed: Number(r.reviewed ?? 0),
    kept: Number(r.kept ?? 0),
    rejected: Number(r.rejected ?? 0),
    keepRate: r.reviewed ? Number(r.kept) / Number(r.reviewed) : null,
    avgQuality: r.avgQuality === null ? null : Math.round(Number(r.avgQuality) * 10) / 10,
    pushed: Number(r.pushed ?? 0),
    lastRun: r.last_run_at,
    enabled: r.enabled,
    lastError: r.last_error,
  }));
}


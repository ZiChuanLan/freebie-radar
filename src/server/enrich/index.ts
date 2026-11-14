import { cleanText, guessExpiry, normalizeUrl, sanitizeImageUrl, urlKey } from "./normalize.ts";
import type { RawItem } from "../collectors/types.ts";
import { extractCodes } from "./codes.ts";
import { extractPrice } from "./pricing.ts";

import { OPENSOURCE_HINT, PROMO_HINT } from "./noise.ts";
import { guessObtain } from "./obtain.ts";
import { guessKind, isContentKind, KIND_LABEL, resolveKind, type ContentKind } from "./kind.ts";

export { guessKind, isContentKind, KIND_LABEL, resolveKind, type ContentKind };
export type Category =
  | "ai" | "cloud" | "vps" | "domain" | "opensource" | "software" | "media" | "game" | "carpool" | "trade" | "news" | "goods" | "invite" | "edu" | "other";

const CATEGORIES = new Set<string>(["ai", "cloud", "vps", "domain", "opensource", "software", "media", "game", "carpool", "trade", "news", "goods", "invite", "edu", "other"]);

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && CATEGORIES.has(value);
}

export const CATEGORY_LABEL: Record<Category, string> = {
  ai: "AI 额度",
  cloud: "云服务",
  vps: "VPS/主机",
  domain: "域名/建站",
  opensource: "开源软件",
  software: "软件授权",
  media: "影音会员",
  game: "游戏",
  carpool: "拼车/合租",
  trade: "二手/交易",
  news: "科技资讯",
  goods: "实物/优惠",
  invite: "邀请码",
  edu: "教育",
  other: "其它",
};

type Rule = { category: Category; weight: number; keywords: string[] };

const RULES: Rule[] = [
  {
    category: "ai",
    weight: 1.15,
    keywords: ["gpt", "chatgpt", "openai", "claude", "gemini", "grok", "llm", "大模型", "api", "token", "额度", "算力", "算力券", "代金券", "qwen", "deepseek", "kimi", "glm", "cursor", "copilot", "midjourney", "sora", "colab", "notebook", "gpu", "体验金", "中转", "codex", "积分", "多模型", "智能体", "ai 模型", "credits", "tokens", "codearts", "mcp", "skill", "agent"],
  },
  {
    category: "vps",
    weight: 1.15,
    keywords: ["vps", "云服务器", "云主机", "独立服务器", "独服", "小鸡", "kvm", "nat", "cn2", "gia", "9929", "cmin2", "racknerd", "dmit", "bandwagon", "搬瓦工", "claw", "ovh", "hetzner", "netcup", "动态ip", "公网ip", "vps 测试", "年付", "月付"],
  },
  {
    category: "cloud",
    weight: 1.1,
    keywords: ["对象存储", "oss", "s3", "r2", "cdn", "带宽", "数据库", "容器", "k8s", "serverless", "免费层", "free tier", "试用金", "额度", "cloud", "azure", "aws", "虚拟机", "存储", "egress", "requests", "代理流量"],
  },
  {
    category: "domain",
    weight: 1.05,
    keywords: ["域名", "domain", "ssl", "证书", "dns", "主机", "虚拟主机", "建站", "托管"],
  },
  {
    // 只认强信号：明确提到开源、GitHub、自托管才算，避免「工具」「插件」这类泛词抢走其它分类
    category: "opensource",
    weight: 1.0,
    keywords: ["开源", "open source", "opensource", "github.com", "github 仓库", "github项目", "gitlab", "self-host", "selfhosted", "自托管", "自建服务", "awesome-", "mit 协议", "apache 协议", "gpl", "源码", "pull request", "开源项目", "开源软件", "开源工具", "开源库"],
  },
  {
    category: "software",
    weight: 1.0,
    keywords: ["激活码", "序列号", "license", "授权", "正版", "绿色版", "注册机", "兑换码", "office", "windows", "adobe", "jetbrains", "photoshop", "会员版", "商业软件", "软件授权", "解锁", "remote desktop", "pipelines", "ci/cd", "永久授权", "免费版", "freemium", "lifetime", "限免"],
  },
  {
    category: "media",
    weight: 1.0,
    keywords: ["会员", "影音", "netflix", "奈飞", "spotify", "youtube", "bilibili", "爱奇艺", "优酷", "腾讯视频", "芒果", "emby", "plex", "音乐", "vip", "网盘", "115", "阿里云盘", "夸克", "影视", "韩剧", "美剧", "日剧", "剧集", "电影", "4k", "1080p", "更至", "配音", "动漫"],
  },
  {
    category: "game",
    weight: 1.05,
    keywords: ["游戏", "epic", "steam", "喜加一", "激活", "游戏本体", "礼包", "cdkey", "xbox", "psn", "switch", "手游", "内测资格", "gog", "itch.io", "indiegala", "giveaway", "key 赠送", "白给", "免费入库", "humble", "皮肤", "dlc", "bundle", "game", "free game", "steam key", "金钥匙", "shift code", "free weekend", "免费周末"],
  },
  {
    category: "carpool",
    weight: 1.25,
    keywords: ["拼车", "合租", "车位", "发车", "家庭组", "family plan", "team 车", "3缺1", "4缺1", "5缺1", "季付车", "月付车", "年付车", "车主", "开车", "上车"],
  },
  {
    category: "trade",
    weight: 1.1,
    keywords: ["出鸡", "收鸡", "转让", "过户", "出号", "成品号", "带原油", "带原邮", "原邮", "剩余价值", "明盘", "闲置出", "折价出", "转手", "出个", "出一台", "出闲置"],
  },
  {
    category: "news",
    weight: 0.9,
    keywords: ["新闻", "快讯", "发布", "更新", "上线", "预告", "公告", "周刊", "日报", "新版本", "changelog", "release notes", "announcing", "launch"],
  },
  {
    category: "goods",
    weight: 0.95,
    keywords: ["包邮", "free shipping", "优惠券", "优惠码", "券码", "满减", "零元", "一分钱", "实物", "试用装", "小样", "京东", "淘宝", "拼多多", "天猫", "羊毛", "折扣", "降价", "元起", "% off", "deal", "clearance", "bogo"],
  },
  {
    category: "invite",
    weight: 0.9,
    keywords: ["邀请码", "邀请链接", "注册码", "开放注册", "注册送", "新用户", "内测", "资格", "名额"],
  },
  {
    category: "edu",
    weight: 0.85,
    keywords: ["课程", "课", "教程", "电子书", "教材", "考试", "题库", "证书", "公开课", "学习", "资料", "ebook", "course"],
  },
];

const DEAL_WORDS = ["免费", "白嫖", "领取", "报名领", "领积分", "赠送", "送", "白送", "白给", "0元", "零元", "试用", "体验", "兑换", "激活码", "福利", "优惠", "折扣", "开通", "送额度", "注册送", "限免", "积分", "代金券", "算力", "free", "giveaway", "coupon", "credits", "tokens"];
const SCARCITY_WORDS = ["限时", "限量", "仅限", "前100", "前 100", "名额", "抽奖", "开放注册", "先到先得", "今日", "今晚", "截止", "最后", "limited", "ends", "until", "last chance", "24h", "while supplies"];
const NOISE_PATTERNS = [/怎么(?:领取|申请|弄|搞)/, /有没有/, /求(?:一个|个|推荐|问)/, /请问/, /值得买吗/, /是什么体验/, /怎么样/, /如何评价/];

const URL_NOISE_RE = /https?:\/\/\S+|\b(?:buff\.ly|ow\.ly|redd\.it|bit\.ly|t\.co|tinyurl\.com|dlvr\.it|goo\.gl|youtu\.be|is\.gd|t\.me)\/\S+/gi;
const ASCII_ONLY_RE = /^[a-z0-9\s./+_-]+$/i;
const KW_REGEX_CACHE = new Map<string, RegExp>();

function stripUrls(s: string): string {
  return s.replace(URL_NOISE_RE, " ");
}

function matchKeyword(textLower: string, kw: string): boolean {
  const k = kw.toLowerCase();
  if (!ASCII_ONLY_RE.test(k)) return textLower.includes(k);
  let re = KW_REGEX_CACHE.get(k);
  if (!re) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`);
    KW_REGEX_CACHE.set(k, re);
  }
  return re.test(textLower);
}

const SOURCE_BONUS: Record<string, number> = {
  "linuxdo-welfare": 8,
  "v2ex-free": 8,
  "epic-free": 8,
  "gamerpower": 7,
  "gamerpower-loot": 7,
  "openrouter-free": 8,
  "rss-itch-free": 6,
  "rss-freesteamkeys": 6,
  "rss-isthereanydeal": 7,
  "cheapshark-free": 6,
  "rss-sharewareonsale": 6,
  "rss-tickcoupon": 6,
  "tg-freegames": 6,
  "rss-reddit-freegames": 6,
  "bsky-gamedeals": 5,
  "rss-reddit-gamedeals": 5,
  "rss-reddit-efreebies": 5,
  "rss-reddit-freegamesonsteam": 5,
  "rss-keylol": 5,
  "rss-nodeseek": 5,
  "rss-indiegamebundles": 4,
  "linuxdo-resource": 4,
  "tg-cn-deals": 4,
  "github-free-for-dev": 3,
  "rss-ithome": 3,
  "rss-smzdm": 3,
  "rss-fuliba": 2,
  "zhihu-search": 4,
  "xhs-search": 4,
  "xiaoheihe-search": 4,
};

export type EnrichedItem = RawItem & {
  category: Category;
  tags: string[];
  codes: string[];
  price: number | null;
  isFree: boolean;
  score: number;
  url: string;
  urlKey: string;
  expiresAt: string | null;
  imageUrl: string | null;
  kind: ContentKind;
  keep: boolean;
  reason: string;
};
export {
  mergeKey,
  extractMergeKeys,
  TitleDeduper,
  dedupeByTitle,
  type DedupeEntry,
} from "./dedup.ts";
export function classify(title: string, summary: string): { category: Category; tags: string[] } {
  const text = stripUrls(`${title} ${summary}`).toLowerCase();
  let best: { category: Category; hits: string[]; score: number } = { category: "other", hits: [], score: 0 };
  for (const rule of RULES) {
    const hits = rule.keywords.filter((k) => matchKeyword(text, k));
    if (!hits.length) continue;
    const score = hits.length * rule.weight;
    if (score > best.score) best = { category: rule.category, hits, score };
  }
  const tags = best.hits.slice(0, 6);
  return { category: best.category, tags };
}

function ageDays(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / 86_400_000;
}

/** 纯免费/喜加一专用源（标题有时省略 "Free" 字样，如 r/FreeGameFindings）。 */
export const FREEBIE_ONLY_SOURCES = new Set([
  "epic-free",
  "steam-free",
  "gamerpower",
  "gamerpower-loot",
  "openrouter-free",
  "rss-itch-free",
  "rss-freesteamkeys",
  "rss-isthereanydeal",
  "rss-reddit-freegames",
  "rss-reddit-freegamesonsteam",
  "rss-reddit-efreebies",
  "rss-reddit-freebies",
  "rss-heyitsfree",
  "rss-freebieshark",
  "rss-giveawayoftheday",
  "rss-tickcoupon",
  "rss-indiegamebundles",
]);
export function scoreItem(input: {
  title: string;
  summary: string;
  publishedAt: string | null;
  sourceId: string;
  category: Category;
  tags: string[];
  expiresAt: string | null;
  isFree?: boolean;
  price?: number | null;
  codes?: string[];
  kind?: ContentKind;
}): { score: number; reason: string } {
  const text = stripUrls(`${input.title} ${input.summary}`).toLowerCase();
  const notes: string[] = [];
  let score = 30;

  if (input.isFree) {
    score += 15;
    notes.push("完全免费");
  } else if (input.price !== null && input.price !== undefined) {
    if (input.price <= 5) {
      score += 8;
      notes.push("低价 ≤5元");
    } else if (input.price > 30 && input.kind !== "deal") {
      score -= 10;
      notes.push("需实付 >30元");
    }
  } else if (FREEBIE_ONLY_SOURCES.has(input.sourceId)) {
    score += 12;
    notes.push("白嫖专源");
  }

  if (input.codes?.length) {
    score += 12;
    notes.push("含兑换码");
  }

  const dealHits = DEAL_WORDS.filter((w) => matchKeyword(text, w));
  if (dealHits.length) {
    const add = dealHits.length >= 2 ? 14 : 10;
    score += add;
    notes.push(`福利词 ×${dealHits.length}`);
  } else if (input.kind === "deal" && PROMO_HINT.test(text)) {
    score += 10;
    notes.push("特惠信号");
  } else if (input.kind === "opensource" && (input.category === "opensource" || OPENSOURCE_HINT.test(text))) {
    score += 10;
    notes.push("开源项目");
  } else if (input.kind === "info" && OPENSOURCE_HINT.test(text)) {
    score += 8;
    notes.push("实用指南");
  } else {
    score -= 8;
    notes.push("无福利词");
  }

  const scarcity = SCARCITY_WORDS.filter((w) => matchKeyword(text, w));
  if (scarcity.length) {
    score += scarcity.length >= 2 ? 8 : 5;
    notes.push(`稀缺 ×${scarcity.length}`);
  }

  if (NOISE_PATTERNS.some((p) => p.test(input.title))) {
    score -= 18;
    notes.push("疑问/求资源");
  }

  const days = ageDays(input.publishedAt);
  if (input.publishedAt) {
    if (days <= 1) {
      score += 16;
      notes.push("24h 内");
    } else if (days <= 3) {
      score += 11;
      notes.push("3 天内");
    } else if (days <= 7) {
      score += 6;
      notes.push("一周内");
    } else if (days > 45) {
      score -= 12;
      notes.push("陈旧");
    }
  }

  if (input.expiresAt) {
    const left = (new Date(input.expiresAt).getTime() - Date.now()) / 86_400_000;
    if (left < 0) {
      return { score: 0, reason: [...notes, "已过期"].join(" · ") };
    } else if (left <= 3) {
      score += 6;
      notes.push("临近截止");
    }
  }

  score += SOURCE_BONUS[input.sourceId] ?? 0;

  if (input.title.length < 6) {
    score -= 10;
    notes.push("标题过短");
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reason: notes.join(" · ") };
}

export function enrichItem(raw: RawItem, sourceId: string): EnrichedItem | null {
  const title = cleanText(raw.title, 200);
  if (!title) return null;
  const summary = cleanText(raw.summary ?? "", 400);
  const url = normalizeUrl(raw.url);
  if (!url) return null;

  const guessed = classify(title, summary);
  const category: Category = guessed.category === "other" && isCategory(raw.categoryHint) ? raw.categoryHint : guessed.category;
  const tags = guessed.tags;
  const codes = extractCodes(title, raw.content ?? raw.summary ?? "");
  const priceInfo = extractPrice(title, summary);
  const expiresAt = raw.expiresAt ?? guessExpiry(`${title} ${summary}`);
  const obtain = guessObtain(title, summary);
  const kind = guessKind({
    title,
    summary,
    sourceId,
    category,
    obtain,
    isFree: priceInfo.isFree,
    price: priceInfo.price,
    freebieOnlySource: FREEBIE_ONLY_SOURCES.has(sourceId),
  });
  const { score, reason } = scoreItem({
    title,
    summary,
    publishedAt: raw.publishedAt ?? null,
    sourceId,
    category,
    tags,
    expiresAt,
    isFree: priceInfo.isFree,
    price: priceInfo.price,
    codes,
    kind,
  });

  const expired = Boolean(expiresAt && new Date(expiresAt).getTime() < Date.now());

  return {
    ...raw,
    codes,
    price: priceInfo.price,
    isFree: priceInfo.isFree,
    title,
    summary,
    url,
    urlKey: urlKey(url),
    category,
    tags,
    expiresAt,
    score,
    imageUrl: sanitizeImageUrl(raw.imageUrl, url),
    kind,
    keep: !expired,
    reason,
  };
}

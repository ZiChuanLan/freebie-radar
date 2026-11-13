import { cleanText, guessExpiry, normalizeUrl, urlKey } from "./normalize.ts";
import type { RawItem } from "../collectors/types.ts";
import { extractCodes } from "./codes.ts";
import { extractPrice } from "./pricing.ts";

export type Category =
  | "ai" | "cloud" | "domain" | "opensource" | "software" | "media" | "game" | "goods" | "invite" | "edu" | "other";

const CATEGORIES = new Set<string>(["ai", "cloud", "domain", "opensource", "software", "media", "game", "goods", "invite", "edu", "other"]);

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && CATEGORIES.has(value);
}

export const CATEGORY_LABEL: Record<Category, string> = {
  ai: "AI 额度",
  cloud: "云服务",
  domain: "域名/主机",
  opensource: "开源软件",
  software: "软件授权",
  media: "影音会员",
  game: "游戏",
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
    keywords: ["gpt", "chatgpt", "openai", "claude", "gemini", "grok", "llm", "大模型", "api", "token", "额度", "算力", "qwen", "deepseek", "kimi", "glm", "cursor", "copilot", "midjourney", "sora", "colab", "notebook", "gpu", "体验金", "中转", "codex", "积分", "多模型", "智能体", "llm", "ai 模型", "credits", "tokens"],
  },
  {
    category: "cloud",
    weight: 1.1,
    keywords: ["云服务器", "vps", "云主机", "对象存储", "oss", "s3", "r2", "cdn", "带宽", "数据库", "容器", "k8s", "serverless", "免费层", "free tier", "试用金", "额度", "cloud", "azure", "aws", "虚拟机", "存储", "egress", "requests", "动态ip", "公网ip", "vps 测试", "cdn", "对象存储"],
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
    weight: 1.0,
    keywords: ["游戏", "epic", "steam", "喜加一", "激活", "游戏本体", "礼包", "cdkey", "xbox", "psn", "switch", "手游", "内测资格", "gog", "itch.io", "indiegala", "giveaway", "key 赠送", "白给", "免费入库", "humble", "皮肤", "dlc", "bundle", "game", "free game", "steam key"],
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

const DEAL_WORDS = ["免费", "白嫖", "领取", "赠送", "送", "0元", "零元", "试用", "体验", "兑换", "激活码", "福利", "优惠", "折扣", "开通", "送额度", "注册送", "限免", "free", "giveaway", "coupon"];
const SCARCITY_WORDS = ["限时", "限量", "仅限", "前100", "前 100", "名额", "抽奖", "开放注册", "先到先得", "今日", "今晚", "截止", "最后"];
const NOISE_PATTERNS = [/怎么(?:领取|申请|弄|搞)/, /有没有/, /求(?:一个|个|推荐|问)/, /请问/, /值得买吗/, /是什么体验/, /怎么样/, /如何评价/];

const SOURCE_BONUS: Record<string, number> = {
  "linuxdo-welfare": 8,
  "v2ex-free": 8,
  "epic-free": 8,
  "gamerpower": 7,
  "rss-isthereanydeal": 7,
  "cheapshark-free": 6,
  "rss-sharewareonsale": 6,
  "rss-tickcoupon": 6,
  "tg-freegames": 6,
  "bsky-gamedeals": 5,
  "rss-nodeseek": 5,
  "linuxdo-resource": 4,
  "github-free-for-dev": 3,
  "rss-fuliba": 2,
  "tg-cn-deals": 4,
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
  keep: boolean;
  reason: string;
};

/** 判定「同一个福利」时不该贡献区分度的词：品类词、渠道词、连接词。 */
const MERGE_STOP = new Set([
  "epic", "steam", "gog", "games", "game", "store", "mobile", "android", "ios", "pc",
  "free", "freebie", "giveaway", "giveaways", "offer", "deal", "deals", "sale",
  "the", "for", "and", "with", "via", "new", "now", "week", "weekly", "today", "this",
  "is", "on", "to", "of", "in", "at", "from", "you", "your", "get", "grab", "claim",
  "available", "live", "out", "will", "hand", "here", "more", "than", "just", "but",
  "prime", "members", "gaming", "week", "official", "store", "percent", "off",
  // 通用词：这些出现在标题里不代表是同一个福利，
  // 第一版没排除它们，导致「ai」把 120 条含 AI 的帖子合并成一条
  "ai", "app", "apps", "ip", "api", "web", "www", "http", "https", "com", "net", "org",
  "pro", "max", "plus", "lite", "beta", "alpha", "test", "demo", "trial", "vip",
  "ceo", "cto", "team", "news", "info", "blog", "post", "code", "dev", "devs",
  "gb", "mb", "tb", "gbps", "mbps", "ram", "cpu", "ssd", "vps", "vds", "cdn", "dns",
  "usd", "eur", "gbp", "cny", "rmb", "per", "month", "year", "day", "hour",
]);

/**
 * 合并同一福利用的指纹。
 *
 * titleKey 那种「全标题归一化」对付措辞不同的多源报道是无效的：
 * 同一款 Knightica 会有 "Knightica (Epic Games) Giveaway"、
 * "Knightica is free on Epic Games Store"、"【免费领】Knightica"…十几种写法。
 *
 * 这里改成抽「主体名」：先把渠道词/品类词/连接词全部剔掉，
 * 剩下的专有名词就是这款游戏/这个商品的名字。
 *   "[Epic Games Mobile] (Game) Knightica"        -> knightica
 *   "Knightica is free on Epic Games Store"       -> knightica
 *   "[PC, Android, Epic] Free - Alien: Isolation" -> alien isolation
 * 中文标题则退回《》里的内容。
 */
export function mergeKey(title: string): string {
  const words = (title.match(/[A-Za-z][A-Za-z0-9:'!.-]{1,}/g) ?? [])
    .map((w) => w.replace(/[.'!-]+$/, "").toLowerCase())
    .filter((w) => w.length > 1 && !MERGE_STOP.has(w));

  if (words.length) {
    // 去重但保留首次出现顺序，避免 "Alien Isolation Alien" 这类重复
    const uniq = [...new Set(words)].slice(0, 4);
    return uniq.join(" ");
  }

  const cn = /《([^》]{2,30})》/.exec(title)?.[1]?.trim();
  if (cn) return cn;

  return title
    .replace(/【[^】]*】|\[[^\]]*\]/g, " ")
    .replace(/[（(][^)）]*[)）]/g, " ")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
    .trim()
    .slice(0, 60);
}
export function classify(title: string, summary: string): { category: Category; tags: string[] } {
  const text = `${title} ${summary}`.toLowerCase();
  let best: { category: Category; hits: string[]; score: number } = { category: "other", hits: [], score: 0 };
  for (const rule of RULES) {
    const hits = rule.keywords.filter((k) => text.includes(k));
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

export function scoreItem(input: { title: string; summary: string; publishedAt: string | null; sourceId: string; category: Category; tags: string[]; expiresAt: string | null }): { score: number; reason: string } {
  const text = `${input.title} ${input.summary}`.toLowerCase();
  const notes: string[] = [];
  let score = 32;

  const dealHits = DEAL_WORDS.filter((w) => text.includes(w.toLowerCase()));
  if (dealHits.length) {
    const add = Math.min(dealHits.length, 4) * 7;
    score += add;
    notes.push(`福利词 ×${dealHits.length}`);
  } else {
    score -= 8;
    notes.push("无福利词");
  }

  const scarcity = SCARCITY_WORDS.filter((w) => text.includes(w));
  if (scarcity.length) {
    score += Math.min(scarcity.length, 3) * 5;
    notes.push(`稀缺 ×${scarcity.length}`);
  }

  if (NOISE_PATTERNS.some((p) => p.test(input.title))) {
    score -= 14;
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
  const { score, reason } = scoreItem({
    title,
    summary,
    publishedAt: raw.publishedAt ?? null,
    sourceId,
    category,
    tags,
    expiresAt,
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
    keep: !expired,
    reason,
  };
}

import { DEAL_HINT, NOISE_TITLE, OPENSOURCE_HINT, PROMO_HINT } from "./noise.ts";

export type ContentKind = "freebie" | "deal" | "opensource" | "news" | "info" | "noise";

export const VALID_KINDS = new Set<ContentKind>(["freebie", "deal", "opensource", "news", "info", "noise"]);

export const KIND_LABEL: Record<ContentKind, string> = {
  freebie: "白嫖福利",
  deal: "特价好价",
  opensource: "开源项目",
  news: "重要新闻",
  info: "行业资讯",
  noise: "噪音水帖",
};

export function isContentKind(v: unknown): v is ContentKind {
  return typeof v === "string" && VALID_KINDS.has(v as ContentKind);
}

const OPENSOURCE_SOURCES = new Set([
  "github-free-for-dev",
  "github-public-apis",
  "github-awesome-ai",
  "github-selfhosted",
]);

const DEAL_SOURCES = new Set([
  "rss-lowendbox",
  "rss-reddit-gamedeals",
  "rss-reddit-googleplay",
  "rss-9to5toys",
  "rss-slickdeals",
  "rss-hip2save",
  "rss-ozbargain",
  "rss-smzdm",
]);

export const NEWS_SOURCES = new Set([
  "cctv-news",
  "rss-chinanews-scroll",
  "rss-chinanews-china",
  "rss-chinanews-world",
  "rss-bbc-zh",
  "rss-dw-cn",
  "rss-rfi-cn",
  "rss-gnews-cn",
  "rss-gnews-world",
]);

export function isAuthoritativeNewsSource(sourceId: string | null | undefined): boolean {
  return Boolean(sourceId && NEWS_SOURCES.has(sourceId));
}

const INFO_SOURCES = new Set([
  "cctv-economy",
  "cctv-tech",
  "rss-wallstreetcn",
  "rss-chinanews-finance",
  "rss-chinanews-it",
  "rss-ruanyifeng",
  "rss-sspai",
  "rss-appinn",
  "rss-producthunt",
  "rss-hnrss",
  "rss-ithome",
  "rss-v2ex-tech",
  "rss-solidot",
]);

/**
 * 规则兜底推断内容形态（AI 未审或未返回 kind 时使用）。
 * 原则：硬噪音判 noise；明确开源且无纯白嫖词判 opensource；付费/黑五/特价促销判 deal；
 * 权威时政/国际要闻判 news；经济/股票/科技/深度指南判 info；其余按免费信号落位。
 */
export function guessKind(input: {
  title: string;
  summary?: string;
  sourceId?: string;
  category?: string | null;
  obtain?: string | null;
  isFree?: boolean;
  price?: number | null;
  freebieOnlySource?: boolean;
}): ContentKind {
  const title = input.title ?? "";
  const text = `${title} ${input.summary ?? ""}`;
  if (NOISE_TITLE.test(title)) return "noise";
  if (input.freebieOnlySource) return "freebie";

  const hasDealWord = DEAL_HINT.test(title);
  const hasPromoWord = PROMO_HINT.test(text);
  const hasOpenSource = input.category === "opensource" || OPENSOURCE_HINT.test(text);

  if (hasOpenSource && !hasDealWord && input.obtain !== "paid") {
    return "opensource";
  }
  if (input.sourceId && OPENSOURCE_SOURCES.has(input.sourceId) && !hasDealWord) {
    return "opensource";
  }

  const hasPaidPrice = !input.isFree && typeof input.price === "number" && input.price > 0;
  if (input.obtain === "paid" || hasPaidPrice) {
    return "deal";
  }
  if (hasPromoWord && !hasDealWord && !input.isFree) {
    return "deal";
  }
  if ((input.category === "carpool" || input.category === "trade") && !input.isFree && !hasDealWord) {
    return "deal";
  }
  if (input.sourceId && DEAL_SOURCES.has(input.sourceId) && !input.isFree && !hasDealWord) {
    return "deal";
  }

  if (input.sourceId && NEWS_SOURCES.has(input.sourceId)) return "news";
  if (input.isFree || hasDealWord) return "freebie";
  if (input.sourceId && INFO_SOURCES.has(input.sourceId)) return "info";
  if (input.category === "opensource") return "opensource";
  if (
    input.category === "headline" ||
    input.category === "world" ||
    input.category === "stock" ||
    input.category === "finance" ||
    input.category === "tech" ||
    input.category === "news" ||
    input.category === "edu"
  ) {
    // 非权威新闻源（如什么值得买/IT之家/社区）不得落入 news，统一归为 info（导购站由上方 DEAL_SOURCES 先拦）
    return "info";
  }
  return "freebie";
}

function coerceNonNewsKind(fallbackInput: Parameters<typeof guessKind>[0]): ContentKind {
  if (
    fallbackInput.sourceId &&
    DEAL_SOURCES.has(fallbackInput.sourceId) &&
    !fallbackInput.isFree &&
    !DEAL_HINT.test(fallbackInput.title ?? "")
  ) {
    return "deal";
  }
  const guessed = guessKind(fallbackInput);
  return guessed === "news" || guessed === "noise" ? "info" : guessed;
}

/** 结合 AI 输出与规则上下文归一化最终 kind。 */
export function resolveKind(
  aiKind: unknown,
  aiKeep: boolean | null | undefined,
  fallbackInput: Parameters<typeof guessKind>[0],
): ContentKind {
  if (aiKeep === false) return "noise";
  if (isContentKind(aiKind)) {
    if (aiKind === "noise" && aiKeep === true) return guessKind(fallbackInput);
    if (aiKind === "opensource" && (fallbackInput.category === "headline" || fallbackInput.category === "world" || fallbackInput.category === "stock")) {
      return guessKind(fallbackInput);
    }
    // 重要新闻严格限定于权威新闻源，禁止导购/购物/普通社区（如什么值得买、IT之家等）混入「重要新闻」
    if (aiKind === "news" && !isAuthoritativeNewsSource(fallbackInput.sourceId)) {
      return coerceNonNewsKind(fallbackInput);
    }
    return aiKind;
  }
  if (aiKeep === true) {
    if (fallbackInput.category === "opensource") return "opensource";
    if (fallbackInput.obtain === "paid" || (!fallbackInput.isFree && typeof fallbackInput.price === "number" && fallbackInput.price > 0)) {
      return "deal";
    }
    const guessed = guessKind(fallbackInput);
    return guessed === "noise" ? "freebie" : guessed;
  }
  return guessKind(fallbackInput);
}

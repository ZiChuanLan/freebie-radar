import { DEAL_HINT, NOISE_TITLE, OPENSOURCE_HINT, PROMO_HINT } from "./noise.ts";

export type ContentKind = "freebie" | "deal" | "opensource" | "info" | "noise";

export const VALID_KINDS = new Set<ContentKind>(["freebie", "deal", "opensource", "info", "noise"]);

export const KIND_LABEL: Record<ContentKind, string> = {
  freebie: "白嫖福利",
  deal: "特价好价",
  opensource: "开源项目",
  info: "实用指南",
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
  "rss-hnrss",
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

const INFO_SOURCES = new Set([
  "rss-ruanyifeng",
  "rss-sspai",
  "rss-appinn",
  "rss-producthunt",
]);

/**
 * 规则兜底推断内容形态（AI 未审或未返回 kind 时使用）。
 * 原则：硬噪音判 noise；明确开源且无纯白嫖词判 opensource；付费/黑五/特价促销判 deal；其余按源特征与免费信号落位。
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
  if (input.sourceId && DEAL_SOURCES.has(input.sourceId) && !input.isFree && !hasDealWord) {
    return "deal";
  }

  if (input.isFree || hasDealWord) return "freebie";
  if (input.sourceId && INFO_SOURCES.has(input.sourceId)) return "info";
  if (input.category === "opensource") return "opensource";
  if (input.category === "edu") return "info";
  return "freebie";
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

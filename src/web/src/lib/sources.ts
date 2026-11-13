import type { Source } from "../types.ts";

/** 获取方式：决定这条到底算不算「完全白嫖」。 */
export const OBTAIN_LABEL: Record<string, string> = {
  free: "直接白嫖",
  conditional: "有条件",
  lottery: "抽奖",
  trial: "试用",
  promo: "推广",
  paid: "需付费",
};

export const OBTAIN_HINT: Record<string, string> = {
  free: "点开就能领，不用发帖、邀请、抽签",
  conditional: "要回帖/转发/邀请/实名才能拿",
  lottery: "抽名额开奖，不一定轮到你",
  trial: "免费试用 N 天，到期要付费",
  promo: "商家推广自家服务的引流钩子",
  paid: "要实付钱才拿得到",
};

export const OBTAIN_ORDER = ["free", "conditional", "lottery", "trial", "promo", "paid"] as const;

export const CATEGORY_LABEL: Record<string, string> = {
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

export type SourceGroupKey = "community" | "game" | "software" | "deals";

export const SOURCE_GROUPS: { key: SourceGroupKey; label: string }[] = [
  { key: "community", label: "国内社区与线报" },
  { key: "game", label: "游戏喜加一与史低" },
  { key: "software", label: "软件 · AI · 开源" },
  { key: "deals", label: "综合羊毛与优惠" },
];

export function groupOfSource(s: Source): SourceGroupKey {
  const id = s.id;
  if (
    id.startsWith("linuxdo-") ||
    id.startsWith("v2ex-") ||
    id.includes("nodeseek") ||
    id.endsWith("-search") ||
    id === "tg-cn-deals"
  ) {
    return "community";
  }
  if (
    id === "epic-free" ||
    id === "steam-free" ||
    id.startsWith("gamerpower") ||
    id === "cheapshark-free" ||
    id === "gog-free" ||
    id === "tg-freegames" ||
    id === "bsky-gamedeals" ||
    /itad|isthereanydeal|indiegame|ggdeals|keylol|freegame|gamedeal|itch-free|freesteamkeys/i.test(id)
  ) {
    return "game";
  }
  if (
    id.startsWith("github-") ||
    id === "openrouter-free" ||
    id === "bsky-plugins" ||
    /shareware|tickcoupon|giveawayoftheday|ghxi|appinn|iplaysoft|iapps|sspai|producthunt|hnrss|ruanyifeng|apphookup|googleplay|freeebooks/i.test(
      id,
    )
  ) {
    return "software";
  }
  return "deals";
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return m + " 分钟前";
  const h = Math.round(m / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.round(h / 24);
  if (d < 30) return d + " 天前";
  return new Date(iso).toLocaleDateString("zh-CN");
}

export function expiresLabel(iso: string | null | undefined): { text: string; urgent: boolean } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  if (days < 0) return { text: "已过期", urgent: true };
  if (days === 0) return { text: "今天截止", urgent: true };
  return { text: days + " 天后截止", urgent: days <= 3 };
}

/** 从标题里拆出方便点击快速屏蔽的候选词片段（中英分词的轻量替代）。 */
export function extractBlockCandidates(title: string): string[] {
  const parts = title
    .replace(/【[^】]+】|[[^]]+]/g, " ")
    .split(/[s|,，。：:；;!?！？/()（）·—-]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 16 && !/^d+$/.test(s));
  return [...new Set(parts)].slice(0, 8);
}

export function formatInterval(sec: number): string {
  if (sec < 120) return sec + " 秒";
  if (sec < 3600) return Math.round(sec / 60) + " 分钟";
  return (sec / 3600).toFixed(sec % 3600 === 0 ? 0 : 1) + " 小时";
}

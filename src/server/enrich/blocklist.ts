import { all } from "../db.ts";

export type BlockRule = {
  id: number;
  pattern: string;
  mode: "keyword" | "regex";
  scope: string;
  enabled: number;
  created_at: string;
};

/** 常见非福利新闻/讨论噪音，用户在界面可一键导入，不强制默认写入。 */
export const PRESET_NOISE_PATTERNS: { pattern: string; mode: "keyword" | "regex"; scope: string; note: string }[] = [
  { pattern: "避坑", mode: "keyword", scope: "all", note: "选购/消费避坑文章" },
  { pattern: "测评", mode: "keyword", scope: "all", note: "产品长测/开箱" },
  { pattern: "横评", mode: "keyword", scope: "all", note: "多款对比评测" },
  { pattern: "怎么选", mode: "keyword", scope: "all", note: "选购攻略" },
  { pattern: "值得买吗", mode: "keyword", scope: "all", note: "询问讨论" },
  { pattern: "致歉", mode: "keyword", scope: "all", note: "车企/品牌公告新闻" },
  { pattern: "股价", mode: "keyword", scope: "all", note: "财经新闻" },
  { pattern: "油价", mode: "keyword", scope: "all", note: "油价新闻" },
  { pattern: "漏电", mode: "keyword", scope: "all", note: "维修讨论" },
  { pattern: "研学", mode: "keyword", scope: "all", note: "消费吐槽" },
  { pattern: "冠军阵容", mode: "keyword", scope: "all", note: "电竞资讯" },
  { pattern: "^(请问|求助|有没有|求推荐|求一个)", mode: "regex", scope: "all", note: "求资源提问帖" },
];

export function loadActiveBlockRules(): BlockRule[] {
  return all<BlockRule>("SELECT id, pattern, mode, scope, enabled, created_at FROM block_rules WHERE enabled = 1 ORDER BY id");
}

export function compileRule(rule: BlockRule): (text: string, sourceId: string) => boolean {
  const scope = rule.scope || "all";
  if (rule.mode === "regex") {
    let re: RegExp | null = null;
    try {
      re = new RegExp(rule.pattern, "i");
    } catch {
      re = null;
    }
    return (text, sourceId) => {
      if (scope !== "all" && scope !== sourceId) return false;
      if (re) return re.test(text);
      return text.toLowerCase().includes(rule.pattern.toLowerCase());
    };
  }
  const needle = rule.pattern.toLowerCase();
  return (text, sourceId) => {
    if (scope !== "all" && scope !== sourceId) return false;
    return text.toLowerCase().includes(needle);
  };
}

export function matchBlockRules(
  item: { title: string; summary?: string | null; source_id?: string; sourceId?: string },
  rules: BlockRule[],
): BlockRule | null {
  if (!rules.length) return null;
  const text = (item.title ?? "") + " " + (item.summary ?? "");
  const sourceId = item.source_id ?? item.sourceId ?? "";
  for (const rule of rules) {
    if (compileRule(rule)(text, sourceId)) return rule;
  }
  return null;
}

export function isBlocked(item: { title: string; summary?: string | null; source_id?: string; sourceId?: string }, rules?: BlockRule[]): boolean {
  const list = rules ?? loadActiveBlockRules();
  return matchBlockRules(item, list) !== null;
}

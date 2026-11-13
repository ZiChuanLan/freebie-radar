/**
 * 跨源去重指纹与聚类器：
 * 1. 对含《》的标题（游戏/软件/书名），同时抽取中文名与英文名，避免
 *    "《斗阵骑士 Knightica》"（产出 knightica）与 "《斗阵骑士》"（产出 斗阵骑士）互相失配。
 * 2. 对纯英文标题，剔除 [平台] 标签与停用词，保留专有名词。
 * 3. 对无《》的中文/中英混排标题，保留中文主体词而非丢光中文只剩 "coding plan" / "windows"，
 *    避免不同商家的相同品类福利被误合并。
 * 4. 在筛选/推送/精选时用 Union-Find 做连通分量聚类，只要存在双语桥接条目，
 *    同组所有中英文来源报道都会收敛到同一聚类。
 */

const MERGE_STOP = new Set([
  "epic", "steam", "gog", "games", "game", "store", "mobile", "android", "ios", "pc", "multi",
  "itch", "indiegala", "humble", "fanatical", "ubisoft", "xbox", "ps4", "ps5", "switch", "egs",
  "free", "freebie", "freebies", "giveaway", "giveaways", "offer", "deal", "deals", "sale",
  "dlc", "key", "keys", "cdkey", "steamkey", "license", "lifetime", "edition", "bundle", "titles", "title",
  "the", "for", "and", "with", "via", "new", "now", "week", "weekly", "today", "this", "next",
  "is", "are", "was", "will", "be", "on", "to", "of", "in", "at", "from", "you", "your", "get", "grab", "claim",
  "available", "live", "out", "hand", "here", "more", "than", "just", "but", "see", "below",
  "prime", "members", "gaming", "official", "percent", "off", "keep", "forever", "redeem",
  "discount", "coupon", "promo", "psa", "aff", "noaff", "pcdd", "ad", "reg", "ca", "us", "eu", "uk", "au",
  "reddit", "thread", "threads", "comment", "comments", "view", "join", "share", "shar",
  "alert", "weekend", "f2p", "event", "ends", "through", "pm", "am", "et", "pt", "utc",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  // 通用产品/技术词：不能单独作为去重键
  "ai", "app", "apps", "ip", "api", "web", "www", "http", "https", "com", "net", "org",
  "pro", "max", "plus", "lite", "beta", "alpha", "test", "demo", "trial", "vip",
  "ceo", "cto", "team", "news", "info", "blog", "post", "code", "dev", "devs",
  "gb", "mb", "tb", "gbps", "mbps", "ram", "cpu", "ssd", "vps", "vds", "cdn", "dns",
  "usd", "eur", "gbp", "cny", "rmb", "per", "month", "months", "year", "years", "day", "days", "hour", "hours",
]);

/** 《》里出现这些词时说明是标签/前缀（如《AFF》），不是商品名。 */
const BOOK_NOISE = new Set([
  "aff", "noaff", "无aff", "福利", "羊毛", "限免", "限时免费", "免费", "免费领", "免费领取",
  "喜加一", "白嫖", "活动", "教程", "攻略", "推荐", "公告", "置顶", "转载", "首发", "原创",
  "求助", "讨论", "抽奖", "优惠", "epic", "steam", "gog", "epic移动版", "steam限免",
]);

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
const HAS_CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const LATIN_RE = /[A-Za-z]/g;
const BRACKET_TAG_RE = /【[^】]*】|\[[^\]]*\]/g;
const PAREN_TAG_RE = /（[^）]*）|\([^)]*\)/g;
const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
const CN_FILLER_RE =
  /(?:免费领取|免费领|免费送|限时免费|限免|免费|白嫖|喜加一|移动版|手游版|无aff|攻略|教程|活动|本周|本月|今日|今天|游戏|的)/gi;

function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

function isValidKey(key: string): boolean {
  if (!key) return false;
  return utf8ByteLength(key) >= 4;
}

function extractLatinKey(text: string): string {
  const words = (text.match(/[A-Za-z][A-Za-z0-9:'!.-]{1,}/g) ?? [])
    .map((w) => w.replace(/[.'!-]+$/, "").toLowerCase())
    .filter((w) => w.length > 1 && !MERGE_STOP.has(w));
  if (!words.length) return "";
  return [...new Set(words)].slice(0, 4).join(" ");
}

function extractCjkFromBook(text: string): string {
  const withoutLatin = text.replace(/[A-Za-z][A-Za-z0-9:'!.-]*/g, " ");
  const cleaned = withoutLatin.replace(/[^\u4e00-\u9fff\u3400-\u4dbf0-9]+/g, "").trim();
  const cjkCount = (cleaned.match(CJK_RE) ?? []).length;
  return cjkCount >= 2 ? cleaned.slice(0, 40) : "";
}

function normalizeCnTitle(title: string, stripFiller: boolean): string {
  let s = title
    .replace(BRACKET_TAG_RE, " ")
    .replace(PAREN_TAG_RE, " ")
    .replace(/《([^》]{1,40})》/g, (_, inner: string) => {
      const norm = inner.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "");
      return BOOK_NOISE.has(norm) ? " " : ` ${inner} `;
    })
    .replace(EMOJI_RE, " ");

  if (stripFiller) {
    s = s
      .replace(/\b(?:epic|steam|gog|aff|noaff)\b/gi, " ")
      .replace(CN_FILLER_RE, " ");
  }

  return s
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
    .replace(/([\u4e00-\u9fff\u3400-\u4dbf])\s+/g, "$1")
    .replace(/\s+([\u4e00-\u9fff\u3400-\u4dbf])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 60);
}

function findBookMatches(title: string): { inner: string; endIndex: number }[] {
  const matches: { inner: string; endIndex: number }[] = [];
  const bookRe = /《([^》]{2,40})》/g;
  let m: RegExpExecArray | null;
  while ((m = bookRe.exec(title)) !== null) {
    const inner = m[1]!.trim();
    const norm = inner.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "");
    if (!BOOK_NOISE.has(norm)) {
      matches.push({ inner, endIndex: m.index + m[0].length });
    }
  }
  return matches;
}

function hasBookTitle(title: string): boolean {
  return findBookMatches(title).length > 0;
}
function cleanEnglishForMerge(raw: string): string {
  let s = raw
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:buff\.ly|ow\.ly|redd\.it|bit\.ly|t\.co|tinyurl\.com|dlvr\.it|goo\.gl|youtu\.be|is\.gd|t\.me)\/\S+/gi, " ")
    .replace(/(?:^|\s)\/?r\/[A-Za-z0-9_]+/g, " ")
    .replace(/(?:^|\s)#[A-Za-z0-9_]+/g, " ")
    .replace(/\*\*|__|\\?->|→/g, " -> ")
    .replace(EMOJI_RE, " ");

  // 处理多方括号写法：[Multi] [Knightica] [CA$16.99 → Free] [Recruit...]
  if (/^(?:\[[^\]]+\]\s*){2,}/.test(s)) {
    const segs = [...s.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!.trim());
    for (const seg of segs) {
      if (/[$€£¥%]|->|→|\bfree\b|\boff\b/i.test(seg)) continue;
      const candidate = extractLatinKey(seg);
      if (candidate && candidate.split(" ").length <= 4) {
        return seg;
      }
    }
  }

  s = s.replace(BRACKET_TAG_RE, " ").trim();

  // 在「is free / free via / — / . / ->」等说明分隔处切出主体产品名
  const cutRe =
    /(?:\s+(?:is|are)\s+(?:now\s+)?(?:completely\s+)?free\b|\s+will\s+be\s+free\b|\s+free\s+(?:to\s+keep|on|via|at|from|for)\b|\s+[—–|]\s+|\.\s+|\s+->\s+|\bview\s+post\s+on\s+reddit\b)/i;
  const hit = cutRe.exec(s);
  if (hit && hit.index > 0) {
    const head = s.slice(0, hit.index).trim();
    if (extractLatinKey(head)) return head;
    const tail = s.slice(hit.index + hit[0].length).replace(/^[:\s—–-]+/, "").trim();
    const tailHit = cutRe.exec(tail);
    const clause = tailHit && tailHit.index > 0 ? tail.slice(0, tailHit.index).trim() : tail;
    if (extractLatinKey(clause)) return clause;
  }
  return s;
}
/**
 * 从标题提取可用于跨源合并的所有等价指纹：
 * - 单条《斗阵骑士 Knightica》会同时返回 ["knightica", "斗阵骑士"]，从而打通纯英文与纯中文报道。
 */
export function extractMergeKeys(title: string): string[] {
  const keys: string[] = [];
  const push = (k: string) => {
    if (isValidKey(k) && !keys.includes(k)) keys.push(k);
  };

  // 1. 优先识别《...》内的标准作品名（跳过《AFF》等标签）
  const bookMatches = findBookMatches(title);

  if (bookMatches.length === 1) {
    const only = bookMatches[0]!;
    const latin = extractLatinKey(only.inner);
    const cjk = extractCjkFromBook(only.inner);
    push(latin);
    // 紧跟在《中文名》后面的括号英文别名，如《斗阵骑士》（Knightica）
    const tail = title.slice(only.endIndex);
    const adj = /^\s*[（(]([^)）]{2,40})[)）]/.exec(tail);
    if (adj) push(extractLatinKey(adj[1]!));
    push(cjk);
    if (keys.length) return keys;
  } else if (bookMatches.length > 1) {
    const latins = bookMatches.map((b) => extractLatinKey(b.inner)).filter(Boolean).sort();
    const cjks = bookMatches.map((b) => extractCjkFromBook(b.inner)).filter(Boolean).sort();
    if (latins.length === bookMatches.length) push(latins.join(" + "));
    if (cjks.length === bookMatches.length) push(cjks.join(" + "));
    if (keys.length) return keys;
  }

  // 2. 无有效《》：先去掉 URL / 短链 / #标签 再判断主体语言
  const englishCleaned = cleanEnglishForMerge(title);
  const stripped = title
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(BRACKET_TAG_RE, " ")
    .trim();
  const sample = stripped || title;
  const cjkCount = (sample.match(CJK_RE) ?? []).length;
  const latinCount = (sample.match(LATIN_RE) ?? []).length;

  if (cjkCount === 0 || cjkCount / Math.max(cjkCount + latinCount, 1) <= 0.15) {
    const latin = extractLatinKey(englishCleaned) || extractLatinKey(stripped) || extractLatinKey(title);
    push(latin);
    return keys;
  }

  // 3. 中文为主但没有《》：保留中文主体，避免只抽出 "coding plan" / "windows" 误伤不同厂商
  const cn = normalizeCnTitle(title, true) || normalizeCnTitle(title, false);
  if (cn && utf8ByteLength(cn) >= (/[a-z0-9]/i.test(cn) && !HAS_CJK_RE.test(cn) ? 4 : 6)) {
    push(cn);
  }
  return keys;
}

/** 单字符串指纹（写入 items.title_key）。 */
export function mergeKey(title: string): string {
  return extractMergeKeys(title)[0] ?? "";
}

/** 用于无《》中文标题近重复比对的 token 集（ASCII 词 + 中文二元组）。 */
function fuzzyTokens(title: string): Set<string> | null {
  const norm = normalizeCnTitle(title, true);
  if (!norm || norm.length < 4) return null;
  const tokens = new Set<string>();
  for (const w of norm.match(/[a-z0-9]+/g) ?? []) {
    if (w.length >= 2) tokens.add(w);
  }
  const cjk = norm.replace(/[^a-z0-9\u4e00-\u9fff]/g, "").replace(/[a-z0-9]+/g, " ");
  for (const seg of cjk.split(" ")) {
    if (seg.length < 2) continue;
    for (let i = 0; i < seg.length - 1; i += 1) {
      tokens.add(seg.slice(i, i + 2));
    }
  }
  return tokens.size >= 4 ? tokens : null;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let hit = 0;
  for (const t of small) if (large.has(t)) hit += 1;
  if (hit === 0) return 0;
  return hit / (a.size + b.size - hit);
}

export type DedupeEntry = { title: string; urlKey?: string | null };

/**
 * 跨源去重连通器：
 * 在 seed（历史已推/队列中）与 candidates（本轮候选）之间构建等价类，
 * 支持：
 * - 多指纹桥接（如 "Knightica" <-> "《斗阵骑士 Knightica》" <-> "《斗阵骑士》"）
 * - urlKey 相同
 * - 无《》中文标题高相似度（Jaccard >= 0.75）
 */
export class TitleDeduper<T extends DedupeEntry> {
  private parent: number[];
  private seenRoots = new Set<number>();
  private indexByItem = new Map<T, number>();

  constructor(candidates: readonly T[], seeds: readonly DedupeEntry[] = []) {
    const allItems: DedupeEntry[] = [...seeds, ...candidates];
    const n = allItems.length;
    this.parent = Array.from({ length: n }, (_, i) => i);

    const byKey = new Map<string, number>();
    const byUrl = new Map<string, number>();
    const byToken = new Map<string, number[]>();
    const tokensList: (Set<string> | null)[] = new Array(n).fill(null);

    for (let i = 0; i < n; i += 1) {
      const item = allItems[i]!;
      if (i >= seeds.length) {
        this.indexByItem.set(item as T, i);
      }

      if (item.urlKey) {
        const prev = byUrl.get(item.urlKey);
        if (prev !== undefined) this.union(prev, i);
        else byUrl.set(item.urlKey, i);
      }

      for (const k of extractMergeKeys(item.title)) {
        const prev = byKey.get(k);
        if (prev !== undefined) this.union(prev, i);
        else byKey.set(k, i);
      }

      // 仅对含中文且无有效《》的标题补充中文二元组近重复检查
      if (HAS_CJK_RE.test(item.title) && !hasBookTitle(item.title)) {
        const toks = fuzzyTokens(item.title);
        if (toks) {
          tokensList[i] = toks;
          const peerHits = new Map<number, number>();
          for (const t of toks) {
            const list = byToken.get(t);
            if (list) {
              for (const j of list) peerHits.set(j, (peerHits.get(j) ?? 0) + 1);
              list.push(i);
            } else {
              byToken.set(t, [i]);
            }
          }
          for (const [j, shared] of peerHits) {
            if (shared < 3) continue;
            const other = tokensList[j];
            if (other && jaccard(toks, other) >= 0.75) {
              this.union(j, i);
            }
          }
        }
      }
    }

    for (let i = 0; i < seeds.length; i += 1) {
      this.seenRoots.add(this.find(i));
    }
  }

  private find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }

  private union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }

  isDuplicate(item: T): boolean {
    const idx = this.indexByItem.get(item);
    if (idx === undefined) return false;
    return this.seenRoots.has(this.find(idx));
  }

  markSeen(item: T): void {
    const idx = this.indexByItem.get(item);
    if (idx === undefined) return;
    this.seenRoots.add(this.find(idx));
  }
}

export function dedupeByTitle<T extends DedupeEntry>(
  candidates: readonly T[],
  seeds: readonly DedupeEntry[] = [],
): T[] {
  const deduper = new TitleDeduper(candidates, seeds);
  const out: T[] = [];
  for (const item of candidates) {
    if (deduper.isDuplicate(item)) continue;
    deduper.markSeen(item);
    out.push(item);
  }
  return out;
}

import { config } from "../config.ts";
import { normalizeAiProtocol, type AiProtocol } from "../../shared/ai-protocol.ts";
import { requestAiText } from "./ai-client.ts";
import { all, get, run } from "../db.ts";
import type { RawItem } from "../collectors/types.ts";
import { isNoiseTitle } from "./noise.ts";
import { FREEBIE_ONLY_SOURCES } from "./index.ts";
import type { ObtainMode } from "./obtain.ts";
import { isContentKind, type ContentKind } from "./kind.ts";
import { finishAiJob, recordAiBatch, startAiJob } from "./ai-telemetry.ts";

import { CATEGORY_DESC, CATEGORY_KEYS, isCategory, isObtainMode } from "../../shared/taxonomy.ts";
import { CLASSIFICATION_PROMPT } from "./evidence.ts";

export type AiVerdict = {
  index: number;
  keep: boolean;
  /** 内容形态：freebie=白嫖福利 | deal=特价好价 | opensource=开源项目 | info=实用指南 | noise=噪音 */
  kind?: ContentKind;
  category: string;
  reason: string;
  /** 获取方式：AI 判断；缺失时由规则兜底 */
  obtain?: ObtainMode;
  /** 1-5 分质量评估：5=高价值必看/必抢，4=明确好内容，3=普通，2=鸡肋，1=噪音 */
  quality?: number;
  /** 检索用短标签（品牌/平台/品类），不参与频道路由；缺省表示模型没给 */
  tags?: string[];
};

export type AiSourceMode = "all" | "exclude" | "only";

export type AiSettings = {
  /** 总开关：关掉后采集不再自动送审 */
  enabled: boolean;
  /** 协议类型：缺省/空值保持 Chat Completions；response 使用 Responses。 */
  protocol?: AiProtocol;
  /** OpenAI 兼容基础地址，带 /v1，不含 /chat/completions 或 /responses */
  baseUrl: string;
  /** 密钥；界面只显示末四位 */
  apiKey: string;
  /** 模型名 */
  model: string;
  /** 每轮最多送审多少条（20-500） */
  maxItems: number;
  /** 每批发送条数（2-20，默认 6） */
  batchSize: number;
  /** 并发批数（1-8，默认 4） */
  concurrency: number;
  /** 单批请求超时秒数（5-60，默认 15） */
  timeoutSec: number;
  /** 第一道规则初筛开关：开启后自动跳过求助/问价/版本更新等硬噪音，不浪费 AI 额度 */
  preFilterEnabled: boolean;
  /** 用户自定义入口拦截关键词：命中直接跳过送审且不主动直推 */
  customNoiseKeywords: string[];
  /** 纯白嫖专源（Epic/Steam/GamerPower 等）免送 AI，直接视作真福利 */
  skipFreebieSources: boolean;
  /** 送审数据源范围：all 全部 / exclude 排除指定源 / only 仅审指定源 */
  sourceMode: AiSourceMode;
  /** 配合 sourceMode 使用的数据源 ID 列表 */
  sourceIds: string[];
  /** 补充审核规则（追加在系统默认口径后，不破坏 JSON 输出要求） */
  extraPrompt: string;
  /** 高级：完全自定义主提示词；留空用内置默认 */
  systemPrompt: string;
  /** true = 自动从用户收藏（正例）与手动关闭（负例）学习偏好 */
  learnFromFeedback: boolean;
  /** 正负样本各抽取最近几条（1-15，默认 6） */
  feedbackLimit: number;
  /** 是否启用 AI 语义去重（审核入库后 & Telegram 推送前防重复） */
  aiDedupEnabled: boolean;
  /** AI 语义去重对比窗口（小时，6-168，默认 48） */
  aiDedupWindowHours: number;
};

const SETTINGS_KEY = "ai";
const DEFAULT_MAX_ITEMS = 60;

/** 分类清单与说明由 shared/taxonomy.ts 生成，加分类不用再改提示词 */
const CATEGORY_PROMPT_LINE = `分类 category 只能是：${CATEGORY_KEYS.join(" | ")}`;
const CATEGORY_DESC_LINE = `细分类参考：${CATEGORY_KEYS.map((k) => `${k}=${CATEGORY_DESC[k]}`).join("；")}。`;
const DEFAULT_PROMPT = [
  "你是多主题社区与「资源雷达」的内容审核与打标员。任务是过滤低信噪比水帖，并把有价值的内容准确归类到「白嫖福利 / 特价好价 / 开源项目 / 重要新闻 / 行业资讯」，不要把开源项目、黑五特价、合规拼车或高价值重大新闻/经济股票科技资讯误杀成噪音。",
  "",
  "判 keep=true 的五类有效内容（同时标清 kind）：",
  "1. freebie（白嫖福利）：限免游戏/正版软件授权、兑换码/CDK/公益额度/送 Token、免费云主机/域名/GPU/算力/学生包、可照做领到手的白嫖攻略、OpenRouter 新上线 :free 免费模型。",
  "   反例：测评、使用记录、使用感受、选购科普、榜单推荐、横评、抄作业清单都不是 freebie（没有可领取的对象），应标 kind=info；只有真能领到/免费拿到的东西才是 freebie。",
  "   反例补：讨论/抱怨/库存播报（「xx 死绝了吗」「xx 都没货了」「还有吗」「怎么过 xx 认证」）不是 freebie；标题没有链接、活动页或 App 内路径时不要判福利。reason 只能引自原文，原文没写的领取路径一律不许编。",
  "   分类补：免费领实体物品（纪念章/周边/实体书/样品/礼盒/到店赠品）一律 category=offline，不要判 other/goods；绿色版/破解包/免安装版归 category=software，不是 opensource。",
  "2. deal（特价好价/拼车/出鸡）：明确的高性价比付费促销、史低折扣（如黑五/周年庆特价 VPS、年付小鸡、Steam 史低、正版软件买断大促），以及明确标价发车的合规拼车合租（如 ChatGPT/Claude/Netflix 家庭组车位）或明确标价出鸡/转让帖。不要因为需要付钱就拦掉好价与发车。",
  "   硬约束：标题出现「N出 / 溢价N出 / 出 / 收 / 转让 / 过户 / 出号 / 车位 / 合租 / 拼团 / 独享车」等交易意图词，且带价格或付费方式时，kind 必须是 deal，不得判 info（「50出zouter」= 50 元转让 zouter，是 deal 不是资讯）。",
  "3. opensource（开源项目）：必须有明确的 GitHub/GitLab 仓库、源码或可部署的自托管工具、MCP/Agent/Docker 项目发布或推荐。纯科技新闻（无开源仓库/源码发布）不得标为 opensource。",
  "4. news（重要新闻）：仅限央视新闻/中新网/BBC/德国之声等权威新闻媒体的时政要闻、国家政策法规、国务院/部委公告、国际局势、外交峰会与重大民生要闻。来自什么值得买/IT之家/社区的消费导购、电商/品牌八卦或数码资讯不得标为 news（应标 deal 或 info）。",
  "5. info（行业资讯）：经济金融宏观、股票/基金/IPO/财报市场动态、科技大厂/芯片/AI 前沿新闻、硬件数码评测与开发者技术周刊/深度指南。",
  "",
  "判 keep=false（同时 kind='noise'）的噪音（真正无价值的才拦截）：",
  "- 求助/提问/求推荐/求拼车/纯收鸡求购（如「谁有优惠券」「求推荐便宜VPS」「求一个ChatGPT拼车」「收一台RN传家宝」「报错429怎么解决」）",
  "- 语焉不详的代购引流、卖课或推广软广（尤其注意标题看似免费/白嫖，但正文或末尾要求加微/私信/评论区扣1/关注领/返利链接/付费解锁才给的标题党）",
  "- 毫无亮点的游戏常规微调补丁说明（如「修复若干闪退」，且本体仍需原价购买）",
  "- 八卦吐槽、吵架引战水贴、纯感慨/讨论帖（如「怎么看待白嫖」「如何评价…」）或无实际可领路径的空泛软文",
  "- 毫无折扣亮点的普通原价推广",
  "",
  CATEGORY_PROMPT_LINE,
  CATEGORY_DESC_LINE,
  "同时判断「获取方式」obtain，只能是：",
  "- free：点开即可直接免费拿或开源免费用，不需抽签/付费",
  "- conditional：需注册、实名、填表、签到攒积分、回复或新用户条件才可领",
  "- lottery：抽奖/拼手气/随机送",
  "- lottery 的判定：标题含 Sweepstakes / Winners / 抽奖 / 抽选 / 摇号 / 赢取 一律 obtain=lottery 且 category=lottery，不要标 free；Steam/Epic 的 Giveaway 是免费领游戏，仍标 free。",
  "- trial：商业 SaaS 短期试用，到期不付钱即停用",
  "- promo：纯商业引流钩子",
  "- paid：需实际付费购买（如黑五特价 VPS、史低游戏、买断软件）",
  "",
  "同时给出 1-5 的 quality 质量评分：5=极高价值（3A喜加一/神价黑五VPS/爆款开源/大额Token/重大央媒头条），4=明确好内容（新:free模型/高性价比年付鸡/实用开源工具/重要财经科技资讯），3=一般或有条件，2=限制极多/鸡肋，1=噪音。",
  '按 JSON 数组返回，元素形如 {"index":0,"keep":true,"kind":"deal","category":"vps","obtain":"paid","quality":5,"reason":"黑五特价 $10.99/年 KVM VPS"}。',
  "reason 用一句不超过 20 字的中文说清亮点或拦截原因，不要输出多余文本。",
].join("\n");

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: Boolean(config.aiBaseUrl && config.aiModel),
  protocol: normalizeAiProtocol(config.aiProtocol),
  baseUrl: config.aiBaseUrl,
  apiKey: config.aiApiKey,
  model: config.aiModel,
  maxItems: Math.min(Math.max(config.aiMaxItems, 20), 500),
  batchSize: 6,
  concurrency: 4,
  timeoutSec: 15,
  preFilterEnabled: true,
  customNoiseKeywords: [],
  skipFreebieSources: false,
  sourceMode: "all",
  sourceIds: [],
  extraPrompt: "",
  systemPrompt: "",
  learnFromFeedback: true,
  feedbackLimit: 6,
  aiDedupEnabled: true,
  aiDedupWindowHours: 48,
};

function numOr(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function normalizeStringList(v: unknown, maxLen = 40, maxCount = 80): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(
      v
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().slice(0, maxLen))
        .filter(Boolean),
    ),
  ].slice(0, maxCount);
}

function normalizeSourceMode(v: unknown): AiSourceMode {
  return v === "exclude" || v === "only" ? v : "all";
}

function normalizeSettings(raw: Partial<AiSettings>, base: AiSettings): AiSettings {
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    protocol: normalizeAiProtocol(raw.protocol ?? base.protocol),
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : base.baseUrl,
    apiKey:
      typeof raw.apiKey === "string" && raw.apiKey.trim() && !raw.apiKey.startsWith("••••")
        ? raw.apiKey.trim()
        : base.apiKey,
    model: typeof raw.model === "string" ? raw.model.trim() : base.model,
    maxItems: numOr(raw.maxItems, base.maxItems, 20, 500),
    batchSize: numOr(raw.batchSize, base.batchSize, 2, 20),
    concurrency: numOr(raw.concurrency, base.concurrency, 1, 8),
    timeoutSec: numOr(raw.timeoutSec, base.timeoutSec, 5, 60),
    preFilterEnabled: typeof raw.preFilterEnabled === "boolean" ? raw.preFilterEnabled : base.preFilterEnabled,
    customNoiseKeywords: "customNoiseKeywords" in raw ? normalizeStringList(raw.customNoiseKeywords) : base.customNoiseKeywords,
    skipFreebieSources: typeof raw.skipFreebieSources === "boolean" ? raw.skipFreebieSources : base.skipFreebieSources,
    sourceMode: "sourceMode" in raw ? normalizeSourceMode(raw.sourceMode) : base.sourceMode,
    sourceIds: "sourceIds" in raw ? normalizeStringList(raw.sourceIds, 60, 200) : base.sourceIds,
    extraPrompt: typeof raw.extraPrompt === "string" ? raw.extraPrompt : base.extraPrompt,
    systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt : base.systemPrompt,
    learnFromFeedback: typeof raw.learnFromFeedback === "boolean" ? raw.learnFromFeedback : base.learnFromFeedback,
    feedbackLimit: numOr(raw.feedbackLimit, base.feedbackLimit, 1, 15),
    aiDedupEnabled: typeof raw.aiDedupEnabled === "boolean" ? raw.aiDedupEnabled : base.aiDedupEnabled,
    aiDedupWindowHours: numOr(raw.aiDedupWindowHours, base.aiDedupWindowHours, 6, 168),
  };
}

/** AI 标签只做检索辅助：非法、超长、重复一律丢掉，绝不影响这条内容的分类判定。 */
export const AI_TAG_MAX = 4;
export const AI_TAG_MAX_LEN = 16;

export function normalizeAiTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.trim().replace(/^#+/, "").replace(/\s+/g, " ");
    if (!tag || tag.length > AI_TAG_MAX_LEN) continue;
    if (out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= AI_TAG_MAX) break;
  }
  return out;
}

export function getAiSettings(): AiSettings {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", SETTINGS_KEY);
  if (!row) return { ...DEFAULT_AI_SETTINGS };
  try {
    const raw = JSON.parse(row.value) as Partial<AiSettings>;
    return normalizeSettings(raw, DEFAULT_AI_SETTINGS);
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(patch: Partial<AiSettings>): AiSettings {
  const cur = getAiSettings();
  const next = normalizeSettings(patch, cur);
  run(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    SETTINGS_KEY,
    JSON.stringify(next),
    new Date().toISOString(),
  );
  return next;
}

/** 运行时是否真的能调 AI（开关开、端点与模型都有）。 */
export function aiReady(s = getAiSettings()): boolean {
  return s.enabled && Boolean(s.baseUrl && s.model);
}

/** 是否命中入口噪音初筛（求助/问价/版本更新补丁 + 用户自定义噪音词）。 */
export function matchesEntryNoise(title: string, s = getAiSettings()): boolean {
  if (!s.preFilterEnabled) return false;
  if (isNoiseTitle(title)) return true;
  if (s.customNoiseKeywords.length) {
    const lower = title.toLowerCase();
    if (s.customNoiseKeywords.some((kw) => lower.includes(kw.toLowerCase()))) return true;
  }
  return false;
}

/** 该数据源是否需要送入 AI 审核。返回 false 且非噪音时，纯白嫖源可视作自动通过。 */
export function shouldPassSourceToAi(sourceId: string, s = getAiSettings()): boolean {
  if (s.skipFreebieSources && FREEBIE_ONLY_SOURCES.has(sourceId)) return false;
  if (s.sourceMode === "exclude" && s.sourceIds.includes(sourceId)) return false;
  if (s.sourceMode === "only" && !s.sourceIds.includes(sourceId)) return false;
  return true;
}

export function feedbackStats(limit = 6): {
  positive: number;
  negative: number;
  positiveSamples: string[];
  negativeSamples: string[];
} {
  const n = Math.min(Math.max(Math.round(limit), 1), 15);
  try {
    const pos = get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE starred = 1")?.n ?? 0;
    const neg = get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE status = 'ignored'")?.n ?? 0;
    const positiveSamples = all<{ title: string }>(
      "SELECT title FROM items WHERE starred = 1 ORDER BY last_seen_at DESC LIMIT ?",
      n,
    ).map((r) => r.title.slice(0, 80));
    const negativeSamples = all<{ title: string }>(
      "SELECT title FROM items WHERE status = 'ignored' ORDER BY last_seen_at DESC LIMIT ?",
      n,
    ).map((r) => r.title.slice(0, 80));
    return { positive: pos, negative: neg, positiveSamples, negativeSamples };
  } catch {
    return { positive: 0, negative: 0, positiveSamples: [], negativeSamples: [] };
  }
}

/** 给前端的安全视图：密钥打码。 */
export function publicAiSettings(s = getAiSettings()) {
  return {
    apiKey: "",
    enabled: s.enabled,
    protocol: normalizeAiProtocol(s.protocol),
    baseUrl: s.baseUrl,
    model: s.model,
    maxItems: s.maxItems,
    batchSize: s.batchSize,
    concurrency: s.concurrency,
    timeoutSec: s.timeoutSec,
    preFilterEnabled: s.preFilterEnabled,
    customNoiseKeywords: s.customNoiseKeywords,
    skipFreebieSources: s.skipFreebieSources,
    sourceMode: s.sourceMode,
    sourceIds: s.sourceIds,
    extraPrompt: s.extraPrompt,
    systemPrompt: s.systemPrompt,
    learnFromFeedback: s.learnFromFeedback,
    feedbackLimit: s.feedbackLimit,
    aiDedupEnabled: s.aiDedupEnabled,
    aiDedupWindowHours: s.aiDedupWindowHours,
    hasKey: Boolean(s.apiKey),
    keyHint: s.apiKey ? "••••" + s.apiKey.slice(-4) : "",
    ready: aiReady(s),
    promptIsDefault: !s.systemPrompt.trim(),
    defaultPrompt: DEFAULT_PROMPT,
  };
}

function buildSystemPrompt(s: AiSettings): string {
  const custom = s.systemPrompt.trim();
  const parts: string[] = [custom || DEFAULT_PROMPT];
  // 自定义/云端 system prompt 也要补分类清单，否则模型不知道 category 能取哪些值
  if (custom) parts.push("", CATEGORY_PROMPT_LINE, CATEGORY_DESC_LINE);
  if (s.extraPrompt.trim()) {
    parts.push("", "补充审核规则（务必优先遵守）：", s.extraPrompt.trim());
  }
  parts.push("", CLASSIFICATION_PROMPT);
  if (!s.learnFromFeedback) return parts.join("\n");
  try {
    const fb = feedbackStats(s.feedbackLimit);
    if (!fb.positiveSamples.length && !fb.negativeSamples.length) return parts.join("\n");
    parts.push("", "以下来自用户近期真实操作（优先贴合这些偏好）：");
    if (fb.positiveSamples.length) {
      parts.push("用户收藏的正样本（类似应判 keep=true）：" + fb.positiveSamples.map((t) => `「${t}」`).join("、"));
    }
    if (fb.negativeSamples.length) {
      parts.push("用户手动关闭的负样本（类似应判 keep=false）：" + fb.negativeSamples.map((t) => `「${t}」`).join("、"));
    }
  } catch {
    /* ignore */
  }
  return parts.join("\n");
}

type CallResult = { map: Map<number, AiVerdict>; ttfbMs: number };

async function callOnce(
  payload: { index: number; title: string; summary: string }[],
  s: AiSettings,
): Promise<CallResult> {
  const timeoutMs = s.timeoutSec * 1000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  const tag = `[ai] batch n=${payload.length} idx=${payload[0]?.index ?? "-"}`;
  try {
    const { content, ttfbMs: ttfb } = await requestAiText(
      s,
      { system: buildSystemPrompt(s), user: JSON.stringify(payload) },
      { signal: ac.signal },
    );
    console.log(`${tag} 完成 ${Date.now() - t0}ms（响应头 ${ttfb}ms）`);
    const jsonText = /\[[\s\S]*\]/.exec(content)?.[0];
    if (!jsonText) throw new Error("AI 未返回 JSON 数组");
    const arr: unknown = JSON.parse(jsonText);
    if (!Array.isArray(arr) || arr.length !== payload.length) throw new Error("AI 返回条数与送审条数不匹配");
    const expectedIndexes = new Set(payload.map((item) => item.index));
    const map = new Map<number, AiVerdict>();
    let invalidCount = 0;
    // 不信任 JSON 的类型和索引：字符串 false 会被当成通过，串批索引会覆盖其他资源。
    for (const raw of arr) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AI 结论必须是对象");
      const v = raw as Partial<AiVerdict>;
      if (typeof v.index !== "number" || !Number.isInteger(v.index) || !expectedIndexes.has(v.index) || map.has(v.index)) {
        throw new Error("AI 结论索引缺失、重复或不属于当前批次");
      }
      // 单条字段非法只丢这一条：整批重试会把另外 19 条正确结论一起作废，
      // 而 category/kind 越界多半来自个别幻觉（模型给出枚举外的分类）。
      // 索引错位仍然是整批失败——那会把结论张冠李戴到别的资源上。
      const invalid =
        typeof v.keep !== "boolean" || !isCategory(v.category) || typeof v.reason !== "string" ||
        (v.kind !== undefined && !isContentKind(v.kind)) ||
        (v.obtain !== undefined && !isObtainMode(v.obtain)) ||
        (v.quality !== undefined && (typeof v.quality !== "number" || !Number.isFinite(v.quality) || v.quality < 1 || v.quality > 5));
      if (invalid) {
        invalidCount += 1;
        console.warn(`${tag} 丢弃无效结论 index=${v.index} category=${String(v.category)}`);
        continue;
      }
      // tags 是辅助字段：非法就清空，不因为它把一条正确结论丢掉
      (v as AiVerdict).tags = normalizeAiTags(v.tags);
      map.set(v.index, v as AiVerdict);
    }
    // 整批都没给出合法结论时仍当作失败，避免把「模型跑偏」记成「全部未审通过」
    if (!map.size && payload.length > 0) throw new Error("AI 结论全部无效（keep/category/reason/kind/obtain/quality）");
    return { map, ttfbMs: ttfb };
  } finally {
    clearTimeout(timer);
  }
}

export type ReviewBatchEvent = {
  start: number;
  count: number;
  items: RawItem[];
  verdicts: Map<number, AiVerdict> | null;
  ttfbMs: number | null;
  error?: string;
};

function aiSummaryExcerpt(it: { summary?: string | null; content?: string | null }): string {
  const raw = (it.content || it.summary || "").replace(/\s+/g, " ").trim();
  if (raw.length <= 420) return raw;
  return `${raw.slice(0, 240)} … ${raw.slice(-170)}`;
}

/**
 * 送审并返回 index → verdict 的映射。未启用或全部失败返回 null。
 * 条目多于 maxItems 时按 maxItems 截断送审，按 batchSize / concurrency 并发执行。
 */
export async function reviewItems(
  items: RawItem[],
  settings?: AiSettings,
  hooks?: { onBatch?: (ev: ReviewBatchEvent) => void },
): Promise<Map<number, AiVerdict> | null> {
  const s = settings ?? getAiSettings();
  if (!aiReady(s) || !items.length) return null;

  const total = Math.min(items.length, s.maxItems);
  const merged = new Map<number, AiVerdict>();
  let ok = 0;

  type Job = { start: number; chunk: RawItem[]; payload: { index: number; title: string; summary: string }[] };
  const jobs: Job[] = [];
  for (let start = 0; start < total; start += s.batchSize) {
    const chunk = items.slice(start, Math.min(start + s.batchSize, total));
    jobs.push({
      start,
      chunk,
      payload: chunk.map((it, i) => ({
        index: start + i,
        title: (it.title ?? "").slice(0, 140),
        summary: aiSummaryExcerpt(it),
      })),
    });
  }

  const runJob = async (job: Job): Promise<CallResult | null> => {
    let lastErr: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await callOnce(job.payload, s);
        hooks?.onBatch?.({
          start: job.start,
          count: job.chunk.length,
          items: job.chunk,
          verdicts: res.map,
          ttfbMs: res.ttfbMs,
        });
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastErr = msg;
        if (attempt === 0) {
          console.log(`[ai] 重试 n=${job.payload.length} idx=${job.start}：${msg.slice(0, 60)}`);
          continue;
        }
        console.log(`[ai] 放弃 n=${job.payload.length} idx=${job.start}：${msg.slice(0, 60)}`);
      }
    }
    hooks?.onBatch?.({
      start: job.start,
      count: job.chunk.length,
      items: job.chunk,
      verdicts: null,
      ttfbMs: null,
      error: lastErr,
    });
    return null;
  };

  for (let i = 0; i < jobs.length; i += s.concurrency) {
    const wave = jobs.slice(i, i + s.concurrency);
    const results = await Promise.all(wave.map(runJob));
    for (const res of results) {
      if (!res) continue;
      for (const [k, v] of res.map) merged.set(k, v);
      ok += 1;
    }
  }

  return ok > 0 ? merged : null;
}

/** 连通性测试：支持传入表单草稿直接测试（无需先保存），返回完整判定维度与耗时。 */
export async function testAiConnection(draft?: Partial<AiSettings>): Promise<{
  ok: boolean;
  ms: number;
  model: string;
  results: { title: string; keep: boolean; kind: string; category: string; obtain: string; quality: number | null; reason: string }[];
  error?: string;
}> {
  const cur = getAiSettings();
  const s: AiSettings = {
    ...normalizeSettings(draft ?? {}, cur),
    enabled: true, // 测试接口允许在开启总开关前先验证连通性
  };
  if (!s.baseUrl || !s.model) {
    return { ok: false, ms: 0, model: s.model, results: [], error: "请先填写 API 端点与模型名" };
  }

  const samples: RawItem[] = [
    { externalId: "t1", url: "https://example.com/1", title: "【福利】送 5 个 500M 动态IP测试，先到先得", summary: "回复即可" },
    { externalId: "t2", url: "https://example.com/2", title: "[黑五特惠] RackNerd 2核2G KVM VPS 年付 $10.99", summary: "黑五促销" },
    { externalId: "t3", url: "https://example.com/3", title: "开源自托管轻量状态监控面板 v2.1 发布 (Docker/MIT)", summary: "GitHub 开源" },
    { externalId: "t4", url: "https://example.com/4", title: "谁有 ovh 年付 10% 优惠券哇", summary: "求优惠券" },
  ] as RawItem[];

  const t0 = Date.now();
  const jobId = startAiJob({
    stage: "test",
    label: "草稿配置连通测试",
    model: s.model,
    total: samples.length,
    totalBatches: Math.ceil(samples.length / s.batchSize),
  });
  try {
    const map = await reviewItems(samples, s, {
      onBatch: (ev) => {
        let kept = 0;
        let rejected = 0;
        const events = [];
        for (let i = 0; i < ev.items.length; i += 1) {
          const v = ev.verdicts?.get(ev.start + i);
          if (!v) continue;
          const keep = Boolean(v.keep);
          if (keep) kept += 1;
          else rejected += 1;
          events.push({
            title: ev.items[i]!.title,
            keep,
            kind: isContentKind(v.kind) ? v.kind : keep ? "freebie" : "noise",
            category: v.category ?? "-",
            quality: typeof v.quality === "number" ? v.quality : null,
            reason: v.reason ?? "",
            at: new Date().toISOString(),
          });
        }
        recordAiBatch(jobId, {
          events,
          kept,
          rejected,
          failed: ev.verdicts ? 0 : ev.count,
          ttfbMs: ev.ttfbMs,
        });
      },
    });
    const ms = Date.now() - t0;
    if (!map) {
      finishAiJob(jobId, { error: "模型未返回有效结论" });
      return { ok: false, ms, model: s.model, results: [], error: "模型未返回有效结论（请检查端点/Key/模型名或超时设置）" };
    }
    finishAiJob(jobId);
    return {
      ok: true,
      ms,
      model: s.model,
      results: samples.map((it, i) => {
        const v = map.get(i);
        const keep = v?.keep ?? false;
        const kind = isContentKind(v?.kind) ? v.kind : keep ? "freebie" : "noise";
        return {
          title: it.title,
          keep,
          kind,
          category: v?.category ?? "-",
          obtain: v?.obtain ?? "-",
          quality: typeof v?.quality === "number" ? v.quality : null,
          reason: v?.reason ?? "（无结论）",
        };
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishAiJob(jobId, { error: msg });
    return {
      ok: false,
      ms: Date.now() - t0,
      model: s.model,
      results: [],
      error: msg,
    };
  }
}

export { DEFAULT_PROMPT };

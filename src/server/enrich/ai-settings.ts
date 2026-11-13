import { config } from "../config.ts";
import { all, get, run } from "../db.ts";
import type { RawItem } from "../collectors/types.ts";
import { NOISE_TITLE } from "./noise.ts";
import { FREEBIE_ONLY_SOURCES } from "./index.ts";
import type { ObtainMode } from "./obtain.ts";

export type AiVerdict = {
  index: number;
  keep: boolean;
  category: string;
  reason: string;
  /** 获取方式：AI 判断；缺失时由规则兜底 */
  obtain?: ObtainMode;
  /** 1-5 分质量评估：5=高价值必抢，4=明确好福利，3=普通，2=鸡肋，1=非福利 */
  quality?: number;
};

export type AiSourceMode = "all" | "exclude" | "only";

export type AiSettings = {
  /** 总开关：关掉后采集不再自动送审 */
  enabled: boolean;
  /** OpenAI 兼容端点，带 /v1 */
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
};

const SETTINGS_KEY = "ai";
const DEFAULT_MAX_ITEMS = 60;

const DEFAULT_PROMPT = [
  "你是福利信息审核员。判断每一条是否值得推送给用户，用户只想要「现在动手就能拿到手、而且过了这村没这店」的东西。",
  "",
  "两条硬性前提，缺一条就判 keep=false：",
  "① 这条内容本身是「领取入口/活动公告」——点进去就能操作领取，而不是一篇介绍、报道、推荐某样东西的文章。",
  "② 拿到的东西是「限时/限量/需要抢」的——不是长期存在、人人随时都能免费用的东西。",
  "",
  "判 keep=true 的条件（必须满足其一，且能明确说出拿了什么）：",
  "- 限时免费/喜加一：Epic 本周免费游戏、Steam 限免、某软件 24 小时免费领授权",
  "- 有数量或有条件限制的赠送：送 N 个、抽 N 份、兑换码/邀请码/激活码、回帖领",
  "- 注册/登录后可领的权益：会员天数、额度、体验金、学生包（需要去申请的那种）",
  "- 新上线免费 AI 模型/API（如「OpenRouter 新增免费模型 :free」「某平台新开放免费大模型 API/额度」，属于刚放出的可用福利）",
  "- 开发者/大厂/AI 平台限时活动：报名或填表即可领积分、算力券、代金券、Token（如「报名领每日 1000 积分」「Skill/黑客松活动领 CodeArts 额度」）",
  "- 限时开放注册、限时免费申请的云资源包",
  "",
  "判 keep=false 的情况（这里从严，拿不准就判 false）：",
  "- 【重点】介绍/推荐某个免费工具、免费网站、开源项目、插件，即使它真的免费可用。",
  "  例：「XX最火的免费插件：对话不要钱了」「GitHub 上有个插件装了就能免费用 XX」→ false",
  "  理由：这是资讯/导购文，东西是长期免费的，不是福利；用户随时都能搜到，推给他没有价值。",
  "- 【重点】盘点、榜单、合集、最强推荐、实测、评测、对比、使用心得这类内容形态",
  "- 新闻、资讯、政策解读、行业报告、公司财报",
  "- 软件/游戏免费更新或补丁说明（如「某游戏免费更新屠戮模式/新地图」「版本更新公告」——本体仍需购买，仅现有玩家内容更新）",
  "- 求助/提问/求推荐/求优惠券（谁有 XX 优惠券、求推荐便宜 VPS）",
  "- 纯讨论、吐槽、比价心得",
  "- 二手交易、账号共享、盗版",
  "- 只是打折/降价但需要实付钱，除非到手价 ≤ 5 元",
  "- 广告推广自家有偿服务；会员专享免费（必须先买会员才能用）",
  "- 长期免费的基础服务（免费额度、免费版套餐、开源软件本身）",
  "",
  "自查一句：如果用户的反应是「这我早知道了 / 这不随时都有吗」，就判 false。",
  "",
  "分类只能是：ai | cloud | domain | opensource | software | media | game | goods | invite | edu | other",
  "opensource 是开源项目/自建工具/awesome 清单这类一直免费的（注意：这类基本都判 keep=false）；software 是限时免费的商业软件授权（激活码、正版序列号）。",
  "",
  "同时判断「获取方式」obtain，只能是：",
  "- free：点开就能直接领，不需要付出任何行动",
  "- conditional：要回帖、盖楼、转发、关注、邀请好友、实名或绑卡才能拿",
  "- lottery：抽名额/开奖/随机送，不一定轮到你",
  "- trial：免费试用 N 天或首月免费，到期要付费",
  "- promo：本质是商家推广自家付费服务，福利只是引流钩子",
  "- paid：要实付钱才拿得到",
  "注意：「免费体验我们的服务」「注册送体验金但充值才用」这类算 trial 或 promo；而官方活动只需简单报名/填表就能领到每日积分或算力（无须拉人头/转发/抽奖/绑卡付费）算 free。",
  "",
  "同时给出 1-5 的 quality 质量评分：5=高价值直接免费（3A喜加一/大额Token/直接兑换码），4=明确好福利（新上线:free模型/每日积分/正版软件限免），3=一般小福利或有条件领取，2=限制极多/鸡肋，1=非福利。",
  '按 JSON 数组返回，元素形如 {"index":0,"keep":true,"category":"game","obtain":"free","quality":5,"reason":"Epic 本周免费游戏"}。',
  "reason 用一句不超过 20 字的中文，keep=true 说清「能拿到什么」，keep=false 说清「为什么不是福利」，不要输出多余文本。",
].join("\n");

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: Boolean(config.aiBaseUrl && config.aiModel),
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
  };
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
  if (NOISE_TITLE.test(title)) return true;
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
    hasKey: Boolean(s.apiKey),
    keyHint: s.apiKey ? "••••" + s.apiKey.slice(-4) : "",
    ready: aiReady(s),
    promptIsDefault: !s.systemPrompt.trim(),
    defaultPrompt: DEFAULT_PROMPT,
  };
}

function buildSystemPrompt(s: AiSettings): string {
  const parts: string[] = [s.systemPrompt.trim() || DEFAULT_PROMPT];
  if (s.extraPrompt.trim()) {
    parts.push("", "补充审核规则（务必优先遵守）：", s.extraPrompt.trim());
  }
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

async function callOnce(
  payload: { index: number; title: string; summary: string }[],
  s: AiSettings,
): Promise<Map<number, AiVerdict> | null> {
  const endpoint = s.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const timeoutMs = s.timeoutSec * 1000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  const tag = `[ai] batch n=${payload.length} idx=${payload[0]?.index ?? "-"}`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(s.apiKey ? { authorization: "Bearer " + s.apiKey } : {}),
      },
      body: JSON.stringify({
        model: s.model,
        temperature: 0,
        messages: [
          { role: "system", content: buildSystemPrompt(s) },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      signal: ac.signal,
    });
    const ttfb = Date.now() - t0;
    if (!res.ok) throw new Error("AI HTTP " + res.status + " " + (await res.text()).slice(0, 120));
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    console.log(`${tag} 完成 ${Date.now() - t0}ms（响应头 ${ttfb}ms）`);
    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonText = /\[[\s\S]*\]/.exec(content)?.[0];
    if (!jsonText) throw new Error("AI 未返回 JSON 数组");
    const arr = JSON.parse(jsonText) as AiVerdict[];
    const map = new Map<number, AiVerdict>();
    for (const v of arr) {
      if (typeof v?.index === "number") map.set(v.index, v);
    }
    return map;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 送审并返回 index → verdict 的映射。未启用或全部失败返回 null。
 * 条目多于 maxItems 时按 maxItems 截断送审，按 batchSize / concurrency 并发执行。
 */
export async function reviewItems(items: RawItem[], settings?: AiSettings): Promise<Map<number, AiVerdict> | null> {
  const s = settings ?? getAiSettings();
  if (!aiReady(s) || !items.length) return null;

  const total = Math.min(items.length, s.maxItems);
  const merged = new Map<number, AiVerdict>();
  let ok = 0;

  type Job = { start: number; payload: { index: number; title: string; summary: string }[] };
  const jobs: Job[] = [];
  for (let start = 0; start < total; start += s.batchSize) {
    const chunk = items.slice(start, Math.min(start + s.batchSize, total));
    jobs.push({
      start,
      payload: chunk.map((it, i) => ({
        index: start + i,
        title: (it.title ?? "").slice(0, 140),
        summary: (it.summary ?? "").slice(0, 200),
      })),
    });
  }

  const runJob = async (job: Job): Promise<Map<number, AiVerdict> | null> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await callOnce(job.payload, s);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0) {
          console.log(`[ai] 重试 n=${job.payload.length} idx=${job.start}：${msg.slice(0, 60)}`);
          continue;
        }
        console.log(`[ai] 放弃 n=${job.payload.length} idx=${job.start}：${msg.slice(0, 60)}`);
      }
    }
    return null;
  };

  for (let i = 0; i < jobs.length; i += s.concurrency) {
    const wave = jobs.slice(i, i + s.concurrency);
    const results = await Promise.all(wave.map(runJob));
    for (const map of results) {
      if (!map) continue;
      for (const [k, v] of map) merged.set(k, v);
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
  results: { title: string; keep: boolean; category: string; obtain: string; quality: number | null; reason: string }[];
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
    { externalId: "t2", url: "https://example.com/2", title: "88% 受访开发者点头赞成：FreeBSD 组建工作组制定 AI 使用新规", summary: "行业新闻" },
    { externalId: "t3", url: "https://example.com/3", title: "谁有 ovh 年付 10% 优惠券哇", summary: "求优惠券" },
  ] as RawItem[];

  const t0 = Date.now();
  try {
    const map = await reviewItems(samples, s);
    const ms = Date.now() - t0;
    if (!map) return { ok: false, ms, model: s.model, results: [], error: "模型未返回有效结论（请检查端点/Key/模型名或超时设置）" };
    return {
      ok: true,
      ms,
      model: s.model,
      results: samples.map((it, i) => {
        const v = map.get(i);
        return {
          title: it.title,
          keep: v?.keep ?? false,
          category: v?.category ?? "-",
          obtain: v?.obtain ?? "-",
          quality: typeof v?.quality === "number" ? v.quality : null,
          reason: v?.reason ?? "（无结论）",
        };
      }),
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - t0,
      model: s.model,
      results: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export { DEFAULT_PROMPT };

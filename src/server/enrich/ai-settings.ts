import { config } from "../config.ts";
import { all, get, run } from "../db.ts";
import type { RawItem } from "../collectors/types.ts";
import { NOISE_TITLE } from "./noise.ts";
import { FREEBIE_ONLY_SOURCES } from "./index.ts";
import type { ObtainMode } from "./obtain.ts";
import { isContentKind, type ContentKind } from "./kind.ts";
import { finishAiJob, recordAiBatch, startAiJob } from "./ai-telemetry.ts";

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
  "你是多主题社区与「资源雷达」的内容审核与打标员。任务是过滤低信噪比水帖，并把有价值的内容准确归类到「白嫖福利 / 特价好价 / 开源项目 / 重要新闻 / 行业资讯」，不要把开源项目、黑五特价、合规拼车或高价值重大新闻/经济股票科技资讯误杀成噪音。",
  "",
  "判 keep=true 的五类有效内容（同时标清 kind）：",
  "1. freebie（白嫖福利）：限免游戏/正版软件授权、兑换码/CDK/公益额度/送 Token、免费云主机/域名/GPU/算力/学生包、可照做领到手的白嫖攻略、OpenRouter 新上线 :free 免费模型。",
  "2. deal（特价好价/拼车/出鸡）：明确的高性价比付费促销、史低折扣（如黑五/周年庆特价 VPS、年付小鸡、Steam 史低、正版软件买断大促），以及明确标价发车的合规拼车合租（如 ChatGPT/Claude/Netflix 家庭组车位）或明确标价出鸡/转让帖。不要因为需要付钱就拦掉好价与发车。",
  "3. opensource（开源项目）：必须有明确的 GitHub/GitLab 仓库、源码或可部署的自托管工具、MCP/Agent/Docker 项目发布或推荐。纯科技新闻（无开源仓库/源码发布）不得标为 opensource。",
  "4. news（重要新闻）：央视新闻等权威渠道的时政要闻、国家政策法规、国务院/部委公告、国际局势、外交峰会、重大社会民生与突发要闻。",
  "5. info（行业资讯）：经济金融宏观、股票/基金/IPO/财报市场动态、科技大厂/芯片/AI 前沿新闻、硬件数码评测与开发者技术周刊/深度指南。",
  "",
  "判 keep=false（同时 kind='noise'）的噪音（真正无价值的才拦截）：",
  "- 求助/提问/求推荐/求拼车/纯收鸡求购（如「谁有优惠券」「求推荐便宜VPS」「求一个ChatGPT拼车」「收一台RN传家宝」「报错429怎么解决」）",
  "- 语焉不详的代购引流或纯硬广卖课",
  "- 毫无亮点的游戏常规微调补丁说明（如「修复若干闪退」，且本体仍需原价购买）",
  "- 八卦吐槽、吵架引战水贴、无实质内容的标题党软文",
  "- 毫无折扣亮点的普通原价推广",
  "",
  "分类 category 只能是：ai | cloud | vps | domain | opensource | software | dev | design | security | hardware | media | game | carpool | trade | headline | world | finance | stock | tech | news | goods | invite | edu | other",
  "细分类参考：vps=独立服务器/VPS/小鸡/现车；cloud=云额度/对象存储/CDN/代理流量；dev=开发框架/CLI/SDK/插件；design=字体/图标/UI模板/素材；security=安全漏洞/VPN/隐私工具；hardware=硬件/路由器/NAS/数码；carpool=拼车合租车位；trade=明盘出鸡/账号转让；headline=国内时政/政策法规/民生要闻；world=国际局势/外交/海外要闻；finance=宏观经济/金融货币/商业并购/投融资；stock=A股/港股/美股/ETF/财报/IPO/股票市场；tech=科技前沿/芯片/互联网/航天/新能源；news=综合资讯快讯；goods=生活羊毛/话费红包/优惠券/实物；edu=课程/电子书/有声书。",
  "",
  "同时判断「获取方式」obtain，只能是：",
  "- free：点开即可直接免费拿或开源免费用，不需抽签/付费",
  "- conditional：需注册、实名、填表、签到攒积分、回复或新用户条件才可领",
  "- lottery：抽奖/拼手气/随机送",
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

type CallResult = { map: Map<number, AiVerdict>; ttfbMs: number };

async function callOnce(
  payload: { index: number; title: string; summary: string }[],
  s: AiSettings,
): Promise<CallResult> {
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
        summary: (it.summary ?? "").slice(0, 200),
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

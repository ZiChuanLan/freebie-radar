import { config } from "../config.ts";
import { get, run } from "../db.ts";
import type { RawItem } from "../collectors/types.ts";

import type { ObtainMode } from "./obtain.ts";

export type AiVerdict = {
  index: number;
  keep: boolean;
  category: string;
  reason: string;
  /** 获取方式：AI 判断；缺失时由规则兜底 */
  obtain?: ObtainMode;
};

export type AiSettings = {
  /** 总开关：关掉后采集不再自动送审 */
  enabled: boolean;
  /** OpenAI 兼容端点，带 /v1 */
  baseUrl: string;
  /** 密钥；界面只显示末四位 */
  apiKey: string;
  /** 模型名 */
  model: string;
  /** 每轮最多送审多少条（按 20 条一批切分） */
  maxItems: number;
  /** 自定义提示词；留空用内置 */
  systemPrompt: string;
};

const SETTINGS_KEY = "ai";
const DEFAULT_MAX_ITEMS = 60;
const BATCH = 20;

const DEFAULT_PROMPT = [
  "你是福利信息审核员。给定一组帖子标题与摘要，判断每一条是否真的是「现在就能拿到手」的免费资源或权益。",
  "",
  "判 keep=true 的条件（必须满足其一，且能明确说出拿了什么）：",
  "- 可以直接领取/下载的免费软件、游戏喜加一、限时免费（0 元或 100% off）",
  "- 注册/登录后就能拿到的额度、体验金、会员天数、试用",
  "- 有明确数量的赠送（送 N 个、抽 N 份）、兑换码/邀请码/激活码",
  "- 限时开放注册、免费申请的教育/云服务资源包",
  "",
  "判 keep=false 的情况：",
  "- 新闻、资讯、政策解读、行业报告（例：某组织制定 AI 使用新规、某公司发布财报）",
  "- 求助/提问/求推荐/求优惠券（例：谁有 XX 优惠券、求推荐便宜 VPS）",
  "- 纯讨论、吐槽、测评、比价心得",
  "- 二手交易、账号共享、盗版",
  "- 只是「打折/降价/优惠」但需要实付钱的，除非价格 ≤ 5 元",
  "- 广告推广自己有偿服务",
  "",
  "分类只能是：ai | cloud | domain | software | media | game | goods | invite | edu | other",
  "",
  "同时判断「获取方式」obtain，只能是：",
  "- free：点开就能直接领，不需要付出任何行动",
  "- conditional：要回帖、盖楼、转发、关注、邀请好友、实名或绑卡才能拿",
  "- lottery：抽名额/开奖/随机送，不一定轮到你",
  "- trial：免费试用 N 天或首月免费，到期要付费",
  "- promo：本质是商家推广自家付费服务，福利只是引流钩子",
  "- paid：要实付钱才拿得到",
  "注意：「免费体验我们的服务」「注册送体验金但充值才用」这类算 trial 或 promo，不算 free。",
  "",
  '按 JSON 数组返回，元素形如 {"index":0,"keep":true,"category":"game","obtain":"free","reason":"Epic 本周免费游戏"}。',
  "reason 用一句不超过 20 字的中文说清「能拿到什么」或「为什么不是福利」，不要输出多余文本。",
].join("\n");

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: Boolean(config.aiBaseUrl && config.aiModel),
  baseUrl: config.aiBaseUrl,
  apiKey: config.aiApiKey,
  model: config.aiModel,
  maxItems: DEFAULT_MAX_ITEMS,
  systemPrompt: "",
};

function numOr(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

export function getAiSettings(): AiSettings {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", SETTINGS_KEY);
  if (!row) return { ...DEFAULT_AI_SETTINGS };
  try {
    const raw = JSON.parse(row.value) as Partial<AiSettings>;
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_AI_SETTINGS.enabled,
      baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : DEFAULT_AI_SETTINGS.baseUrl,
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : DEFAULT_AI_SETTINGS.apiKey,
      model: typeof raw.model === "string" ? raw.model : DEFAULT_AI_SETTINGS.model,
      maxItems: numOr(raw.maxItems, DEFAULT_AI_SETTINGS.maxItems, 20, 500),
      systemPrompt: typeof raw.systemPrompt === "string" ? raw.systemPrompt : "",
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(patch: Partial<AiSettings>): AiSettings {
  const cur = getAiSettings();
  const next: AiSettings = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
    baseUrl: typeof patch.baseUrl === "string" ? patch.baseUrl.trim() : cur.baseUrl,
    apiKey: typeof patch.apiKey === "string" && patch.apiKey.trim() && patch.apiKey !== "••••" ? patch.apiKey.trim() : cur.apiKey,
    model: typeof patch.model === "string" ? patch.model.trim() : cur.model,
    maxItems: numOr(patch.maxItems ?? cur.maxItems, cur.maxItems, 20, 500),
    systemPrompt: typeof patch.systemPrompt === "string" ? patch.systemPrompt : cur.systemPrompt,
  };
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

/** 给前端的安全视图：密钥打码。 */
export function publicAiSettings(s = getAiSettings()) {
  return {
    enabled: s.enabled,
    baseUrl: s.baseUrl,
    model: s.model,
    maxItems: s.maxItems,
    systemPrompt: s.systemPrompt,
    hasKey: Boolean(s.apiKey),
    keyHint: s.apiKey ? "••••" + s.apiKey.slice(-4) : "",
    ready: aiReady(s),
    promptIsDefault: !s.systemPrompt.trim(),
    defaultPrompt: DEFAULT_PROMPT,
  };
}

async function callOnce(
  payload: { index: number; title: string; summary: string }[],
  s: AiSettings,
): Promise<Map<number, AiVerdict> | null> {
  const endpoint = s.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
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
          { role: "system", content: s.systemPrompt.trim() || DEFAULT_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error("AI HTTP " + res.status + " " + (await res.text()).slice(0, 120));
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
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
 * 条目多于 maxItems 时分批送审，保证上限内每个新条目都有结论。
 */
export async function reviewItems(items: RawItem[], settings?: AiSettings): Promise<Map<number, AiVerdict> | null> {
  const s = settings ?? getAiSettings();
  if (!aiReady(s) || !items.length) return null;

  const total = Math.min(items.length, s.maxItems);
  const merged = new Map<number, AiVerdict>();
  let ok = 0;

  for (let start = 0; start < total; start += BATCH) {
    const chunk = items.slice(start, Math.min(start + BATCH, total));
    const payload = chunk.map((it, i) => ({
      index: start + i,
      title: (it.title ?? "").slice(0, 140),
      summary: (it.summary ?? "").slice(0, 200),
    }));
    const map = await callOnce(payload, s);
    if (map) {
      for (const [k, v] of map) merged.set(k, v);
      ok += 1;
    }
  }

  return ok > 0 ? merged : null;
}

/** 连通性测试：用固定样本跑一次，返回模型原话与耗时。 */
export async function testAiConnection(settings?: AiSettings): Promise<{
  ok: boolean;
  ms: number;
  model: string;
  results: { title: string; keep: boolean; category: string; reason: string }[];
  error?: string;
}> {
  const s = settings ?? getAiSettings();
  const samples: RawItem[] = [
    { externalId: "t1", url: "https://example.com/1", title: "【福利】送 5 个 500M 动态IP测试，先到先得", summary: "回复即可" },
    { externalId: "t2", url: "https://example.com/2", title: "88% 受访开发者点头赞成：FreeBSD 组建工作组制定 AI 使用新规", summary: "行业新闻" },
    { externalId: "t3", url: "https://example.com/3", title: "谁有 ovh 年付 10% 优惠券哇", summary: "求优惠券" },
  ] as RawItem[];

  const t0 = Date.now();
  try {
    const map = await reviewItems(samples, s);
    const ms = Date.now() - t0;
    if (!map) return { ok: false, ms, model: s.model, results: [], error: "未返回有效结论" };
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

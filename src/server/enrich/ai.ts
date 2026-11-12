import { config, aiEnabled } from "../config.ts";
import type { RawItem } from "../collectors/types.ts";

export type AiVerdict = { index: number; keep: boolean; category: string; reason: string };

const SYSTEM_PROMPT = [
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
  '按 JSON 数组返回，元素形如 {"index":0,"keep":true,"category":"game","reason":"Epic 本周免费游戏"}。',
  "reason 用一句不超过 20 字的中文说清「能拿到什么」或「为什么不是福利」，不要输出多余文本。",
].join("\n");

async function callOnce(payload: { index: number; title: string; summary: string }[]): Promise<Map<number, AiVerdict> | null> {
  const endpoint = config.aiBaseUrl.replace(/\/+$/, "") + "/chat/completions";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.aiApiKey ? { authorization: "Bearer " + config.aiApiKey } : {}),
      },
      body: JSON.stringify({
        model: config.aiModel,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
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
 * 送审前先裁剪，控制 token。返回 index → verdict 的映射；未启用或失败时返回 null。
 * 条目多于 aiMaxItems 时分批送审，保证每个新条目都有结论。
 */
export async function reviewItems(items: RawItem[]): Promise<Map<number, AiVerdict> | null> {
  if (!aiEnabled || !items.length) return null;

  const BATCH = 20;
  const total = Math.min(items.length, Math.max(config.aiMaxItems, BATCH));
  const merged = new Map<number, AiVerdict>();
  let ok = 0;

  for (let start = 0; start < total; start += BATCH) {
    const chunk = items.slice(start, Math.min(start + BATCH, total));
    const payload = chunk.map((it, i) => ({
      index: start + i,
      title: (it.title ?? "").slice(0, 140),
      summary: (it.summary ?? "").slice(0, 200),
    }));
    const map = await callOnce(payload);
    if (map) {
      for (const [k, v] of map) merged.set(k, v);
      ok += 1;
    }
  }

  return ok > 0 ? merged : null;
}

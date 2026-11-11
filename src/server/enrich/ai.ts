import { config, aiEnabled } from "../config.ts";
import type { RawItem } from "../collectors/types.ts";

export type AiVerdict = { index: number; keep: boolean; category: string; reason: string };

const SYSTEM_PROMPT = [
  "你是福利信息审核员。给定一组帖子标题与摘要，判断每一条是否真的是「可以免费领取 / 注册可得 / 限时开放」的资源或权益。",
  "排除：纯讨论、求助帖、二手交易、盗版与账号共享、需要先付费再返现的套路、与福利无关的技术问题。",
  "按 JSON 数组返回，元素形如 {\"index\":0,\"keep\":true,\"category\":\"ai|cloud|domain|software|media|game|goods|invite|edu|other\",\"reason\":\"一句话理由\"}，不要输出多余文本。",
].join("\n");

/** 送审前先裁剪，控制 token。返回 index → verdict 的映射；未启用或失败时返回 null。 */
export async function reviewItems(items: RawItem[]): Promise<Map<number, AiVerdict> | null> {
  if (!aiEnabled || !items.length) return null;
  const take = items.slice(0, config.aiMaxItems);
  const payload = take.map((it, i) => ({
    index: i,
    title: (it.title ?? "").slice(0, 120),
    summary: (it.summary ?? "").slice(0, 160),
  }));

  const endpoint = config.aiBaseUrl.replace(/\/+$/, "") + "/chat/completions";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 45_000);
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
    if (!res.ok) throw new Error("AI HTTP " + res.status);
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

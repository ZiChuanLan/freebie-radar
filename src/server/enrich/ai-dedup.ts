import { all, get, run, tx } from "../db.ts";
import { aiReady, getAiSettings, type AiSettings } from "./ai-settings.ts";
import { requestAiText } from "./ai-client.ts";

export type DedupCandidate = {
  id: number;
  title: string;
  summary?: string | null;
  kind?: string | null;
  category?: string | null;
  canonicalId?: number | null;
};

export type SemanticDupMatch = {
  index: number;
  duplicateOfId: number;
  reason: string;
};

const DEDUP_SYSTEM_PROMPT = [
  "你是资源聚合与新闻资讯的「AI 语义去重」判定器。",
  "任务：逐条判断「candidates（新候选）」是否与「anchors（已有基准）」或更早的候选条目本质上是**同一个福利活动、同一款免费游戏/软件、同一开源项目或同一件新闻事件**。",
  "",
  "判定为重复（必须填写 duplicateOfId）的典型情况：",
  "- 同活动不同平台/品牌简称或措辞（如「B站免费领7天大会员」与「哔哩哔哩为庆祝BLG夺冠赠送大会员」、「BLG夺冠送七天大会员」）",
  "- 同款限免游戏/软件的不同来源报道或中英文版本",
  "- 同一条宏观/科技新闻的不同媒体改写（如央视、中新网、BBC 报道同一政策/事件）",
  "",
  "严禁误判为重复（必须返回 duplicateOfId: null）：",
  "- 同事件但奖品/利益点明显不同（如「BLG夺冠B站送大会员」vs「BLG夺冠LOLM手游送皮肤英雄」）",
  "- 不同银行/合作商家/联名卡的各自活动（如「中国银行2233卡领B站会员」vs「B站全站送7天大会员」、或「阿里云送券」vs「腾讯云送券」）",
  "- 不同的特价 VPS / 不同的开源项目 / 不同的单品商品",
  "",
  '只输出 JSON 数组，每个元素形如 {"index":0,"duplicateOfId":12345,"reason":"同为B站BLG夺冠送大会员"}；若无重复则 duplicateOfId 为 null。不要输出任何多余文字。',
].join("\n");
/**
 * AI 语义去重降级计数：模型不可用/超时/额度耗尽时，去重会静默退回纯规则，
 * 这里记录次数与最近一次原因，供「AI 审核」面板显示，避免误以为去重一直在生效。
 */
const degradation = { count: 0, lastAt: null as string | null, lastReason: null as string | null };

export function aiDedupDegradation(): { count: number; lastAt: string | null; lastReason: string | null } {
  return { ...degradation };
}

function noteDegraded(reason: string): void {
  degradation.count += 1;
  degradation.lastAt = new Date().toISOString();
  degradation.lastReason = reason.slice(0, 120);
}

function compactExcerpt(it: { summary?: string | null }, maxLen = 90): string {
  const txt = (it.summary ?? "").replace(/\s+/g, " ").trim();
  return txt.length <= maxLen ? txt : txt.slice(0, maxLen) + "…";
}

/** 查找聚类根节点，防止链式跳转与环路。 */
export function resolveClusterRoot(itemId: number): number {
  let cur = itemId;
  const visited = new Set<number>([cur]);
  for (let hop = 0; hop < 8; hop += 1) {
    const row = get<{ canonical_id: number | null }>("SELECT canonical_id FROM items WHERE id = ?", cur);
    if (!row || row.canonical_id == null || row.canonical_id === cur) return cur;
    if (visited.has(row.canonical_id)) return cur;
    visited.add(row.canonical_id);
    cur = row.canonical_id;
  }
  return cur;
}

/**
 * 将 itemId 与 targetId 归并到同一个 canonical_id 簇（根条目自身也写入 canonical_id = rootId，
 * 以便 SQL `PARTITION BY canonical_id` 一次命中整个簇）。
 */
export function linkCanonicalCluster(itemId: number, targetId: number): number {
  if (!Number.isFinite(itemId) || !Number.isFinite(targetId) || itemId === targetId) return itemId;
  const rootTarget = resolveClusterRoot(targetId);
  const rootSelf = resolveClusterRoot(itemId);
  const rootId = Math.min(rootTarget, rootSelf);
  tx(() => {
    run(
      "UPDATE items SET canonical_id = ? WHERE id IN (?, ?, ?) OR canonical_id IN (?, ?)",
      rootId,
      rootId,
      itemId,
      targetId,
      itemId,
      rootTarget,
    );
  });
  return rootId;
}

/** 调用大模型对比 candidates 与 anchors，返回命中的重复条目映射（index -> match）。 */
export async function findSemanticDuplicatesWithAi(
  candidates: DedupCandidate[],
  anchors: DedupCandidate[],
  settings?: AiSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, SemanticDupMatch>> {
  const out = new Map<number, SemanticDupMatch>();
  const s = settings ?? getAiSettings();
  if (!candidates.length) return out;
  if (!anchors.length && candidates.length < 2) return out;
  if (!aiReady(s)) return out;

  const validAnchorIds = new Set(anchors.map((a) => a.id));
  const candidateIds = new Set(candidates.map((c) => c.id));
  const ac = new AbortController();
  const timeoutMs = Math.max(s.timeoutSec * 1000, 12_000);
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  const payload = {
    anchors: anchors.slice(0, 40).map((a) => ({
      id: a.id,
      kind: a.kind ?? "freebie",
      category: a.category ?? "other",
      title: a.title.slice(0, 120),
      summary: compactExcerpt(a, 70),
    })),
    candidates: candidates.map((c, idx) => ({
      index: idx,
      id: c.id,
      kind: c.kind ?? "freebie",
      category: c.category ?? "other",
      title: c.title.slice(0, 120),
      summary: compactExcerpt(c, 70),
    })),
  };

  try {
    const { content } = await requestAiText(
      s,
      { system: DEDUP_SYSTEM_PROMPT, user: JSON.stringify(payload) },
      { signal: ac.signal, fetchImpl, errorLabel: "AI 去重", errorPreviewLength: 100 },
    );
    const jsonText = /\[[\s\S]*\]/.exec(content)?.[0];
    if (!jsonText) return out;
    const arr = JSON.parse(jsonText) as Array<{
      index?: unknown;
      duplicateOfId?: unknown;
      reason?: unknown;
    }>;
    if (!Array.isArray(arr)) return out;

    for (const row of arr) {
      const idx = typeof row?.index === "number" ? row.index : -1;
      const cand = idx >= 0 && idx < candidates.length ? candidates[idx] : null;
      const dupId = typeof row?.duplicateOfId === "number" ? row.duplicateOfId : null;
      if (!cand || dupId == null || dupId === cand.id) continue;
      // 仅接受真实存在且不是未来候选的基准 ID（anchors 或同一批中 index 更小的候选）
      const earlierCandidate = candidates.slice(0, idx).some((prev) => prev.id === dupId);
      if (!validAnchorIds.has(dupId) && !(candidateIds.has(dupId) && earlierCandidate)) continue;
      const reason = typeof row?.reason === "string" ? row.reason.trim().slice(0, 60) : "AI 语义去重";
      out.set(idx, { index: idx, duplicateOfId: dupId, reason });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    noteDegraded(msg);
    console.log("[ai-dedup] 语义去重降级跳过:", msg);
  } finally {
    clearTimeout(timer);
  }
  return out;
}

/**
 * 审核后自动聚类：将新通过审核的条目与近 N 小时已有留存条目对比，写入 canonical_id 供列表与热点折迭。
 */
export async function dedupeKeptItemsWithAi(
  itemIds: number[],
  settings?: AiSettings,
): Promise<{ merged: number }> {
  const s = settings ?? getAiSettings();
  if (!itemIds.length || !s.aiDedupEnabled || !aiReady(s)) return { merged: 0 };

  const uniqueIds = [...new Set(itemIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueIds.length) return { merged: 0 };
  const ph = uniqueIds.map(() => "?").join(",");
  const rows = all<{
    id: number;
    title: string;
    summary: string | null;
    kind: string | null;
    category: string | null;
    canonical_id: number | null;
  }>(
    `SELECT id, title, summary, kind, category, canonical_id
       FROM items
      WHERE id IN (${ph}) AND status = 'active' AND ai_keep = 1 AND (kind IS NULL OR kind != 'noise')
      ORDER BY id ASC`,
    ...uniqueIds,
  );
  if (!rows.length) return { merged: 0 };

  const cutoff = new Date(Date.now() - s.aiDedupWindowHours * 3_600_000).toISOString();
  let merged = 0;

  // 按 kind 分组，减少无关跨频道比较
  const byKind = new Map<string, DedupCandidate[]>();
  for (const r of rows) {
    const k = r.kind ?? "freebie";
    const list = byKind.get(k) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      summary: r.summary,
      kind: k,
      category: r.category,
      canonicalId: r.canonical_id,
    });
    byKind.set(k, list);
  }

  for (const [kind, cands] of byKind) {
    const excludeSet = new Set(cands.map((c) => c.id));
    // 只有 1-2 条时用 LLM 比对不划算（单次 2-3 秒），留给推送前的按需比对
    if (cands.length < 3) continue;
    const anchorRows = all<{
      id: number;
      title: string;
      summary: string | null;
      kind: string | null;
      category: string | null;
      canonical_id: number | null;
    }>(
      `SELECT id, title, summary, kind, category, canonical_id
         FROM items
        WHERE status = 'active'
          AND ai_keep = 1
          AND COALESCE(kind, 'freebie') = ?
          AND COALESCE(published_at, first_seen_at) >= ?
          AND (canonical_id IS NULL OR canonical_id = id)
        ORDER BY COALESCE(pushed_at, '') DESC, score DESC, id DESC
        LIMIT 40`,
      kind,
      cutoff,
    ).filter((a) => !excludeSet.has(a.id));

    const anchors: DedupCandidate[] = anchorRows.map((a) => ({
      id: a.id,
      title: a.title,
      summary: a.summary,
      kind: a.kind,
      category: a.category,
      canonicalId: a.canonical_id,
    }));

    for (let i = 0; i < cands.length; i += 12) {
      const chunk = cands.slice(i, i + 12);
      const matches = await findSemanticDuplicatesWithAi(chunk, anchors, s);
      for (const [idx, m] of matches) {
        const cand = chunk[idx];
        if (!cand) continue;
        linkCanonicalCluster(cand.id, m.duplicateOfId);
        merged += 1;
        console.log(`[ai-dedup] 聚类 #${cand.id} -> #${m.duplicateOfId}: ${m.reason}`);
      }
      // 未被合并的本批代表也补充进后续分片基准池
      for (let j = 0; j < chunk.length; j += 1) {
        if (!matches.has(j) && anchors.length < 40) anchors.push(chunk[j]!);
      }
    }
  }

  return { merged };
}

/**
 * Telegram 推送前最终语义防重闸：
 * 1. 先零 Token 拦截与已推送条目共享 canonical_id 的候选；
 * 2. 若开启 AI 语义去重，再将剩余候选与近 N 小时已推送记录送大模型二次比对，命中即落库 canonical_id 并拦截推送。
 */
export async function filterPushDuplicatesWithAi<T extends DedupCandidate>(
  candidates: T[],
  pushedRows: DedupCandidate[],
  options?: { settings?: AiSettings; fetchImpl?: typeof fetch; persistLink?: boolean },
): Promise<{
  kept: T[];
  intercepted: Array<{ item: T; duplicateOfId: number; reason: string }>;
}> {
  if (!candidates.length) return { kept: [], intercepted: [] };

  const persistLink = options?.persistLink !== false;
  const pushedCanonical = new Map<number, number>();
  for (const p of pushedRows) {
    if (p.canonicalId != null && p.canonicalId > 0) {
      pushedCanonical.set(p.canonicalId, p.id);
    }
  }

  const afterRule: T[] = [];
  const intercepted: Array<{ item: T; duplicateOfId: number; reason: string }> = [];

  for (const c of candidates) {
    if (c.canonicalId != null && pushedCanonical.has(c.canonicalId)) {
      const targetId = pushedCanonical.get(c.canonicalId)!;
      intercepted.push({ item: c, duplicateOfId: targetId, reason: "同聚类簇已推送过" });
      continue;
    }
    afterRule.push(c);
  }

  const s = options?.settings ?? getAiSettings();
  if (!afterRule.length || !s.aiDedupEnabled || !aiReady(s)) {
    return { kept: afterRule, intercepted };
  }
  if (!pushedRows.length && afterRule.length < 2) {
    return { kept: afterRule, intercepted };
  }

  const matches = await findSemanticDuplicatesWithAi(afterRule, pushedRows.slice(0, 35), s, options?.fetchImpl);
  const kept: T[] = [];
  const keptCanonicalRoots = new Set<number>();

  for (let i = 0; i < afterRule.length; i += 1) {
    const item = afterRule[i]!;
    const hit = matches.get(i);
    if (hit) {
      if (persistLink) linkCanonicalCluster(item.id, hit.duplicateOfId);
      intercepted.push({ item, duplicateOfId: hit.duplicateOfId, reason: hit.reason });
      console.log(`[push] AI 语义去重拦截 #${item.id}（与 #${hit.duplicateOfId} 重复）：${hit.reason}`);
      continue;
    }
    if (item.canonicalId != null && keptCanonicalRoots.has(item.canonicalId)) {
      intercepted.push({ item, duplicateOfId: item.canonicalId, reason: "同批同聚类重复" });
      continue;
    }
    if (item.canonicalId != null) keptCanonicalRoots.add(item.canonicalId);
    kept.push(item);
  }

  return { kept, intercepted };
}

/** 一键对近 N 小时历史已留存条目跑一次 AI 去重聚类（同时折叠列表与防后续重复推送）。 */
export async function runAiDedupBackfill(limit = 80): Promise<{
  scanned: number;
  merged: number;
  clusters: number;
  skippedReason?: string;
}> {
  const s = getAiSettings();
  if (!aiReady(s)) {
    return { scanned: 0, merged: 0, clusters: 0, skippedReason: "AI 审核尚未配置或未开启" };
  }
  const cap = Math.min(Math.max(Math.round(limit) || 80, 10), 200);
  const cutoff = new Date(Date.now() - s.aiDedupWindowHours * 3_600_000).toISOString();

  const rows = all<{
    id: number;
    title: string;
    summary: string | null;
    kind: string | null;
    category: string | null;
    canonical_id: number | null;
    pushed_at: string | null;
  }>(
    `SELECT id, title, summary, kind, category, canonical_id, pushed_at
       FROM items
      WHERE status = 'active'
        AND (ai_keep = 1 OR ai_keep IS NULL)
        AND (kind IS NULL OR kind != 'noise')
        AND COALESCE(published_at, first_seen_at) >= ?
      ORDER BY (pushed_at IS NOT NULL) DESC, score DESC, id ASC
      LIMIT ?`,
    cutoff,
    cap,
  );
  if (rows.length < 2) return { scanned: rows.length, merged: 0, clusters: aiDedupStats().clusterCount };

  const byKind = new Map<string, DedupCandidate[]>();
  for (const r of rows) {
    const k = r.kind ?? "freebie";
    const list = byKind.get(k) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      summary: r.summary,
      kind: k,
      category: r.category,
      canonicalId: r.canonical_id,
    });
    byKind.set(k, list);
  }

  let merged = 0;
  for (const [, list] of byKind) {
    if (list.length < 2) continue;
    const anchors: DedupCandidate[] = [];
    const pending: DedupCandidate[] = [];
    for (const item of list) {
      if (item.canonicalId == null || item.canonicalId === item.id) {
        if (anchors.length < 30 && item.canonicalId === item.id) anchors.push(item);
        else pending.push(item);
      }
    }
    if (!anchors.length && pending.length >= 2) {
      anchors.push(pending.shift()!);
    }
    for (let i = 0; i < pending.length; i += 12) {
      const chunk = pending.slice(i, i + 12);
      const matches = await findSemanticDuplicatesWithAi(chunk, anchors, s);
      for (const [idx, m] of matches) {
        const cand = chunk[idx];
        if (!cand) continue;
        linkCanonicalCluster(cand.id, m.duplicateOfId);
        merged += 1;
      }
      for (let j = 0; j < chunk.length; j += 1) {
        if (!matches.has(j) && anchors.length < 40) anchors.push(chunk[j]!);
      }
    }
  }

  return { scanned: rows.length, merged, clusters: aiDedupStats().clusterCount };
}

export function aiDedupStats(): { mergedItems: number; clusterCount: number } {
  const row = get<{ mergedItems: number | null; clusterCount: number | null }>(
    `SELECT
       SUM(CASE WHEN canonical_id IS NOT NULL AND id != canonical_id THEN 1 ELSE 0 END) AS mergedItems,
       COUNT(DISTINCT canonical_id) AS clusterCount
     FROM items
     WHERE status = 'active' AND canonical_id IS NOT NULL`,
  );
  return {
    mergedItems: row?.mergedItems ?? 0,
    clusterCount: row?.clusterCount ?? 0,
  };
}

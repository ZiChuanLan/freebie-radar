import type { RawItem } from "../collectors/types.ts";

const CDP_BASE = process.env.CDP_BASE ?? "http://127.0.0.1:9222";

type Target = { id: string; url: string; webSocketDebuggerUrl: string; type: string };

let seq = 0;
function rpc(ws: WebSocket, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP timeout: " + method)), 30_000);
    const onMessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (msg.error) reject(new Error("CDP error: " + (msg.error.message ?? "unknown")));
      else resolve(msg.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function newPage(url: string): Promise<Target> {
  const res = await fetch(CDP_BASE + "/json/new?" + encodeURIComponent(url), { method: "PUT" });
  if (!res.ok) throw new Error("无法新建标签页: HTTP " + res.status + "（Chrome 是否用 --remote-debugging-port=9222 启动？）");
  return (await res.json()) as Target;
}

async function closePage(id: string): Promise<void> {
  await fetch(CDP_BASE + "/json/close/" + id).catch(() => undefined);
}

export async function withPage<T>(url: string, waitMs: number, fn: (ws: WebSocket) => Promise<T>): Promise<T> {
  const target = await newPage(url);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP websocket 连接失败")), { once: true });
  });
  try {
    await rpc(ws, "Page.enable");
    await rpc(ws, "Runtime.enable");
    await new Promise((r) => setTimeout(r, waitMs));
    return await fn(ws);
  } finally {
    ws.close();
    await closePage(target.id);
  }
}

export async function evaluate<T>(ws: WebSocket, expression: string): Promise<T> {
  const result = (await rpc(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
  if (result.exceptionDetails) throw new Error("页面脚本异常: " + (result.exceptionDetails.text ?? "unknown"));
  return result.result?.value as T;
}

export const ZHIHU_JS = "(() => { const cards = Array.from(document.querySelectorAll('.SearchResult-Card, .List-item')); return cards.slice(0, 20).map((c) => { const a = c.querySelector('h2 a, .ContentItem-title a'); const t = c.querySelector('.RichText'); return { title: (a && a.textContent || '').trim(), url: (a && a.href) || '', summary: (t && t.textContent || '').trim().slice(0, 300) }; }).filter((x) => x.title && x.url); })()";

export const XHS_JS = "(() => { const cards = Array.from(document.querySelectorAll('section.note-item')); return cards.slice(0, 20).map((c) => { const a = c.querySelector('a.cover, a[href*=\"/explore/\"]'); const t = c.querySelector('.title span, .footer .title, .title'); return { title: (t && t.textContent || '').trim(), url: (a && a.href) || '', summary: '' }; }).filter((x) => x.title && x.url); })()";

export const XHH_JS = "(() => { const cards = Array.from(document.querySelectorAll('a[href*=\"/bbs/app/link/\"], .feed-item, .post-item')); const seen = new Set(); return cards.slice(0, 40).map((c) => { const a = c.tagName === 'A' ? c : c.querySelector('a[href]'); const t = (c.textContent || '').trim().replace(/\\s+/g, ' '); return { title: t.slice(0, 120), url: (a && a.href) || '', summary: '' }; }).filter((x) => { if (!x.title || !x.url || seen.has(x.url)) return false; seen.add(x.url); return true; }).slice(0, 20); })()";

export type SiteKey = "zhihu" | "xhs" | "xiaoheihe";

export const SITES: Record<SiteKey, { sourceId: string; label: string; url: (kw: string) => string; script: string; waitMs: number }> = {
  zhihu: {
    sourceId: "zhihu-search",
    label: "知乎搜索",
    url: (kw) => "https://www.zhihu.com/search?type=content&q=" + encodeURIComponent(kw),
    script: ZHIHU_JS,
    waitMs: 4500,
  },
  xhs: {
    sourceId: "xhs-search",
    label: "小红书搜索",
    url: (kw) => "https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent(kw) + "&source=web_search_result_notes",
    script: XHS_JS,
    waitMs: 5000,
  },
  xiaoheihe: {
    sourceId: "xiaoheihe-search",
    label: "小黑盒搜索",
    url: (kw) => "https://www.xiaoheihe.cn/app/bbs/home?keyword=" + encodeURIComponent(kw),
    script: XHH_JS,
    waitMs: 5000,
  },
};

export async function fetchSite(site: SiteKey, keyword: string): Promise<RawItem[]> {
  const spec = SITES[site];
  const raw = await withPage(spec.url(keyword), spec.waitMs, (ws) => evaluate<{ title: string; url: string; summary: string }[]>(ws, spec.script));
  return raw.map((r) => ({
    externalId: r.url,
    url: r.url,
    title: r.title,
    summary: r.summary,
    author: null,
    publishedAt: null,
    tags: [site, keyword],
    raw: { site, keyword },
  }));
}

export function cdpBase(): string {
  return CDP_BASE;
}

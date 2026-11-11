// 通过 ego-browser（复用已登录会话）采集知乎 / 小红书 / 小黑盒，并回传 freebie-radar 服务器。
// 运行：bash -lc "ego-browser nodejs < /h/WorkSpace/freebie-radar/scripts/local-collect.mjs"
// 前置：ego-browser 需处于已登录状态；服务器需配置同名 INGEST_TOKEN。

const SERVER = "http://10.144.144.6:8788";
const TOKEN = "fr_ingest_9f3c2a7b1d";

const ZHIHU_KEYWORDS = ["免费领取", "免费额度", "白嫖"];
const XHH_KEYWORDS = ["免费领取", "Epic 喜加一"];
const XHS_KEYWORDS = ["免费领取"];
const ONLY = null; // 例如 "zhihu" 只跑一个站

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const task = await taskSpace("freebie-radar");
const page = task.page("p1");
const summary = [];

async function push(sourceId, items) {
  if (!items.length) return summary.push({ sourceId, ok: true, inserted: 0, note: "empty" });
  const res = await fetch(SERVER + "/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ sourceId, items }),
  });
  const body = await res.text();
  summary.push({ sourceId, status: res.status, body: body.slice(0, 160) });
}

async function collectZhihu() {
  const all = new Map();
  for (const kw of ZHIHU_KEYWORDS) {
    await page.goto("https://www.zhihu.com/search?type=content&q=" + encodeURIComponent(kw));
    await sleep(4200);
    const items = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".SearchResult-Card, .List-item"));
      return cards.map((c) => {
        const a = c.querySelector("h2 a, .ContentItem-title a");
        const t = c.querySelector(".RichText");
        return {
          title: ((a && a.textContent) || "").trim(),
          url: (a && a.href) || "",
          summary: ((t && t.textContent) || "").trim().slice(0, 300),
        };
      }).filter((x) => x.title && x.url);
    });
    console.log("[zhihu]", kw, "->", items.length);
    for (const it of items) if (!all.has(it.url)) all.set(it.url, it);
  }
  await push("zhihu-search", [...all.values()].map((x) => ({
    externalId: x.url, url: x.url, title: x.title, summary: x.summary,
    author: null, publishedAt: null, tags: ["zhihu", "local-browser"], raw: { site: "zhihu" },
  })));
  console.log("[zhihu] unique", all.size);
}

async function collectXhs() {
  const all = new Map();
  for (const kw of XHS_KEYWORDS) {
    await page.goto("https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent(kw) + "&source=web_search_result_notes");
    await sleep(5000);
    const state = await page.evaluate(() => ({
      needLogin: /登录后查看搜索结果/.test(document.body.innerText || ""),
      items: Array.from(document.querySelectorAll("section.note-item")).map((c) => {
        const a = c.querySelector('a.cover, a[href*="/explore/"], a[href*="/search_result/"]');
        const t = c.querySelector(".title span, .footer .title, .title");
        return { title: ((t && t.textContent) || "").trim(), url: (a && a.href) || "" };
      }).filter((x) => x.title && x.url),
    }));
    if (state.needLogin) {
      console.log("[xhs] 需要登录，跳过");
      summary.push({ sourceId: "xhs-search", ok: false, note: "login required" });
      return;
    }
    console.log("[xhs]", kw, "->", state.items.length);
    for (const it of state.items) if (!all.has(it.url)) all.set(it.url, it);
  }
  await push("xhs-search", [...all.values()].map((x) => ({
    externalId: x.url, url: x.url, title: x.title, summary: "",
    author: null, publishedAt: null, tags: ["xiaohongshu", "local-browser"], raw: { site: "xhs" },
  })));
  console.log("[xhs] unique", all.size);
}

async function collectXiaoheihe() {
  const all = new Map();
  for (const kw of XHH_KEYWORDS) {
    await page.goto("https://www.xiaoheihe.cn/app/bbs/home?t=" + Date.now());
    await sleep(4200);
    await page.evaluate(() => {
      window.__cap = [];
      const keep = (url, text) => { if (String(url).includes("general/search")) window.__cap.push(String(text)); };
      const of = window.fetch;
      window.fetch = function (...args) {
        const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        const p = of.apply(this, args);
        p.then((res) => res.clone().text().then((t) => keep(url, t)).catch(() => {})).catch(() => {});
        return p;
      };
      const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u, ...r) { this.__u = u; return oo.call(this, m, u, ...r); };
      XMLHttpRequest.prototype.send = function (...a) { this.addEventListener("load", () => keep(this.__u, this.responseText)); return os.apply(this, a); };
    });
    const filled = await page.evaluate((keyword) => {
      const inp = document.querySelector(".el-input__inner");
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(inp, keyword);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.focus();
      for (const type of ["keydown", "keypress", "keyup"]) {
        inp.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
      return true;
    }, kw);
    if (!filled) { console.log("[xhh] 没有搜索框"); continue; }
    await sleep(6500);
    const items = await page.evaluate(() => {
      const caps = window.__cap || [];
      if (!caps.length) return [];
      let parsed = null;
      try { parsed = JSON.parse(caps[0]); } catch (e) { return []; }
      const list = (parsed.result && parsed.result.items) || [];
      return list.filter((i) => i.type === "link" && i.info).map((i) => {
        const n = i.info;
        return {
          linkid: n.linkid,
          title: String(n.title || "").replace(/<[^>]+>/g, ""),
          summary: String(n.description || "").replace(/<[^>]+>/g, "").slice(0, 300),
          createdAt: n.create_at,
          topics: (n.topics || []).map((t) => t.name),
        };
      });
    });
    console.log("[xhh]", kw, "->", items.length);
    for (const it of items) if (!all.has(it.linkid)) all.set(it.linkid, it);
  }
  await push("xiaoheihe-search", [...all.values()].map((x) => ({
    externalId: String(x.linkid),
    url: "https://www.xiaoheihe.cn/app/bbs/link/" + x.linkid,
    title: x.title,
    summary: x.summary,
    author: null,
    publishedAt: x.createdAt ? new Date(x.createdAt * 1000).toISOString() : null,
    tags: ["xiaoheihe", ...(x.topics || []).slice(0, 2)],
    raw: { site: "xiaoheihe", linkid: x.linkid },
  })));
  console.log("[xhh] unique", all.size);
}

const jobs = ONLY
  ? [ONLY]
  : ["zhihu", "xhs", "xiaoheihe"];
for (const job of jobs) {
  try {
    if (job === "zhihu") await collectZhihu();
    else if (job === "xhs") await collectXhs();
    else await collectXiaoheihe();
  } catch (err) {
    console.log("[" + job + "] 失败", String(err).slice(0, 200));
    summary.push({ sourceId: job, ok: false, note: String(err).slice(0, 160) });
  }
}
console.log("SUMMARY", JSON.stringify(summary, null, 2));

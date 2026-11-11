// 用 Playwright 操作一个持久化 Chrome profile（登录态留在磁盘），
// 采集知乎 / 小红书 / 小黑盒，并回传 freebie-radar 服务器。
//
//   node scripts/pw-collect.mjs            # 三站全跑
//   node scripts/pw-collect.mjs xhs        # 只跑小红书
//
// 首次使用：脚本会打开可见浏览器，在里面登录一次目标站即可；登录态会写进 PROFILE_DIR。

import { chromium } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE_DIR = process.env.PROFILE_DIR || join(homedir(), "AppData", "Local", "freebie-radar-chrome");
const SERVER = process.env.SERVER_URL || "http://10.144.144.6:8788";
const TOKEN = process.env.INGEST_TOKEN || "fr_ingest_9f3c2a7b1d";

const KEYWORDS = {
  zhihu: ["免费领取", "免费额度", "白嫖"],
  xhs: ["免费领取", "白嫖", "免费会员"],
  xiaoheihe: ["免费领取", "Epic 喜加一"],
};

const only = process.argv[2];
const jobs = only ? [only] : ["zhihu", "xhs", "xiaoheihe"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const summary = [];

async function push(sourceId, items) {
  if (!items.length) {
    summary.push({ sourceId, inserted: 0, note: "empty" });
    console.log("[" + sourceId + "] 0 条，跳过回传");
    return;
  }
  const res = await fetch(SERVER + "/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ sourceId, items }),
  });
  const body = await res.text();
  summary.push({ sourceId, status: res.status, body: body.slice(0, 140) });
  console.log("[" + sourceId + "] 回传", res.status, body.slice(0, 140));
}

async function collectZhihu(page) {
  const seen = new Map();
  for (const kw of KEYWORDS.zhihu) {
    await page.goto("https://www.zhihu.com/search?type=content&q=" + encodeURIComponent(kw), { waitUntil: "domcontentloaded" });
    await sleep(3500);
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
    for (const it of items) if (!seen.has(it.url)) seen.set(it.url, it);
  }
  await push("zhihu-search", [...seen.values()].map((x) => ({
    externalId: x.url, url: x.url, title: x.title, summary: x.summary,
    author: null, publishedAt: null, tags: ["zhihu", "playwright"], raw: { site: "zhihu" },
  })));
}

async function collectXhs(page) {
  const seen = new Map();
  for (const kw of KEYWORDS.xhs) {
    await page.goto("https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent(kw) + "&source=web_search_result_notes", { waitUntil: "domcontentloaded" });
    await sleep(4500);
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.wheel(0, 1800);
      await sleep(1200);
    }
    const state = await page.evaluate(() => ({
      needLogin: /登录后查看搜索结果/.test(document.body.innerText || ""),
      items: Array.from(document.querySelectorAll("section.note-item")).map((c) => {
        const a = c.querySelector('a.cover, a[href*="/explore/"], a[href*="/search_result/"]');
        const t = c.querySelector(".title span, .footer .title, .title");
        const au = c.querySelector(".author .name, .name");
        return {
          title: ((t && t.textContent) || "").trim(),
          url: (a && a.href) || "",
          author: ((au && au.textContent) || "").trim(),
        };
      }).filter((x) => x.title && x.url),
    }));
    console.log("[xhs]", kw, "needLogin=", state.needLogin, "->", state.items.length);
    if (state.needLogin) { summary.push({ sourceId: "xhs-search", note: "login required" }); return; }
    for (const it of state.items) if (!seen.has(it.url)) seen.set(it.url, it);
  }
  await push("xhs-search", [...seen.values()].map((x) => ({
    externalId: x.url, url: x.url, title: x.title, summary: "",
    author: x.author || null, publishedAt: null,
    tags: ["xiaohongshu", "playwright"], raw: { site: "xhs" },
  })));
}

async function collectXiaoheihe(page) {
  const seen = new Map();
  let captured = [];
  page.on("response", async (res) => {
    if (!res.url().includes("general/search")) return;
    try { captured.push(await res.text()); } catch { /* 忽略已释放的响应 */ }
  });

  for (const kw of KEYWORDS.xiaoheihe) {
    captured = [];
    await page.goto("https://www.xiaoheihe.cn/app/bbs/home?t=" + Date.now(), { waitUntil: "domcontentloaded" });
    await sleep(3500);
    try {
      await page.fill(".el-input__inner", kw, { timeout: 8000 });
      await page.press(".el-input__inner", "Enter");
    } catch (err) {
      console.log("[xhh]", kw, "填输入框失败:", String(err).slice(0, 80));
      continue;
    }
    for (let i = 0; i < 12 && !captured.length; i += 1) await sleep(1000);
    const items = [];
    for (const txt of captured) {
      try {
        const parsed = JSON.parse(txt);
        for (const it of (parsed.result && parsed.result.items) || []) {
          if (it.type !== "link" || !it.info) continue;
          const n = it.info;
          items.push({
            linkid: n.linkid,
            title: String(n.title || "").replace(/<[^>]+>/g, ""),
            summary: String(n.description || "").replace(/<[^>]+>/g, "").slice(0, 300),
            createdAt: n.create_at,
            topics: (n.topics || []).map((t) => t.name),
          });
        }
      } catch { /* 跳过无法解析的响应 */ }
    }
    console.log("[xhh]", kw, "->", items.length);
    for (const it of items) if (!seen.has(it.linkid)) seen.set(it.linkid, it);
  }

  await push("xiaoheihe-search", [...seen.values()].map((x) => ({
    externalId: String(x.linkid),
    url: "https://www.xiaoheihe.cn/app/bbs/link/" + x.linkid,
    title: x.title, summary: x.summary, author: null,
    publishedAt: x.createdAt ? new Date(x.createdAt * 1000).toISOString() : null,
    tags: ["xiaoheihe", ...(x.topics || []).slice(0, 2)],
    raw: { site: "xiaoheihe", linkid: x.linkid },
  })));
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: "chrome",
  headless: process.env.HEADLESS === "1",
  viewport: { width: 1440, height: 900 },
  args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(45000);

try {
  for (const job of jobs) {
    try {
      if (job === "zhihu") await collectZhihu(page);
      else if (job === "xhs") await collectXhs(page);
      else if (job === "xiaoheihe") await collectXiaoheihe(page);
    } catch (err) {
      console.log("[" + job + "] 失败", String(err).slice(0, 200));
      summary.push({ sourceId: job, error: String(err).slice(0, 160) });
    }
  }
} finally {
  await ctx.close();
}

console.log("SUMMARY", JSON.stringify(summary, null, 2));

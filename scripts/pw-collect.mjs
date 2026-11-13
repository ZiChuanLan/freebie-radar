// 用 Playwright 操作本机持久化 Chrome profile（Cookie 100% 留在本机磁盘，绝不上传服务端），
// 采集知乎 / 小红书 / 小黑盒公开帖子并回传 freebie-radar。
//
// 用法：
//   node scripts/pw-collect.mjs serve            # 启动本机回环助手 (http://127.0.0.1:18789)，平时无常驻浏览器
//   node scripts/pw-collect.mjs                  # 一次性跑全部三站后立即退出释放内存
//   node scripts/pw-collect.mjs xhs              # 仅跑小红书

import { chromium } from "playwright";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

try { process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url))); } catch { /* 没有 .env 时忽略 */ }

const PROFILE_DIR = process.env.PROFILE_DIR || join(homedir(), "AppData", "Local", "freebie-radar-chrome");
const DEFAULT_SERVER = (process.env.SERVER_URL || "http://127.0.0.1:8788").replace(/\/+$/, "");
const DEFAULT_TOKEN = (process.env.INGEST_TOKEN || "").trim();
const CDP_URL = (process.env.CDP_URL || "").trim();
const MAX_KEYWORDS = Math.min(Math.max(Number(process.env.MAX_KEYWORDS || 10), 2), 20);
const HELPER_HOST = process.env.HELPER_HOST || "127.0.0.1";
const HELPER_PORT = Number(process.env.HELPER_PORT || 18789);
const COLLECT_INTERVAL_MIN = Math.max(Number(process.env.COLLECT_INTERVAL_MIN || 0), 0);

const BASE_KEYWORDS = {
  zhihu: ["免费领取", "免费额度", "白嫖", "免费积分", "白嫖算力", "开发者福利"],
  xhs: ["免费领取", "白嫖", "免费会员", "白嫖额度", "免费积分", "免费算力", "开发者福利"],
  xiaoheihe: ["免费领取", "Epic 喜加一"],
};
const SOURCE_IDS = { zhihu: "zhihu-search", xhs: "xhs-search", xiaoheihe: "xiaoheihe-search" };
const LOGIN_URLS = {
  zhihu: "https://www.zhihu.com/signin",
  xhs: "https://www.xiaohongshu.com/explore",
  xiaoheihe: "https://www.xiaoheihe.cn/app/bbs/home",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadKeywords(server, token) {
  let extra = [];
  if (process.env.EXTRA_KEYWORDS) {
    extra.push(...process.env.EXTRA_KEYWORDS.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean));
  }
  if (token) {
    try {
      const res = await fetch(server + "/api/ingest/keywords", {
        headers: { authorization: "Bearer " + token },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.keywords)) extra.push(...data.keywords.map((k) => String(k).trim()).filter(Boolean));
      }
    } catch { /* 拉取订阅词失败时退回内置词表 */ }
  }
  const uniq = (list) => [...new Set(list)].slice(0, MAX_KEYWORDS);
  return {
    zhihu: uniq([...BASE_KEYWORDS.zhihu, ...extra]),
    xhs: uniq([...BASE_KEYWORDS.xhs, ...extra]),
    xiaoheihe: uniq(BASE_KEYWORDS.xiaoheihe),
  };
}

async function reportFailure(server, token, sourceId, reason, status = "degraded") {
  console.log("[" + sourceId + "] 上报 " + status + ":", reason);
  if (!token) return { sourceId, reported: status, skipped: "no-token" };
  try {
    const res = await fetch(server + "/api/ingest/failed", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ sourceId, reason, status }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    return { sourceId, reported: status, status: res.status, body: body.slice(0, 120) };
  } catch (err) {
    return { sourceId, reported: status, error: String(err).slice(0, 120) };
  }
}

async function push(server, token, sourceId, items) {
  if (!items.length) {
    return reportFailure(server, token, sourceId, "本轮未抓到任何条目：登录态可能失效，或页面结构变化", "degraded");
  }
  if (!token) {
    console.log("[" + sourceId + "] 缺少 INGEST_TOKEN，跳过回传（抓到 " + items.length + " 条）");
    return { sourceId, fetched: items.length, skipped: "no-token" };
  }
  const payload = JSON.stringify({ sourceId, items });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(server + "/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: payload,
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.text();
      console.log("[" + sourceId + "] 回传", res.status, body.slice(0, 140));
      return { sourceId, status: res.status, body: body.slice(0, 140) };
    } catch (err) {
      const cause = err && err.cause ? (err.cause.code || err.cause.message || "") : "";
      const msg = (err && err.message) || String(err);
      console.log("[" + sourceId + "] 回传第 " + attempt + " 次失败:", msg, cause);
      if (attempt === 3) return { sourceId, error: msg + " " + cause };
      await sleep(3000 * attempt);
    }
  }
}

async function collectZhihu(page, keywords, server, token) {
  const seen = new Map();
  for (const kw of keywords.zhihu) {
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
  return push(server, token, "zhihu-search", [...seen.values()].map((x) => ({
    externalId: x.url, url: x.url, title: x.title, summary: x.summary,
    author: null, publishedAt: null, tags: ["zhihu", "playwright"], raw: { site: "zhihu" },
  })));
}

async function collectXhs(page, keywords, server, token) {
  const seen = new Map();
  for (const kw of keywords.xhs) {
    await page.goto("https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent(kw) + "&source=web_search_result_notes", { waitUntil: "domcontentloaded" });
    await sleep(3500);
    await page.locator("text=最新").first().click({ timeout: 2000 }).catch(() => {});
    await sleep(1500);
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
    if (state.needLogin) {
      return reportFailure(server, token, "xhs-search", "登录态失效：搜索页出现「登录后查看搜索结果」", "degraded");
    }
    for (const it of state.items) if (!seen.has(it.url)) seen.set(it.url, it);
  }
  return push(server, token, "xhs-search", [...seen.values()].map((x) => ({
    externalId: x.url, url: x.url, title: x.title, summary: "",
    author: x.author || null, publishedAt: null,
    tags: ["xiaohongshu", "playwright"], raw: { site: "xhs" },
  })));
}

async function collectXiaoheihe(page, keywords, server, token) {
  const seen = new Map();
  let captured = [];
  const onResp = async (res) => {
    if (!res.url().includes("general/search")) return;
    try { captured.push(await res.text()); } catch { /* 忽略已释放的响应 */ }
  };
  page.on("response", onResp);

  try {
    for (const kw of keywords.xiaoheihe) {
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
  } finally {
    page.off("response", onResp);
  }

  return push(server, token, "xiaoheihe-search", [...seen.values()].map((x) => ({
    externalId: String(x.linkid),
    url: "https://www.xiaoheihe.cn/app/bbs/link/" + x.linkid,
    title: x.title, summary: x.summary, author: null,
    publishedAt: x.createdAt ? new Date(x.createdAt * 1000).toISOString() : null,
    tags: ["xiaoheihe", ...(x.topics || []).slice(0, 2)],
    raw: { site: "xiaoheihe", linkid: x.linkid },
  })));
}

async function openContext(headless) {
  const browser = CDP_URL ? await chromium.connectOverCDP(CDP_URL) : null;
  const ctx = browser
    ? (browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1280, height: 860 } })))
    : await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: process.env.CHROME_CHANNEL || "chrome",
        headless,
        viewport: { width: 1280, height: 860 },
        args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
      });
  const page = browser ? (await ctx.newPage()) : (ctx.pages()[0] ?? (await ctx.newPage()));
  page.setDefaultTimeout(45000);
  return {
    page,
    close: async () => {
      if (browser) await page.close().catch(() => {});
      else await ctx.close().catch(() => {});
    },
  };
}

async function runJobs(jobs, { headless, server, token }) {
  const keywords = await loadKeywords(server, token);
  const { page, close } = await openContext(headless);
  const summary = [];
  try {
    for (const job of jobs) {
      try {
        if (job === "zhihu") summary.push(await collectZhihu(page, keywords, server, token));
        else if (job === "xhs") summary.push(await collectXhs(page, keywords, server, token));
        else if (job === "xiaoheihe") summary.push(await collectXiaoheihe(page, keywords, server, token));
      } catch (err) {
        console.log("[" + job + "] 失败", String(err).slice(0, 200));
        summary.push(await reportFailure(server, token, SOURCE_IDS[job] || job, "抓取异常: " + String(err).slice(0, 140), "failed"));
      }
    }
  } finally {
    await close();
  }
  return summary;
}

async function isLoggedIn(page, site) {
  return page.evaluate((s) => {
    const text = document.body?.innerText || "";
    if (s === "xhs") return !/扫码登录|手机号登录|登录后查看搜索结果/.test(text) && Boolean(document.querySelector(".user, .side-bar-component .user, a[href*='/user/profile/']"));
    if (s === "zhihu") return !/登录\/注册|扫码登录/.test(text) && !location.pathname.includes("/signin");
    if (s === "xiaoheihe") return !/登录\/注册/.test(text) && Boolean(document.querySelector(".user-info, .avatar, .el-avatar"));
    return true;
  }, site).catch(() => false);
}

/** 弹出可见登录窗等待用户扫码（Cookie 仅留在本机 PROFILE_DIR），登完立即采集公开帖并关窗释放内存 */
async function interactiveLoginAndCollect(site, { server, token }) {
  const { page, close } = await openContext(false);
  try {
    await page.goto(LOGIN_URLS[site], { waitUntil: "domcontentloaded" });
    const deadline = Date.now() + 180_000;
    let logged = false;
    while (Date.now() < deadline) {
      if (page.isClosed()) break;
      if (await isLoggedIn(page, site)) {
        logged = true;
        break;
      }
      await sleep(1500);
    }
    if (!logged) throw new Error("等待登录超时或窗口已关闭（180s）");

    const keywords = await loadKeywords(server, token);
    let result;
    if (site === "zhihu") result = await collectZhihu(page, keywords, server, token);
    else if (site === "xhs") result = await collectXhs(page, keywords, server, token);
    else result = await collectXiaoheihe(page, keywords, server, token);
    return result;
  } finally {
    await close();
  }
}

function safeReturnUrl(raw, site) {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    u.searchParams.set("login_ok", site);
    return u.toString();
  } catch {
    return "";
  }
}

function renderHtml(title, bodyHtml, redirectTo = "") {
  const meta = redirectTo ? `<meta http-equiv="refresh" content="1;url=${redirectTo.replace(/"/g, "&quot;")}" />` : "";
  const script = redirectTo ? `<script>setTimeout(()=>location.replace(${JSON.stringify(redirectTo)}),800)</script>` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>${meta}<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 32px;max-width:460px;box-shadow:0 6px 24px rgba(15,23,42,.06)}h2{margin:0 0 10px;font-size:18px}p{margin:6px 0;color:#475569;font-size:14px;line-height:1.6}a{color:#2563eb;text-decoration:none;font-weight:500}</style></head><body><div class="card">${bodyHtml}</div>${script}</body></html>`;
}

let busy = false;

function startLoopbackServer() {
  const srv = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const u = new URL(req.url || "/", `http://${HELPER_HOST}:${HELPER_PORT}`);
    if (u.pathname === "/status") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, mode: "loopback-helper", busy, sites: Object.keys(SOURCE_IDS), hasDefaultToken: Boolean(DEFAULT_TOKEN) }));
      return;
    }

    if (u.pathname === "/login") {
      const site = u.searchParams.get("site") || "xhs";
      if (!LOGIN_URLS[site]) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(renderHtml("参数错误", `<h2>不支持的站点：${site}</h2>`));
        return;
      }
      if (busy) {
        res.writeHead(409, { "content-type": "text/html; charset=utf-8" });
        res.end(renderHtml("任务进行中", "<h2>已有登录或采集窗口正在运行</h2><p>请先完成或关闭当前浏览器窗口后再试。</p>"));
        return;
      }
      const server = (u.searchParams.get("server") || DEFAULT_SERVER).replace(/\/+$/, "");
      const token = (u.searchParams.get("token") || DEFAULT_TOKEN).trim();
      const back = safeReturnUrl(u.searchParams.get("return_to") || "", site);

      busy = true;
      try {
        const result = await interactiveLoginAndCollect(site, { server, token });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        const link = back ? `<p><a href="${back.replace(/"/g, "&quot;")}">立即返回白嫖雷达</a></p>` : "";
        res.end(renderHtml(
          "登录并采集完成",
          `<h2>已完成 ${site} 登录与公开帖子采集</h2><p>Cookie 仅保存在本机目录，未向服务器上传。浏览器已自动关闭释放内存。</p><p>回传结果：<code>${JSON.stringify(result)}</code></p>${link}`,
          back,
        ));
      } catch (err) {
        res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        res.end(renderHtml("登录未完成", `<h2>${site} 登录/采集未完成</h2><p>${String(err)}</p><p><a href="javascript:history.back()">返回上一页</a></p>`));
      } finally {
        busy = false;
      }
      return;
    }

    if (u.pathname === "/collect" && (req.method === "POST" || req.method === "GET")) {
      if (busy) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "busy" }));
        return;
      }
      const site = u.searchParams.get("site");
      const jobs = site && SOURCE_IDS[site] ? [site] : ["zhihu", "xhs", "xiaoheihe"];
      const server = (u.searchParams.get("server") || DEFAULT_SERVER).replace(/\/+$/, "");
      const token = (u.searchParams.get("token") || DEFAULT_TOKEN).trim();
      busy = true;
      try {
        const summary = await runJobs(jobs, { headless: true, server, token });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, summary }));
      } finally {
        busy = false;
      }
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Freebie Radar Loopback Helper");
  });

  srv.listen(HELPER_PORT, HELPER_HOST, () => {
    console.log(`[pw-helper] listening on http://${HELPER_HOST}:${HELPER_PORT} (Cookie 仅留本机: ${PROFILE_DIR})`);
  });

  if (COLLECT_INTERVAL_MIN > 0) {
    console.log(`[pw-helper] 定时无头采集已开启，每 ${COLLECT_INTERVAL_MIN} 分钟按需运行并释放浏览器`);
    setInterval(async () => {
      if (busy || !DEFAULT_TOKEN) return;
      busy = true;
      try {
        await runJobs(["zhihu", "xhs", "xiaoheihe"], { headless: true, server: DEFAULT_SERVER, token: DEFAULT_TOKEN });
      } finally {
        busy = false;
      }
    }, COLLECT_INTERVAL_MIN * 60_000).unref();
  }
}

const cmd = process.argv[2];
if (cmd === "serve") {
  startLoopbackServer();
} else {
  if (!DEFAULT_TOKEN) {
    console.error("缺少 INGEST_TOKEN：请在 .env 或环境变量里设置，需与服务器端一致");
    process.exit(1);
  }
  const jobs = cmd ? [cmd] : ["zhihu", "xhs", "xiaoheihe"];
  const summary = await runJobs(jobs, { headless: process.env.HEADLESS === "1", server: DEFAULT_SERVER, token: DEFAULT_TOKEN });
  console.log("SUMMARY", JSON.stringify(summary, null, 2));
}

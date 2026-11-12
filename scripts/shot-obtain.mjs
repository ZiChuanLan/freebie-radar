import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

// 同 shot.mjs：本地静态托管 dist/web，API 转发到远程
const REMOTE = "http://10.144.144.6:8788";
const DIST = "dist/web";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function proxy(url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(REMOTE + url, { signal: AbortSignal.timeout(60000) });
      return { status: r.status, ct: r.headers.get("content-type") ?? "application/json", body: Buffer.from(await r.arrayBuffer()) };
    } catch {
      await new Promise((res) => setTimeout(res, 1200));
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/")) {
    const r = await proxy(url);
    if (r) res.writeHead(r.status, { "content-type": r.ct }).end(r.body);
    else res.writeHead(502).end("{}");
    return;
  }
  let file = url.split("?")[0];
  if (file === "/" || !extname(file)) file = "/index.html";
  try {
    const buf = await readFile(join(DIST, file));
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(buf);
  } catch {
    res.writeHead(200, { "content-type": MIME[".html"] }).end(await readFile(join(DIST, "index.html")));
  }
});
await new Promise((r) => server.listen(8996, "127.0.0.1", r));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
});

await page.goto("http://127.0.0.1:8996/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => document.body.innerText.includes("条") && !document.body.innerText.includes("正在加载"), { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(1800);
await page.screenshot({ path: "docs/ui-obtain-feed.png" });

const info = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    articles: document.getElementsByTagName("article").length,
    hasObtainFilter: text.includes("获取方式"),
    hasLotteryBtn: text.includes("抽奖"),
    total: (text.match(/共\s*([\d,]+)\s*条/) ?? [])[1] ?? "",
  };
});
console.log("feed:", JSON.stringify(info));

// 切到「全部收录」再做一次，看历史条目上的获取方式徽章
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes("全部收录"));
  if (btn) btn.click();
});
await page.waitForTimeout(2500);
const all = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    articles: document.getElementsByTagName("article").length,
    badges: ["抽奖", "试用", "推广", "有条件"].filter((k) => text.includes(k)),
  };
});
console.log("all:", JSON.stringify(all));

// 点「抽奖」筛选，确认隔离出来的条目能单独查看
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === "抽奖");
  if (btn) btn.click();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: "docs/ui-obtain-lottery.png" });
const lot = await page.evaluate(() => ({
  articles: document.getElementsByTagName("article").length,
  total: (document.body.innerText.match(/共\s*([\d,]+)\s*条/) ?? [])[1] ?? "",
}));
console.log("lottery tab:", JSON.stringify(lot));

console.log("errors:", errors.length ? errors.slice(0, 3) : "none");
await browser.close();
server.close();


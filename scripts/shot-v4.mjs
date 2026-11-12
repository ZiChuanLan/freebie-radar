import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

// 无头 Chrome 连 Easytier 虚拟网卡时请求会挂起，本地静态服务 + Node 转发 API。
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
await new Promise((r) => server.listen(8995, "127.0.0.1", r));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1560, height: 1180 } });
const clickTab = (label) =>
  page.evaluate((lb) => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes(lb));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, label);

await page.goto("http://127.0.0.1:8995/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => document.getElementsByTagName("div").length > 50, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(6000);
await page.screenshot({ path: "docs/ui-v4-feed.png" });
console.log("feed rows:", await page.evaluate(() => document.querySelectorAll(".panel > div > div").length));

await clickTab("推送规则");
await page.waitForTimeout(4500);
await page.screenshot({ path: "docs/ui-v4-push.png" });

await clickTab("订阅与屏蔽");
await page.waitForTimeout(3500);
await page.screenshot({ path: "docs/ui-v4-rules.png" });

await clickTab("数据源运维");
await page.waitForTimeout(3500);
await page.screenshot({ path: "docs/ui-v4-ops.png" });

const errs = await page.evaluate(() => Array.from(document.querySelectorAll(".text-alert")).map((e) => e.textContent?.slice(0, 80)));
console.log("alerts:", JSON.stringify(errs.slice(0, 3)));
await browser.close();
server.close();

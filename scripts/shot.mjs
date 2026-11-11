import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

// 无头 Chrome 访问 Easytier 虚拟网卡时个别请求会挂起（curl/Node 都正常），
// 所以本地起 8997 静态服务托管 dist/web，API 由 Node 转发到远程。
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
      return {
        status: r.status,
        ct: r.headers.get("content-type") ?? "application/json",
        body: Buffer.from(await r.arrayBuffer()),
      };
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
await new Promise((r) => server.listen(8997, "127.0.0.1", r));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } });
const clickTab = (label) =>
  page.evaluate((lb) => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes(lb));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, label);

await page.goto("http://127.0.0.1:8997/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page
  .waitForFunction(() => document.getElementsByTagName("article").length > 0, { timeout: 45000 })
  .catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: "docs/ui-v2-feed.png" });
console.log("feed articles:", await page.evaluate(() => document.getElementsByTagName("article").length));

await clickTab("订阅与屏蔽");
await page.waitForTimeout(4000);
await page.screenshot({ path: "docs/ui-v2-rules.png" });
console.log("rules inputs:", await page.evaluate(() => document.getElementsByTagName("input").length));

await clickTab("运维");
await page.waitForTimeout(4000);
await page.screenshot({ path: "docs/ui-v2-ops.png" });
console.log("ops tr:", await page.evaluate(() => document.getElementsByTagName("tr").length));

await browser.close();
server.close();

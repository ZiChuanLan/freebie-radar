import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

// 无头 Chrome 连 Easytier 虚拟网卡时请求会挂起，本地起静态服务托管 dist/web，API 由 Node 转发。
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

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/")) {
    try {
      const r = await fetch(REMOTE + url, { signal: AbortSignal.timeout(60000) });
      const body = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" }).end(body);
    } catch {
      res.writeHead(502).end("{}");
    }
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
const page = await browser.newPage({ viewport: { width: 1440, height: 1240 } });

await page.goto("http://127.0.0.1:8996/#push", { waitUntil: "load", timeout: 30000 });
await page.waitForFunction(
  () => (document.body.innerText || "").includes("评分阈值"),
  { timeout: 25000 },
).catch(() => {});
await page.waitForTimeout(2500);

// 点一次「按当前设置算一遍」把预览跑出来
await page
  .evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("按当前设置算一遍"),
    );
    if (btn) btn.click();
  })
  .catch(() => {});
await page.waitForTimeout(3500);

await page.screenshot({ path: "docs/ui-v3-push.png" });
const info = await page.evaluate(() => ({
  hasSettings: (document.body.innerText || "").includes("静默时段"),
  hasPreview: (document.body.innerText || "").includes("立即推送（"),
  text: (document.body.innerText || "").slice(0, 200),
}));
console.log(JSON.stringify(info).slice(0, 400));

await browser.close();
server.close();

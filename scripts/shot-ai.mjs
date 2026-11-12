import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const REMOTE = "http://10.144.144.6:8788";
const DIST = "dist/web";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
async function proxy(url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await fetch(REMOTE + url, { signal: AbortSignal.timeout(60000) }); return { status: r.status, ct: r.headers.get("content-type") ?? "application/json", body: Buffer.from(await r.arrayBuffer()) }; }
    catch { await new Promise((res) => setTimeout(res, 1200)); }
  }
  return null;
}
const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/")) { const r = await proxy(url); if (r) res.writeHead(r.status, { "content-type": r.ct }).end(r.body); else res.writeHead(502).end("{}"); return; }
  let file = url.split("?")[0];
  if (file === "/" || !extname(file)) file = "/index.html";
  try { const buf = await readFile(join(DIST, file)); res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(buf); }
  catch { res.writeHead(200, { "content-type": MIME[".html"] }).end(await readFile(join(DIST, "index.html"))); }
});
await new Promise((r) => server.listen(8995, "127.0.0.1", r));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1280 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 220)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 220)); });
await page.goto("http://127.0.0.1:8995/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2000);
await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").includes("AI 引擎")); if (b) b.click(); });
await page.waitForFunction(() => document.body.innerText.includes("AI 二审引擎"), { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(4500);
await page.screenshot({ path: "docs/ui-ai-panel.png", fullPage: true });
const info = await page.evaluate(() => {
  const t = document.body.innerText;
  return { hasPanel: t.includes("AI 二审引擎"), hasConn: t.includes("连接配置"), hasDist: t.includes("判定分布"), hasRecent: t.includes("最近判定样本"), model: (t.match(/mercury[\w.-]*/) ?? [])[0] ?? "" };
});
console.log("ai panel:", JSON.stringify(info));
console.log("errors:", errors.length ? errors.slice(0, 3) : "none");
await browser.close();
server.close();

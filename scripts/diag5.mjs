import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const REMOTE = "http://10.144.144.6:8788";
const DIST = "dist/web";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/")) {
    try {
      const r = await fetch(REMOTE + url, { signal: AbortSignal.timeout(30000) });
      res.writeHead(r.status, { "content-type": "application/json" }).end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end("{}"); }
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
await new Promise((r) => server.listen(8998, "127.0.0.1", r));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 400)));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 400)); });
await page.goto("http://127.0.0.1:8998/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("goto:", String(e).slice(0, 80)));
await page.waitForTimeout(6000);
console.log("root:", await page.evaluate(() => (document.getElementById("root")?.innerHTML || "").length));
await browser.close();
server.close();

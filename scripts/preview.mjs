import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

// 本地起 dist/web 静态服务 + 转发 API 到 RN，供无头 Chrome 做设计检测与截图。
const REMOTE = "http://10.144.144.6:8788";
const DIST = "dist/web";
const PORT = Number(process.env.PORT ?? 8994);
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

server.listen(PORT, "127.0.0.1", () => console.log("preview on http://127.0.0.1:" + PORT));

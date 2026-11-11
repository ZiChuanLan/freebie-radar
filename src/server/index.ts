import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { config } from "./config.ts";
import { getDb, migrate } from "./db.ts";
import { registerApi } from "./routes.ts";
import { runAll } from "./collectors/index.ts";
import { runDaily } from "./digest.ts";
import { startIntervalScheduler, startScheduler } from "./cron.ts";

migrate();
const app = new Hono();
app.use("*", logger());

app.get("/health", (c) => {
  const row = getDb().prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  return c.json({
    ok: row?.ok === 1,
    version: "0.1.0",
    time: new Date().toISOString(),
    sources: config.enabledSources.length || "all",
  });
});

registerApi(app);

// Hono 的 serveStatic 的 root/path 都相对 process.cwd()，传绝对路径会拼出错误路径；
// 另外带 hash 的 assets 应该长缓存，index.html 必须 no-store，否则发版后用户会拿到旧 HTML 白屏。
const webDistAbs = fileURLToPath(new URL("../../dist/web", import.meta.url));
if (existsSync(webDistAbs)) {
  const relRoot = relative(process.cwd(), webDistAbs).split(sep).join("/") || ".";
  app.use(
    "/assets/*",
    serveStatic({
      root: relRoot,
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.use("/*", serveStatic({ root: relRoot }));
  app.get(
    "*",
    serveStatic({
      path: relRoot + "/index.html",
      onFound: (_path, c) => {
        c.header("Cache-Control", "no-store, must-revalidate");
      },
    }),
  );
} else {
  app.get("/", (c) => c.text("freebie-radar API 已启动。前端未构建，运行 pnpm build 或 pnpm dev:web。"));
}

if (config.enableScheduler) {
  // 采集：每个源按自己的 interval_sec 轮询（linux.do 90 秒，RSS 15 分钟，GitHub 6 小时）
  startIntervalScheduler();
  // 日报：仍然按 DAILY_CRON 触发
  startScheduler({
    collect: async () => undefined,
    daily: () => runDaily(),
  });
}
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[radar] listening on http://${config.host}:${info.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}

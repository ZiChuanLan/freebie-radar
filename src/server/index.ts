import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
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

const webDist = fileURLToPath(new URL("../../dist/web", import.meta.url));
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ path: `${webDist}/index.html` }));
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

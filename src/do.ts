import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { initConfig } from "./server/config.ts";
import { get, initDb, migrate, run } from "./server/db.ts";
import { registerApi } from "./server/routes.ts";
import { collectTick, cleanupTick, dailyTick } from "./server/cron.ts";
import { pushTick, startPushScheduler } from "./server/push.ts";
import { ensureSources } from "./server/collectors/index.ts";
import { releaseFlareSessionIfIdle } from "./server/flaresolverr.ts";

export type Env = {
  RADAR: DurableObjectNamespace<RadarDO>;
  ASSETS: Fetcher;
  [key: string]: string | Fetcher | DurableObjectNamespace<RadarDO> | undefined;
};

/**
 * 整个应用住在单例 DO 里：storage.sql 是同步 API，
 * 原 node:sqlite 的同步调用面（routes/collectors/enrich/push）原样可用。
 * HTTP /api/* 经 Worker 转发进来；Cron Trigger 每分钟调 tick()。
 */
export class RadarDO extends DurableObject<Env> {
  private app: Hono;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initConfig(env);
    initDb(ctx.storage);
    migrate();
    ensureSources();
    // 上次进程意外退出可能遗留 status='running' 的记录，启动时收口
    run(
      "UPDATE runs SET status = 'failed', finished_at = ?, error = COALESCE(error, '进程重启中断') WHERE status = 'running'",
      new Date().toISOString(),
    );

    const app = new Hono();
    app.use("*", logger());
    app.get("/health", (c) => {
      const row = get<{ ok: number }>("SELECT 1 AS ok");
      return c.json({
        ok: row?.ok === 1,
        version: "0.1.0",
        time: new Date().toISOString(),
        sources: "all",
      });
    });
    registerApi(app);
    this.app = app;

    startPushScheduler();
  }

  fetch(req: Request): Response | Promise<Response> {
    return this.app.fetch(req);
  }

  /** Cron Trigger 每分钟调用：due 源采集 → 攒批 flush → 日报 → 清理 → flare 会话回收 */
  async tick(): Promise<void> {
    await collectTick();
    await pushTick();
    await dailyTick();
    cleanupTick();
    await releaseFlareSessionIfIdle();
  }
}

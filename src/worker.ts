import type { Env } from "./do.ts";

export { RadarDO } from "./do.ts";

export default {
  /** /api 与 /health 进 DO；其余走静态资源（SPA fallback 由 assets 配置处理） */
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      const stub = env.RADAR.get(env.RADAR.idFromName("main"));
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },

  /** 每分钟唤醒 DO 的调度 tick；due 源查询决定真正跑哪些源 */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const stub = env.RADAR.get(env.RADAR.idFromName("main"));
    ctx.waitUntil(stub.tick());
  },
} satisfies ExportedHandler<Env>;

import { config } from "./config.ts";
import { decodeEntities } from "./enrich/normalize.ts";

export type FlareResult = { status: number; body: string; url: string };

const SESSION = "radar";

function endpointOf(base: string): string {
  return /\/v\d+$/.test(base) ? base : base.replace(/\/+$/, "") + "/v1";
}

type FlarePayload = {
  status?: string;
  message?: string;
  solution?: { status?: number; url?: string; response?: string };
};

async function post(endpoint: string, body: Record<string, unknown>, timeoutMs = config.flaresolverrTimeoutMs + 15_000): Promise<FlarePayload> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as FlarePayload;
  } catch {
    throw new Error(`FlareSolverr 返回非 JSON (${res.status}): ${text.slice(0, 160)}`);
  }
}

/**
 * session 状态：FlareSolverr 的 session 是一个常驻浏览器实例。
 * 建一次之后所有请求复用它，Cloudflare 的 clearance 会留在里面，
 * 后续请求从「启浏览器 + 解挑战」的 20-40 秒降到 1-2 秒。
 */
let sessionUp = false;
let lastSessionUse = 0;

async function ensureSession(endpoint: string): Promise<void> {
  // 超过 20 分钟没用过就重建一次，避免拿到已被回收的 session
  if (sessionUp && Date.now() - lastSessionUse < 20 * 60_000) return;
  const created = await post(endpoint, { cmd: "sessions.create", session: SESSION });
  // already exists 也算可用
  if (created.status !== "ok" && !/already exists/i.test(created.message ?? "")) {
    throw new Error(`创建 session 失败: ${created.message ?? created.status}`);
  }
  sessionUp = true;
  lastSessionUse = Date.now();
}

async function dropSession(endpoint: string): Promise<void> {
  sessionUp = false;
  try {
    await post(endpoint, { cmd: "sessions.destroy", session: SESSION });
  } catch {
    /* 销毁失败无所谓，下次会重建 */
  }
}

async function request(endpoint: string, url: string, timeoutMs: number, session: string | null): Promise<FlareResult> {
  const payloadBody: Record<string, unknown> = { cmd: "request.get", url, maxTimeout: timeoutMs };
  if (session) payloadBody.session = session;

  const payload = await post(endpoint, payloadBody, timeoutMs + 15_000);
  if (payload.status !== "ok" || !payload.solution) {
    throw new Error(
      `FlareSolverr 失败: ${payload.message ?? payload.status ?? "unknown"} (${JSON.stringify(payload).slice(0, 120)})`,
    );
  }
  const raw = String(payload.solution.response ?? "");
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(raw);
  lastSessionUse = Date.now();
  return {
    status: payload.solution.status ?? 0,
    url: payload.solution.url ?? url,
    body: pre ? decodeEntities(pre[1]!) : raw,
  };
}

/**
 * 通过 FlareSolverr 取页面。它自带 Chromium，能解 Cloudflare 挑战。
 *
 * 关键：必须用 session。不带 session 时每个请求都会新起一个浏览器，
 * linux.do 单次 40-70 秒；建了 session 之后复用同一个浏览器，降到 1-2 秒。
 */
export async function flaresolverrGet(url: string, timeoutMs = config.flaresolverrTimeoutMs): Promise<FlareResult> {
  if (!config.flaresolverrUrl) throw new Error("FLARESOLVERR_URL 未配置，无法访问被 Cloudflare 保护的源");
  const endpoint = endpointOf(config.flaresolverrUrl);

  await ensureSession(endpoint);
  try {
    return await request(endpoint, url, timeoutMs, SESSION);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // session 被回收或损坏：重建一次再试
    if (/session|not found|invalid/i.test(message)) {
      await dropSession(endpoint);
      await ensureSession(endpoint);
      return request(endpoint, url, timeoutMs, SESSION);
    }
    // 其他错误（挑战超时等）：退回无 session 单发，至少把这次拿到
    return request(endpoint, url, timeoutMs, null);
  }
}

export function hasFlare(): boolean {
  return Boolean(config.flaresolverrUrl);
}

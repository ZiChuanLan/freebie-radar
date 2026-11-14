import { config } from "./config.ts";
import { decodeEntities } from "./enrich/normalize.ts";

export type FlareResult = { status: number; body: string; url: string };

const SESSION = "radar";
/** 空闲 90 秒后自动销毁 FlareSolverr 浏览器实例，避免 Chromium 长期常驻吃掉 300MB+ 内存 */
const SESSION_IDLE_MS = 90_000;

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

let sessionUp = false;
let lastSessionUse = 0;
let sessionEndpoint = "";

function touchSessionIdle(endpoint: string): void {
  lastSessionUse = Date.now();
  sessionEndpoint = endpoint;
}

async function ensureSession(endpoint: string): Promise<void> {
  if (sessionUp && Date.now() - lastSessionUse < 20 * 60_000) return;
  const created = await post(endpoint, { cmd: "sessions.create", session: SESSION });
  if (created.status !== "ok" && !/already exists/i.test(created.message ?? "")) {
    throw new Error(`创建 session 失败: ${created.message ?? created.status}`);
  }
  sessionUp = true;
  touchSessionIdle(endpoint);
}

async function dropSession(endpoint: string): Promise<void> {
  sessionUp = false;
  try {
    await post(endpoint, { cmd: "sessions.destroy", session: SESSION }, 10_000);
  } catch {
    /* 销毁失败无所谓，下次会重建 */
  }
}

export async function releaseFlareSession(): Promise<void> {
  if (!sessionUp || !config.flaresolverrUrl) return;
  await dropSession(endpointOf(config.flaresolverrUrl));
}

/** CF 版：setTimeout 没了，空闲检测由 DO.tick() 每分钟调用 —— 超过 90s 没用就销毁会话 */
export async function releaseFlareSessionIfIdle(now = Date.now()): Promise<void> {
  if (sessionUp && sessionEndpoint && now - lastSessionUse >= SESSION_IDLE_MS) {
    await dropSession(sessionEndpoint);
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
  if (session) touchSessionIdle(endpoint);
  return {
    status: payload.solution.status ?? 0,
    url: payload.solution.url ?? url,
    body: pre ? decodeEntities(pre[1]!) : raw,
  };
}

/**
 * 通过 FlareSolverr 取页面。使用 session 复用并在空闲 90 秒后自动销毁释放浏览器内存。
 */
export async function flaresolverrGet(url: string, timeoutMs = config.flaresolverrTimeoutMs): Promise<FlareResult> {
  if (!config.flaresolverrUrl) throw new Error("FLARESOLVERR_URL 未配置，无法访问被 Cloudflare 保护的源");
  const endpoint = endpointOf(config.flaresolverrUrl);

  await ensureSession(endpoint);
  try {
    return await request(endpoint, url, timeoutMs, SESSION);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/session|not found|invalid/i.test(message)) {
      await dropSession(endpoint);
      await ensureSession(endpoint);
      return request(endpoint, url, timeoutMs, SESSION);
    }
    return request(endpoint, url, timeoutMs, null);
  }
}

export function hasFlare(): boolean {
  return Boolean(config.flaresolverrUrl);
}

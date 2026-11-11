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

async function request(endpoint: string, url: string, timeoutMs: number, session: string | null): Promise<FlareResult> {
  const payloadBody: Record<string, unknown> = { cmd: "request.get", url, maxTimeout: timeoutMs };
  if (session) payloadBody.session = session;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payloadBody),
  });
  const text = await res.text();
  let payload: FlarePayload;
  try {
    payload = JSON.parse(text) as FlarePayload;
  } catch {
    throw new Error(`FlareSolverr 返回非 JSON (${res.status}): ${text.slice(0, 160)}`);
  }
  if (payload.status !== "ok" || !payload.solution) {
    throw new Error(`FlareSolverr 失败: ${payload.message ?? payload.status ?? "unknown"} (${text.slice(0, 120)})`);
  }
  const raw = String(payload.solution.response ?? "");
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(raw);
  return {
    status: payload.solution.status ?? 0,
    url: payload.solution.url ?? url,
    body: pre ? decodeEntities(pre[1]!) : raw,
  };
}

/**
 * 通过 FlareSolverr 取页面。它自带 Chromium，能解 Cloudflare 挑战。
 * 复用同一个 session，避免每次请求都重新解挑战（首次慢，之后几秒）。
 */
export async function flaresolverrGet(url: string, timeoutMs = config.flaresolverrTimeoutMs): Promise<FlareResult> {
  if (!config.flaresolverrUrl) throw new Error("FLARESOLVERR_URL 未配置，无法访问被 Cloudflare 保护的源");
  const endpoint = endpointOf(config.flaresolverrUrl);

  try {
    return await request(endpoint, url, timeoutMs, SESSION);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/session/i.test(message)) throw err;
    return request(endpoint, url, timeoutMs, null);
  }
}

export function hasFlare(): boolean {
  return Boolean(config.flaresolverrUrl);
}

/**
 * 管理端凭据：只存在 sessionStorage，关掉标签页就没了。
 * 用全局 fetch 包装统一带上 Authorization，避免每个调用点都要改。
 */
const KEY = "radar-admin-token";

export function getToken(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    /* 隐私模式下不可用，退化为不保存 */
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
}

let installed = false;

/** 在 main.tsx 里调用一次：所有 fetch 自动附带管理密码。 */
export function installAuthFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const token = getToken();
    if (!token) return orig(input, init);
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    return orig(input, { ...init, headers });
  }) as typeof fetch;
}

/** 验证密码：命中返回 true。 */
export async function verifyToken(token: string): Promise<boolean> {
  const r = await fetch("/api/auth/check", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  // 真正需要密码的接口再探一次，确认有权限
  const probe = await fetch("/api/push", { headers: { authorization: `Bearer ${token}` } });
  if (probe.status === 401) return false;
  return true;
}

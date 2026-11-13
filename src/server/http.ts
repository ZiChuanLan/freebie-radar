import { spawn, spawnSync } from "node:child_process";
import { config } from "./config.ts";

export type FetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  redirect?: RequestRedirect;
};

export type HttpResponse = {
  status: number;
  url: string;
  headers: Headers;
  body: string;
  bytes: Buffer;
  contentType: string;
};

export type HttpClient = {
  raw(url: string, opts?: FetchOptions): Promise<HttpResponse>;
  json<T>(url: string, opts?: FetchOptions): Promise<{ status: number; url: string; data: T; response: HttpResponse }>;
  text(url: string, opts?: FetchOptions): Promise<HttpResponse>;
};

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function decode(bytes: Buffer, contentType: string): string {
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      /* 落到 utf-8 */
    }
  }
  const head = bytes.subarray(0, 400).toString("utf8");
  const xmlCharset = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase();
  if (xmlCharset && xmlCharset !== "utf-8" && xmlCharset !== "utf8") {
    try {
      return new TextDecoder(xmlCharset).decode(bytes);
    } catch {
      /* ignore */
    }
  }
  return bytes.toString("utf8");
}

let dispatcherPromise: Promise<unknown> | null = null;
async function getDispatcher(proxy: string): Promise<unknown> {
  if (!dispatcherPromise) {
    dispatcherPromise = (async () => {
      const undici = (await import("undici")) as unknown as { ProxyAgent: new (url: string) => unknown };
      return new undici.ProxyAgent(proxy);
    })();
  }
  return dispatcherPromise;
}
/**
 * curl 优先：Node 的 undici 有独立 TLS 指纹，Cloudflare 会单独给它 403。
 * 实测 linux.do RSS：curl 200 / 511ms，node fetch 403 / "Just a moment..."。
 * 容器镜像里装了 curl；本地 Windows 开发时 CURL_OK=false，自动走 fetch。
 */
const CURL_OK = (() => {
  try {
    return spawnSync("curl", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
})();

async function viaCurl(url: string, opts: FetchOptions, timeoutMs: number): Promise<HttpResponse> {
  const args = [
    "-sS",
    "--compressed",
    "--max-time",
    String(Math.max(1, Math.round(timeoutMs / 1000))),
    "-A",
    DEFAULT_UA,
    "-H",
    "accept-language: zh-CN,zh;q=0.9,en;q=0.8",
    "-H",
    "accept: text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
    "-w",
    "\n__STATUS__%{http_code}\n__CT__%{content_type}\n__URL__%{url_effective}",
  ];
  if ((opts.method ?? "GET") !== "GET") args.push("-X", opts.method!);
  for (const [k, v] of Object.entries(opts.headers ?? {})) args.push("-H", `${k}: ${v}`);
  if (opts.body) args.push("--data-binary", opts.body);
  args.push(url);

  return new Promise<HttpResponse>((resolve, reject) => {
    const child = spawn("curl", args);
    const chunks: Buffer[] = [];
    const errs: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => errs.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("curl exit " + code + ": " + Buffer.concat(errs).toString("utf8").slice(0, 160)));
        return;
      }
      const out = Buffer.concat(chunks);
      const text = out.toString("utf8");
      const m = /\n__STATUS__(\d+)\n__CT__([^\n]*)\n__URL__(.*)$/s.exec(text);
      if (!m) {
        reject(new Error("curl 输出无法解析"));
        return;
      }
      const bodyBytes = out.subarray(0, out.length - Buffer.byteLength(m[0], "utf8"));
      const contentType = m[2] ?? "";
      resolve({
        status: Number(m[1]),
        url: m[3] || url,
        headers: new Headers(contentType ? { "content-type": contentType } : {}),
        bytes: bodyBytes,
        body: decode(bodyBytes, contentType),
        contentType,
      });
    });
  });
}


export function createHttp(options: { proxy?: string; timeoutMs?: number; gapMs?: number; userAgent?: string } = {}): HttpClient {
  const proxy = options.proxy ?? "";
  const timeoutMs = options.timeoutMs ?? config.fetchTimeoutMs;
  const gapMs = options.gapMs ?? config.minRequestGapMs;
  const ua = options.userAgent ?? DEFAULT_UA;
  let lastAt = 0;

  async function waitGap() {
    const wait = lastAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  }

  /**
   * 直连抓取。优先用 curl —— 不是图省事，是 Node 的 undici 有自己的 TLS 指纹，
   * 像 linux.do 这种 Cloudflare 站点会给 curl 200、给 node fetch 403。
   * curl 不可用（本地 Windows 开发）时回退到 fetch。
   */
  async function raw(url: string, opts: FetchOptions = {}): Promise<HttpResponse> {
    await waitGap();
    const timeout = opts.timeoutMs ?? timeoutMs;

    if (CURL_OK) {
      try {
        return await viaCurl(url, opts, timeout);
      } catch {
        /* curl 失败就落到 fetch */
      }
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    const init: RequestInit & { dispatcher?: unknown } = {
      method: opts.method ?? "GET",
      headers: {
        "user-agent": ua,
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
        ...opts.headers,
      },
      redirect: opts.redirect ?? "follow",
      signal: ac.signal,
      body: opts.body,
    };
    try {
      const res = await fetch(url, init);
      const bytes = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "";
      return {
        status: res.status,
        url: res.url || url,
        headers: res.headers,
        bytes,
        body: decode(bytes, contentType),
        contentType,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    raw,
    text: raw,
    async json<T>(url: string, opts: FetchOptions = {}) {
      const response = await raw(url, { ...opts, headers: { accept: "application/json", ...opts.headers } });
      let data: T;
      try {
        data = JSON.parse(response.body) as T;
      } catch {
        throw new Error(`invalid JSON from ${url}: ${response.body.slice(0, 120)}`);
      }
      return { status: response.status, url: response.url, data, response };
    },
  };
}

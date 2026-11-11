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

  async function raw(url: string, opts: FetchOptions = {}): Promise<HttpResponse> {
    await waitGap();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? timeoutMs);
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
    if (proxy) init.dispatcher = await getDispatcher(proxy);
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

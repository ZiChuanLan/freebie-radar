import type { HttpClient } from "../http.ts";

export type RawItem = {
  externalId: string;
  url: string;
  title: string;
  summary?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
  tags?: string[];
  /** 来源自带的结构化分类提示（例如 GitHub 清单的分节名） */
  categoryHint?: string | null;
  /** 正文全文（可选，用于抽取兑换码与留档，避免原帖被删后信息丢失） */
  content?: string | null;
  /** 封面/缩略图 URL（可选，仅限合法 http(s) 地址） */
  imageUrl?: string | null;
  raw?: unknown;
};

export type SourceSeed = {
  id: string;
  name: string;
  kind: string;
  enabled?: boolean;
  /** 采集间隔（秒）。越小越及时；送码类源建议 60-120 秒 */
  intervalSec?: number;
  config?: Record<string, unknown>;
};

export type CollectContext = {
  sourceId: string;
  config: Record<string, unknown>;
  cursor: string | null;
  maxItems: number;
  http: HttpClient;
  log: (message: string) => void;
};

export type CollectResult = {
  items: RawItem[];
  /** 下一次采集的起点（翻页 token / 最后一条 id） */
  cursor?: string | null;
  /** 部分成功时写明降级原因，例如某板块 403 */
  degraded?: string | null;
};

export type Collector = {
  kind: string;
  label: string;
  defaults?: { config?: Record<string, unknown>; enabled?: boolean };
  collect(ctx: CollectContext): Promise<CollectResult>;
};

export type Item = {
  id: number;
  source_id: string;
  external_id: string;
  url: string;
  title: string;
  summary: string | null;
  author: string | null;
  category: string | null;
  tags: string[];
  codes: string[];
  content: string | null;
  price: number | null;
  is_free: number;
  matched: string[];
  blockedBy?: string | null;
  score: number;
  expires_at: string | null;
  published_at: string | null;
  pushed_at: string | null;
  read_at?: string | null;
  read: boolean;
  status: string;
  starred: boolean;
  ai: { keep?: boolean; reason?: string; category?: string } | null;
  first_seen_at: string;
  last_seen_at: string;
};

export type Stats = {
  totals: {
    total: number;
    active: number;
    starred: number;
    expired: number;
    withCodes: number;
    unread: number;
    last24h: number;
    blockRules: number;
  };
  byCategory: { category: string | null; n: number }[];
  bySource: { source_id: string; n: number }[];
  price?: { free: number; under5: number; under10: number; known: number };
  features: { ai: boolean; push: boolean; pushChannel: string };
};

export type Source = {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  interval_sec: number;
  config: Record<string, unknown>;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  items: number;
  latest_item_at: string | null;
};

export type Run = {
  id: number;
  source_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  fetched: number;
  inserted: number;
  skipped: number;
  duration_ms: number | null;
  error: string | null;
};

export type BlockRule = {
  id: number;
  pattern: string;
  mode: "keyword" | "regex";
  scope: string;
  enabled: boolean;
  created_at: string;
  hits: number;
};

export type BlockPreset = {
  pattern: string;
  mode: "keyword" | "regex";
  scope: string;
  note: string;
};

export type Subscription = {
  id: number;
  keyword: string;
  created_at: string;
  last_hit_at: string | null;
};

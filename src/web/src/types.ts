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
  /** 获取方式：free 直接白嫖 / conditional 有条件 / lottery 抽奖 / trial 试用 / promo 推广 / paid 需付费 */
  obtain: string | null;
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
    aiKept: number;
    aiRejected: number;
    cleanFree: number;
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

export type PushSettings = {
  enabled: boolean;
  instantScore: number;
  batchScore: number;
  instantOnCodes: boolean;
  instantOnUrgent: boolean;
  maxPerHour: number;
  maxPerInstant: number;
  batchIntervalMin: number;
  maxPerBatch: number;
  quietHours: string;
  timezone: string;
  langMode: "all" | "zh" | "en";
  includePrice: boolean;
  includeDeadline: boolean;
  dedupeByTitle: boolean;
  maxPrice: number | null;
  onlyAiKeep: boolean;
  obtainModes: string[];
  categories: string[];
  prioritizeSubscribed: boolean;
  applyToDigest: boolean;
};

export type PushPayload = {
  settings: PushSettings;
  defaults: PushSettings;
  stats: {
    pushedLastHour: number;
    pushedLast24h: number;
    totalPushed: number;
    queued: number;
    lastHourLogs: number;
    failures: number;
  };
  channel: string;
  ready: boolean;
  quiet: boolean;
};

export type PushLogItem = {
  id: number;
  kind: string;
  item_ids: string;
  text: string;
  count: number;
  ok: number;
  error: string | null;
  created_at: string;
};

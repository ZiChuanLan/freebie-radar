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
  score: number;
  expires_at: string | null;
  published_at: string | null;
  status: string;
  starred: boolean;
  ai: { keep?: boolean; reason?: string; category?: string } | null;
  matched?: string[];
  codes?: string[];
  content?: string | null;
  pushed_at?: string | null;
  price?: number | null;
  is_free?: number;
  first_seen_at: string;
  last_seen_at: string;
};

export type Stats = {
  totals: { total: number; active: number; starred: number; expired: number; last24h: number };
  byCategory: { category: string | null; n: number }[];
  bySource: { source_id: string; n: number }[];
  features: { ai: boolean; push: boolean; pushChannel: string };
  price?: { free: number; under5: number; under10: number; known: number };
};

export type Source = {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
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

export type ItemsQuery = {
  search?: string;
  source?: string;
  category?: string;
  sort?: string;
  status?: string;
  starred?: string;
  unexpired?: string;
  subscribed?: string;
  expiring?: string;
  maxPrice?: string;
  freeOnly?: string;
  limit?: number;
  offset?: number;
};

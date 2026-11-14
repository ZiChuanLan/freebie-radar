export type Item = {
  id: number;
  source_id: string;
  external_id: string;
  url: string;
  title: string;
  summary: string | null;
  author: string | null;
  category: string | null;
  kind?: string | null;
  ai_quality?: number | null;
  image_url?: string | null;
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
  ai: { keep?: boolean; reason?: string; category?: string; obtain?: string; quality?: number } | null;
  first_seen_at: string;
  last_seen_at: string;
  /** 同一福利被多少个源报道（1 = 只有这一条） */
  dupCount?: number;
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
  byKind?: { kind: string | null; n: number }[];
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

export type PushTiming = "wait_ai" | "instant_first";
export type AiFallbackMode = "strict" | "rule_fallback" | "ignore_ai";
export type PushSourceMode = "all" | "include" | "exclude";
export type QuietAction = "batch" | "drop";

export type PushSettings = {
  enabled: boolean;
  pushTiming: PushTiming;
  syncPrePushLimit: number;
  pushAfterBackfill: boolean;
  aiFallbackMode: AiFallbackMode;
  onlyAiKeep: boolean;
  instantScore: number;
  batchScore: number;
  instantOnCodes: boolean;
  instantOnUrgent: boolean;
  maxPerHour: number;
  maxPerInstant: number;
  batchIntervalMin: number;
  maxPerBatch: number;
  quietEnabled: boolean;
  quietHours: string;
  quietAction: QuietAction;
  timezone: string;
  maxAgeHours: number;
  langMode: "all" | "zh" | "en";
  sourceMode: PushSourceMode;
  sourceIds: string[];
  includePrice: boolean;
  includeDeadline: boolean;
  includeScore: boolean;
  includeObtain: boolean;
  includeAiReason: boolean;
  customHeader: string;
  dedupeByTitle: boolean;
  maxPrice: number | null;
  obtainModes: string[];
  kinds: string[];
  routes: PushRoute[];
  categories: string[];
  prioritizeSubscribed: boolean;
  applyToDigest: boolean;
};

export type PushRoute = {
  id: string;
  name: string;
  enabled: boolean;
  kinds: string[];
  categories: string[];
  obtainModes: string[];
  keywords: string[];
  maxPrice: number | null;
  minScore: number;
  instant: boolean;
  header?: string;
};

export type PushPreview = {
  instant: string[];
  batch: string[];
  queued: number;
  scanned: number;
  matched: number;
  rejectedBy?: Record<string, number>;
  /** 够格「即时」的总条数（不受展示条数限制） */
  instantTotal: number;
  /** 按每轮即时上限与小时额度，这一批实际能即时发出的条数 */
  sendableInstant: number;
  /** 够格「攒批」的总条数（已含被即时上限挤过来的部分） */
  batchTotal: number;
  /** 被即时上限挤进攒批队列的条数 */
  deferred: number;
  usedThisHour: number;
  caps: { maxPerInstant: number; maxPerHour: number; maxPerBatch: number; batchIntervalMin: number; budget: number };
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

/* --- AI 语义审核配置 --- */

export type AiSourceMode = "all" | "exclude" | "only";

export type AiSettings = {
  enabled: boolean;
  baseUrl: string;
  /** 只在本地表单里用；服务端返回的是打码值 */
  apiKey: string;
  model: string;
  maxItems: number;
  batchSize: number;
  concurrency: number;
  timeoutSec: number;
  preFilterEnabled: boolean;
  customNoiseKeywords: string[];
  skipFreebieSources: boolean;
  sourceMode: AiSourceMode;
  sourceIds: string[];
  extraPrompt: string;
  /** 空字符串表示用内置默认 */
  systemPrompt: string;
  learnFromFeedback: boolean;
  feedbackLimit: number;
  hasKey: boolean;
  keyHint: string;
  ready: boolean;
  promptIsDefault: boolean;
  defaultPrompt: string;
  reviewBeforePush?: boolean;
  syncPrePushLimit?: number;
};

export type AiStats = {
  kept: number;
  rejected: number;
  pending: number;
  queue?: { queued: number; processed: number; dropped: number; running: boolean };
  byKind?: { kind: string; n: number }[];
  byCategory: { category: string; n: number }[];
  recent: {
    id: number;
    sourceId?: string;
    title: string;
    score: number;
    keep: boolean | null;
    kind?: string;
    reason: string;
    category: string;
    obtain?: string;
    quality?: number | null;
    reviewedAt?: string;
  }[];
  blockedSkipped?: number;
  telemetry?: AiTelemetry;
};

export type AiStage = "sync" | "queue" | "backfill" | "test";

export type AiLiveEvent = {
  title: string;
  keep: boolean;
  kind: string;
  category: string;
  quality: number | null;
  reason: string;
  at: string;
};

export type AiActiveJob = {
  id: string;
  stage: AiStage;
  label: string;
  sourceId?: string;
  model: string;
  total: number;
  done: number;
  kept: number;
  rejected: number;
  failed: number;
  totalBatches: number;
  completedBatches: number;
  startedAt: string;
  recentEvents: AiLiveEvent[];
};

export type AiRunRecord = {
  id: string;
  stage: AiStage;
  label: string;
  sourceId?: string;
  model: string;
  total: number;
  reviewed: number;
  kept: number;
  rejected: number;
  skippedBlocked?: number;
  failed: number;
  durationMs: number;
  ttfbAvgMs: number | null;
  finishedAt: string;
  error?: string;
};

export type AiTelemetry = {
  active: AiActiveJob[];
  history: AiRunRecord[];
};

export type AiPayload = {
  settings: AiSettings;
  stats: AiStats;
  feedback?: {
    positive: number;
    negative: number;
    positiveSamples?: string[];
    negativeSamples?: string[];
  };
};

/* --- 数据保留策略 --- */

export type RetentionSettings = {
  itemDays: number;
  keptDays: number;
  ignoredDays: number;
  pushLogDays: number;
  digestDays: number;
  auto: boolean;
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
  /** 为什么推它：命中哪条规则、分数多少 */
  reason: string | null;
};

/* --- 今日热点 --- */

export type HotScope = "all" | "deals" | "news" | "info";
export type HotWord = { w: string; n: number; prev: number; delta: number };
export type HotBucket = { key: string; n: number; prev: number; delta: number };

export type HotTopItem = {
  id: number;
  title: string;
  url: string;
  source_id: string;
  category: string | null;
  kind: string | null;
  obtain?: string | null;
  score: number;
  quality: number | null;
  dupCount?: number;
};

export type HotReport = {
  windowHours: number;
  scope: HotScope;
  from: string;
  to: string;
  scanned: number;
  prevScanned: number;
  rawScanned?: number;
  words: HotWord[];
  categories: HotBucket[];
  kinds: HotBucket[];
  top: HotTopItem[];
  topNews?: HotTopItem[];
};

/* --- 来源质量榜 --- */

export type SourceQuality = {
  id: string;
  name: string;
  total: number;
  reviewed: number;
  kept: number;
  rejected: number;
  keepRate: number | null;
  avgQuality: number | null;
  pushed: number;
  lastRun: string | null;
  enabled: number;
  lastError: string | null;
};

/**
 * 配置来源：Worker 下是 env bindings（initConfig 在 DO 构造时调用），
 * Node 脚本（tests/scripts）下退回 process.env。
 * config 是可变对象：initConfig 会整体覆盖字段值，import 时先给 process.env 一份。
 */

type EnvSource = Record<string, unknown>;

const procEnv: EnvSource =
  typeof process !== "undefined" && process.env ? (process.env as EnvSource) : {};

const str = (env: EnvSource, key: string, fallback = "") => {
  const v = env[key];
  return typeof v === "string" ? v.trim() : fallback;
};
const num = (env: EnvSource, key: string, fallback: number) => {
  const raw = Number(str(env, key));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};
const bool = (env: EnvSource, key: string, fallback: boolean) => {
  const raw = str(env, key).toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

function build(env: EnvSource) {
  return {
    databasePath: str(env, "DATABASE_PATH", "./data/radar.db"),

    httpProxy: str(env, "HTTP_PROXY"),
    httpsProxy: str(env, "HTTPS_PROXY"),
    fetchTimeoutMs: num(env, "FETCH_TIMEOUT_MS", 20_000),
    minRequestGapMs: num(env, "MIN_REQUEST_GAP_MS", 2_000),
    /** 源与源之间的间隔，避免 Reddit 一类站点因同 IP 连续请求返回 429 */
    sourceGapMs: num(env, "SOURCE_GAP_MS", 3_000),

    flaresolverrUrl: str(env, "FLARESOLVERR_URL"),
    flaresolverrTimeoutMs: num(env, "FLARESOLVERR_TIMEOUT_MS", 60_000),

    enabledSources: str(env, "ENABLED_SOURCES")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    maxItemsPerRun: num(env, "MAX_ITEMS_PER_RUN", 50),

    githubToken: str(env, "GITHUB_TOKEN"),

    collectCron: str(env, "COLLECT_CRON", "0 */2 * * *"),
    dailyCron: str(env, "DAILY_CRON", "30 8 * * *"),
    enableScheduler: bool(env, "ENABLE_SCHEDULER", true),

    dailyTopN: num(env, "DAILY_TOP_N", 12),
    publicBaseUrl: str(env, "PUBLIC_BASE_URL"),
    pushChannel: str(env, "PUSH_CHANNEL", "none"),
    telegramBotToken: str(env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId: str(env, "TELEGRAM_CHAT_ID"),
    telegramApiBase: str(env, "TELEGRAM_API_BASE", "https://api.telegram.org"),
    telegramProxy: str(env, "TELEGRAM_PROXY"),

    aiBaseUrl: str(env, "AI_BASE_URL"),
    aiApiKey: str(env, "AI_API_KEY"),
    aiModel: str(env, "AI_MODEL"),
    aiMaxItems: num(env, "AI_MAX_ITEMS", 60),

    ingestToken: str(env, "INGEST_TOKEN"),
    /** 管理端密码；留空则管理接口全部开放（向后兼容） */
    adminToken: str(env, "ADMIN_TOKEN"),
  };
}

export const config = build(procEnv);

export let aiEnabled = Boolean(config.aiBaseUrl && config.aiModel);
export let pushEnabled = config.pushChannel !== "none" && Boolean(config.telegramBotToken && config.telegramChatId);

/** DO 构造时调用：把 env bindings 灌进 config（vars 与 secrets 都在 env 上） */
export function initConfig(env: EnvSource): void {
  Object.assign(config, build(env));
  aiEnabled = Boolean(config.aiBaseUrl && config.aiModel);
  pushEnabled = config.pushChannel !== "none" && Boolean(config.telegramBotToken && config.telegramChatId);
}

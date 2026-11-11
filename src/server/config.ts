import { existsSync } from "node:fs";
import { resolve } from "node:path";

// 只加载一次；容器里通常直接用真实环境变量
for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      /* 忽略损坏的 env 文件 */
    }
  }
}

const str = (key: string, fallback = "") => (process.env[key] ?? fallback).trim();
const num = (key: string, fallback: number) => {
  const raw = Number(str(key));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};
const bool = (key: string, fallback: boolean) => {
  const raw = str(key).toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

export const config = {
  port: num("PORT", 8788),
  host: str("HOST", "0.0.0.0"),
  databasePath: str("DATABASE_PATH", "./data/radar.db"),
  databaseDir: str("DATABASE_DIR", ""),

  httpProxy: str("HTTP_PROXY"),
  httpsProxy: str("HTTPS_PROXY"),
  fetchTimeoutMs: num("FETCH_TIMEOUT_MS", 20_000),
  minRequestGapMs: num("MIN_REQUEST_GAP_MS", 2_000),

  flaresolverrUrl: str("FLARESOLVERR_URL"),
  flaresolverrTimeoutMs: num("FLARESOLVERR_TIMEOUT_MS", 60_000),

  enabledSources: str("ENABLED_SOURCES")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  maxItemsPerRun: num("MAX_ITEMS_PER_RUN", 50),

  githubToken: str("GITHUB_TOKEN"),

  collectCron: str("COLLECT_CRON", "0 */2 * * *"),
  dailyCron: str("DAILY_CRON", "30 8 * * *"),
  enableScheduler: bool("ENABLE_SCHEDULER", true),

  dailyTopN: num("DAILY_TOP_N", 12),
  publicBaseUrl: str("PUBLIC_BASE_URL"),
  pushChannel: str("PUSH_CHANNEL", "none"),
  telegramBotToken: str("TELEGRAM_BOT_TOKEN"),
  telegramChatId: str("TELEGRAM_CHAT_ID"),
  telegramApiBase: str("TELEGRAM_API_BASE", "https://api.telegram.org"),
  telegramProxy: str("TELEGRAM_PROXY"),

  aiBaseUrl: str("AI_BASE_URL"),
  aiApiKey: str("AI_API_KEY"),
  aiModel: str("AI_MODEL"),
  aiMaxItems: num("AI_MAX_ITEMS", 20),
} as const;

export const aiEnabled = Boolean(config.aiBaseUrl && config.aiModel);
export const pushEnabled = config.pushChannel !== "none" && Boolean(config.telegramBotToken && config.telegramChatId);

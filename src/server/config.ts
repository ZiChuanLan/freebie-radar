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
  host: str("HOST", "127.0.0.1"),
  databasePath: str("DATABASE_PATH", "./data/radar.db"),
  databaseDir: str("DATABASE_DIR", ""),

  httpProxy: str("HTTP_PROXY"),
  httpsProxy: str("HTTPS_PROXY"),
  fetchTimeoutMs: num("FETCH_TIMEOUT_MS", 20_000),
  minRequestGapMs: num("MIN_REQUEST_GAP_MS", 2_000),
  /** 源与源之间的间隔，避免 Reddit 一类站点因同 IP 连续请求返回 429 */
  sourceGapMs: num("SOURCE_GAP_MS", 3_000),

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

  /** AI 协议：留空沿用 /chat/completions；response 使用 /responses。 */
  aiProtocol: str("AI_PROTOCOL"),
  aiBaseUrl: str("AI_BASE_URL"),
  aiApiKey: str("AI_API_KEY"),
  aiModel: str("AI_MODEL"),
  aiMaxItems: num("AI_MAX_ITEMS", 60),
  // 云端提示词：留空即关闭。指向 GitHub raw 时，改提示词不用发版
  promptUrl: str("PROMPT_URL"),
  promptExtraUrl: str("PROMPT_EXTRA_URL"),
  // 0 = 只在启动时同步一次
  promptSyncMinutes: (() => {
    const raw = str("PROMPT_SYNC_MINUTES");
    if (!raw) return 10;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 10;
  })(),

  ingestToken: str("INGEST_TOKEN"),
  /** VPS 按需无头 Cookie 执行器地址（仅内网/网桥监听，平时 0 MB 浏览器内存） */
  cookieRunnerUrl: str("COOKIE_RUNNER_URL", "http://172.17.0.1:18790"),
  /** 独立部署的 Epic 喜加一领取器地址；留空则运维面板不显示外部工具入口 */
  epicClaimerUrl: str("EPIC_CLAIMER_URL"),
  /** 小红书国内代理出口（如 http://47.110.65.20:8888），供香港/海外 VPS 绕开国际版跳转 */
  xhsProxyUrl: str("XHS_PROXY_URL"),
  /**
   * 站点形态：selfhost = 单人自建（全局状态，行为与旧版一致）；
   * public = 公开站（公共内容只读共享，个人状态按登录用户隔离）；
   * auto = 配了 LINUXDO_CLIENT_ID 就按 public，否则 selfhost。
   */
  siteMode: str("SITE_MODE", "auto"),

  /* ---- LINUX DO Connect OAuth2 ---- */
  linuxdoClientId: str("LINUXDO_CLIENT_ID"),
  linuxdoClientSecret: str("LINUXDO_CLIENT_SECRET"),
  linuxdoRedirectUri: str("LINUXDO_REDIRECT_URI"),
  linuxdoMinTrustLevel: num("LINUXDO_MIN_TRUST_LEVEL", 0),
  linuxdoAuthorizeUrl: str("LINUXDO_AUTHORIZE_URL", "https://connect.linux.do/oauth2/authorize"),
  linuxdoTokenUrl: str("LINUXDO_TOKEN_URL", "https://connect.linux.do/oauth2/token"),
  linuxdoUserUrl: str("LINUXDO_USER_URL", "https://connect.linux.do/api/user"),
  /** OAuth 专用代理：国内网络直连 connect.linux.do 常被污染/阻断，但又不希望全站采集都走代理 */
  linuxdoProxy: str("LINUXDO_PROXY"),
  githubClientId: str("GITHUB_CLIENT_ID"),
  githubClientSecret: str("GITHUB_CLIENT_SECRET"),
  githubRedirectUri: str("GITHUB_REDIRECT_URI"),
  /** GitHub OAuth 走的代理；留空回退 LINUXDO_PROXY → HTTP(S)_PROXY */
  githubProxy: str("GITHUB_PROXY"),
  githubAuthorizeUrl: str("GITHUB_AUTHORIZE_URL", "https://github.com/login/oauth/authorize"),
  githubTokenUrl: str("GITHUB_TOKEN_URL", "https://github.com/login/oauth/access_token"),
  githubUserUrl: str("GITHUB_USER_URL", "https://api.github.com/user"),

  /** Session / 临时令牌签名密钥；留空则首次启动随机生成并写入 settings 表 */
  sessionSecret: str("SESSION_SECRET"),
  /** 个人 Bot Token 加密密钥；留空则复用 sessionSecret 或自动生成 */
  tokenEncryptionKey: str("TOKEN_ENCRYPTION_KEY"),

  /** 本地模拟登录开关：仅在非 production 且显式开启时生效 */
  authDevMock: bool("AUTH_DEV_MOCK", false),

  /* ---- 个人推送护栏（防止单用户把出口代理打满） ---- */
  userPushMaxPerHour: num("USER_PUSH_MAX_PER_HOUR", 40),
  userPushMaxPerInstant: num("USER_PUSH_MAX_PER_INSTANT", 5),

  /* ---- 版本检测与一键更新 ---- */
  selfUpdateRemote: str("SELF_UPDATE_REMOTE", "origin"),
  selfUpdateBranch: str("SELF_UPDATE_BRANCH", "main"),
  selfUpdateRestartCmd: str("SELF_UPDATE_RESTART_CMD"),
  updateWebhookUrl: str("UPDATE_WEBHOOK_URL"),
  updateWebhookToken: str("UPDATE_WEBHOOK_TOKEN"),
  appCommit: str("APP_COMMIT"),
  appBuildTime: str("APP_BUILD_TIME"),
  appRepo: str("APP_REPO", "ZiChuanLan/freebie-radar"),
  /** 管理端密码；留空则 selfhost 下管理接口开放、public 下管理区锁定（安全兜底） */
  adminToken: str("ADMIN_TOKEN"),
  /** 留空兼容单域名部署；设置后管理 API 只在这些 Host 上接受凭据。 */
  adminHosts: str("ADMIN_HOSTS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  /**
   * 未登录访客看不到的分类。公开演示站默认挡掉 pan/course：
   * 这两个分类聚合的是第三方网盘分享链接（影视/教程/软件），公开展示有版权风险。
   * 自部署想全开就设 GUEST_HIDDEN_CATEGORIES= 空字符串。
   */
  guestHiddenCategories: str("GUEST_HIDDEN_CATEGORIES", "pan,course").split(",").map((s) => s.trim()).filter(Boolean),
  /** 只有源站已封口、反代会覆盖转发头时才开启。 */
  trustProxy: bool("TRUST_PROXY", false),
  rateLimitEnabled: bool("RATE_LIMIT_ENABLED", true),
  /** 仅 selfhost 可显式允许内网 Webhook，公开站始终禁止。 */
  webhookAllowPrivate: bool("WEBHOOK_ALLOW_PRIVATE", false),
} as const;

/**
 * 站点形态解析：auto = 配了 LINUX DO OAuth 就按公开站跑，否则按单人自建。
 * 公开站的核心差异是「个人状态按登录用户隔离」，自建站保持旧的全局行为。
 */
export const siteMode: "selfhost" | "public" =
  config.siteMode === "selfhost" || config.siteMode === "public"
    ? config.siteMode
    : (config.linuxdoClientId && config.linuxdoClientSecret) || (config.githubClientId && config.githubClientSecret)
      ? "public"
      : "selfhost";

export const isPublicSite = siteMode === "public";

/** OAuth 是否配置齐全（缺凭据时前端不显示登录按钮） */
export const linuxdoConfigured = Boolean(config.linuxdoClientId && config.linuxdoClientSecret);
/** GitHub OAuth 是否配置齐全 */
export const githubConfigured = Boolean(config.githubClientId && config.githubClientSecret);

/** 本地模拟登录：只在非生产环境且显式开启时可用 */
export const devMockEnabled = config.authDevMock && process.env.NODE_ENV === "development";

/**
 * 公开站及生产环境未配 ADMIN_TOKEN 时管理区必须锁死。
 * 非生产自建站保持向后兼容；默认监听回环地址。
 */
export const adminLocked = (isPublicSite || process.env.NODE_ENV === "production") && !config.adminToken;

export const aiEnabled = Boolean(config.aiBaseUrl && config.aiModel);
export const pushEnabled = config.pushChannel !== "none" && Boolean(config.telegramBotToken && config.telegramChatId);

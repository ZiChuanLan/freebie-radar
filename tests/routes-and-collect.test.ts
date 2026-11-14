import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Hono } from "hono";

process.env.DATABASE_PATH = ":memory:";

const { migrate, run, get, closeDb } = await import("../src/server/db.ts");
const { registerApi } = await import("../src/server/routes.ts");
const { ingestItems, ensureSources } = await import("../src/server/collectors/index.ts");
const { mergeKey } = await import("../src/server/enrich/dedup.ts");

const app = new Hono();

before(() => {
  migrate();
  ensureSources();
  registerApi(app);
});

after(() => {
  closeDb();
});

test("ingestItems：重复抓取已有条目时更新参数完整且保留原有 AI 判定与分数折半", () => {
  const first = ingestItems("rss-ithome", [
    {
      externalId: "post-1",
      url: "https://example.com/p1",
      title: "免费领取《斗阵骑士 Knightica》",
      summary: "限免",
      publishedAt: new Date().toISOString(),
    },
  ]);
  assert.equal(first.inserted, 1);

  // 模拟 AI 异步二审写回为非福利 + trial（按规则折半后再按 trial 打 8 折）
  run("UPDATE items SET ai_keep = 0, obtain = 'trial', score = ROUND(ROUND(score * 0.5) * 0.8) WHERE source_id = 'rss-ithome' AND external_id = 'post-1'");
  const beforeRow = get<{ score: number; ai_keep: number; obtain: string }>(
    "SELECT score, ai_keep, obtain FROM items WHERE source_id = 'rss-ithome' AND external_id = 'post-1'",
  )!;

  // 再次采到同一条（原来 UPDATE 少 1 个参数会导致绑定错位甚至报错）
  const second = ingestItems("rss-ithome", [
    {
      externalId: "post-1",
      url: "https://example.com/p1",
      title: "免费领取《斗阵骑士 Knightica》",
      summary: "限免更新",
      publishedAt: new Date().toISOString(),
    },
  ]);
  assert.equal(second.skipped, 1);

  const afterRow = get<{ score: number; ai_keep: number; obtain: string; summary: string }>(
    "SELECT score, ai_keep, obtain, summary FROM items WHERE source_id = 'rss-ithome' AND external_id = 'post-1'",
  )!;
  assert.equal(afterRow.summary, "限免更新");
  assert.equal(afterRow.ai_keep, 0);
  assert.equal(afterRow.obtain, "trial");
  assert.equal(afterRow.score, beforeRow.score);
});

test("GET /api/items：短中文名《斗阵骑士》可跨源合并，且指定单源或保鲜期时不被别源老帖遮蔽", async () => {
  run("DELETE FROM items");
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const now = new Date().toISOString();

  // 1) 一条 20 天前的《斗阵骑士》老帖（MIN(id) 更小）
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, category, score, published_at, status, is_free, obtain, first_seen_at, last_seen_at)
     VALUES ('rss-smzdm', 'old-1', 'https://smzdm.com/old', 'smzdm.com/old', 'Epic《斗阵骑士》免费领', ?, 'game', 75, ?, 'active', 1, 'free', ?, ?)`,
    mergeKey("Epic《斗阵骑士》免费领"),
    old,
    old,
    old,
  );
  // 2) 一条今日的《斗阵骑士》新帖（来自另一个源）
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, category, score, published_at, status, is_free, obtain, first_seen_at, last_seen_at)
     VALUES ('rss-keylol', 'new-1', 'https://keylol.com/new', 'keylol.com/new', '【Epic移动版】《斗阵骑士》本周免费领取', ?, 'game', 80, ?, 'active', 1, 'free', ?, ?)`,
    mergeKey("【Epic移动版】《斗阵骑士》本周免费领取"),
    now,
    now,
    now,
  );

  // 全库合并时只展示 1 条（dupCount = 2）
  const mergedRes = await app.request("/api/items?category=game&search=" + encodeURIComponent("斗阵骑士"));
  const mergedJson = (await mergedRes.json()) as { total: number; items: { dupCount: number; source_id: string }[] };
  assert.equal(mergedJson.total, 1);
  assert.equal(mergedJson.items[0]!.dupCount, 2);

  // 开启 unexpired=1&maxAgeDays=7 时，20 天前的 old-1 不再遮蔽今日的 new-1
  const freshRes = await app.request("/api/items?unexpired=1&maxAgeDays=7&search=" + encodeURIComponent("斗阵骑士"));
  const freshJson = (await freshRes.json()) as { total: number; items: { source_id: string }[] };
  assert.equal(freshJson.total, 1);
  assert.equal(freshJson.items[0]!.source_id, "rss-keylol");

  // 按单源过滤 rss-keylol 时，不被 rss-smzdm 的 MIN(id) 隐藏
  const singleSrcRes = await app.request("/api/items?source=rss-keylol&search=" + encodeURIComponent("斗阵骑士"));
  const singleSrcJson = (await singleSrcRes.json()) as { total: number; items: { source_id: string }[] };
  assert.equal(singleSrcJson.total, 1);
  assert.equal(singleSrcJson.items[0]!.source_id, "rss-keylol");
});

test("GET /api/digests/:date：返回条目顺序与 item_ids 顺序保持一致", async () => {
  const now = new Date().toISOString();
  run(
    `INSERT INTO items (id, source_id, external_id, url, url_key, title, title_key, category, score, published_at, status, first_seen_at, last_seen_at)
     VALUES (501, 'v2ex-free', '501', 'https://a.com/501', 'a.com/501', '低分先入库', 'low', 'other', 60, ?, 'active', ?, ?),
            (502, 'v2ex-free', '502', 'https://a.com/502', 'a.com/502', '高分后入库', 'high', 'other', 95, ?, 'active', ?, ?)`,
    now, now, now, now, now, now,
  );
  run(
    "INSERT INTO digests (date, item_ids, payload, created_at, pushed_at) VALUES ('2026-11-13', '[502, 501]', '{\"text\":\"x\"}', ?, NULL)",
    now,
  );

  const res = await app.request("/api/digests/2026-11-13");
  const json = (await res.json()) as { items: { id: number }[] };
  assert.deepEqual(json.items.map((i) => i.id), [502, 501]);
});

test("classify & score：URL/单词边界不误命中 cloud，免费游戏获得合理评分且双语可跨源合并", async () => {
  const { classify, enrichItem } = await import("../src/server/enrich/index.ts");
  run("DELETE FROM items");
  run("DELETE FROM title_aliases");

  // 1) Steam Free Weekend 不应因 URL 含 s3 或词尾子串误分到 cloud
  const wk = classify(
    "🚨 FREE WEEKEND ALERT 🚨 Cities: Skylines II 🔔 Company of Heroes 3 🔔 Deep Rock Galactic: Rogue Core 💥 Have a F2P Event on #Steam 🗓️ The Event Ends Nov 16 @ 6PM U",
    "https://example.com/s3/oss/r2-demo",
  );
  assert.equal(wk.category, "game");

  // 2) 《无主之地》金钥匙兑换码 应识别为 game 而不是 software
  const bl = classify("【26-11-12至26-11-17】《无主之地》金钥匙兑换码", "");
  assert.equal(bl.category, "game");

  // 3) 英文纯正喜加一评分应显著高于 40（不因中文同义词多就碾压英文）
  const redditGame = enrichItem(
    {
      externalId: "fgf-1",
      url: "https://reddit.com/r/FreeGameFindings/1",
      title: "[Epic Games] (Game) Knightica",
      summary: "Free to keep on Epic Games Store",
      publishedAt: new Date().toISOString(),
    },
    "rss-reddit-freegames",
  )!;
  assert.ok(redditGame.score >= 70, `expected >=70, got ${redditGame.score}`);

  // 4) 先入库纯中文《斗阵骑士》，再入库双语《斗阵骑士 Knightica》与英文 Bluesky 推文：3 条在列表应自动合并为 1 条
  const now = new Date().toISOString();
  ingestItems("rss-smzdm", [
    { externalId: "smzdm-1", url: "https://smzdm.com/1", title: "Epic《斗阵骑士》免费领", publishedAt: now },
  ]);
  ingestItems("rss-ithome", [
    { externalId: "it-1", url: "https://ithome.com/1", title: "Epic 喜加一：《斗阵骑士 Knightica》游戏免费领取", publishedAt: now },
  ]);
  ingestItems("bsky-gamedeals", [
    { externalId: "bsky-1", url: "https://bsky.app/1", title: "Knightica (Mobile) is Free via Epic Games Store. IOS https://ow.ly/iIhn51069o5", publishedAt: now },
  ]);

  const res = await app.request("/api/items?category=game");
  const json = (await res.json()) as { total: number; items: { dupCount: number }[] };
  assert.equal(json.total, 1);
  assert.equal(json.items[0]!.dupCount, 3);
});

test("活动积分福利：「华为小红书Skill报名领codearts 每天1000积分」可过 DEAL_HINT 并正确打分分类", async () => {
  const { DEAL_HINT } = await import("../src/server/enrich/noise.ts");
  const { enrichItem } = await import("../src/server/enrich/index.ts");
  const { config } = await import("../src/server/config.ts");

  const title = "华为小红书Skill报名领codearts 每天1000积分";
  assert.equal(DEAL_HINT.test(title), true);

  const e = enrichItem(
    {
      externalId: "xhs-codearts-1",
      url: "https://www.xiaohongshu.com/explore/codearts1",
      title,
      publishedAt: new Date().toISOString(),
    },
    "xhs-search",
  )!;
  assert.equal(e.isFree, true);
  assert.equal(e.category, "ai");
  assert.ok(e.score >= 65, `expected >=65, got ${e.score}`);

  // 测试 /api/ingest/keywords 订阅词同步接口
  run("INSERT OR IGNORE INTO subscriptions (keyword, created_at) VALUES ('codearts', ?)", new Date().toISOString());
  const prevToken = config.ingestToken;
  (config as { ingestToken: string }).ingestToken = "test-ingest-tok";
  try {
    const unauth = await app.request("/api/ingest/keywords");
    assert.equal(unauth.status, 401);
    const okRes = await app.request("/api/ingest/keywords", {
      headers: { authorization: "Bearer test-ingest-tok" },
    });
    assert.equal(okRes.status, 200);
    const data = (await okRes.json()) as { keywords: string[] };
    assert.ok(data.keywords.includes("codearts"));
  } finally {
    (config as { ingestToken: string }).ingestToken = prevToken;
  }
});

test("免费更新拦截 & AI 二审时机配置持久化", async () => {
  const { NOISE_TITLE } = await import("../src/server/enrich/noise.ts");
  const { extractPrice } = await import("../src/server/enrich/pricing.ts");

  const patchTitle = "《毁灭战士：黑暗时代》将于11月16日免费更新屠戮模式";
  assert.equal(NOISE_TITLE.test(patchTitle), true);
  assert.equal(extractPrice(patchTitle, "").isFree, false);

  // /api/ai 默认 reviewBeforePush=true，PATCH 可来回切换
  const g1 = await app.request("/api/ai");
  assert.equal(g1.status, 200);
  const j1 = (await g1.json()) as { settings: { reviewBeforePush: boolean } };
  assert.equal(j1.settings.reviewBeforePush, true);

  const p1 = await app.request("/api/ai", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewBeforePush: false }),
  });
  assert.equal(p1.status, 200);
  const j2 = (await p1.json()) as { settings: { reviewBeforePush: boolean } };
  assert.equal(j2.settings.reviewBeforePush, false);

  const p2 = await app.request("/api/ai", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewBeforePush: true }),
  });
  const j3 = (await p2.json()) as { settings: { reviewBeforePush: boolean } };
  assert.equal(j3.settings.reviewBeforePush, true);
});

test("陈旧旧帖禁止当新羊毛推送，且 OpenRouter 新免费模型可过门禁并按质量分校准", async () => {
  const { DEAL_HINT, WIDE_AI_TRIGGER } = await import("../src/server/enrich/noise.ts");
  const { enrichItem } = await import("../src/server/enrich/index.ts");
  const { calibrateScoreByObtain } = await import("../src/server/enrich/alias.ts");
  const { DEFAULT_SETTINGS, freshEnoughForPush, passesPushFilters } = await import("../src/server/push.ts");
  const { saveRetention } = await import("../src/server/retention.ts");

  // 1) 29 天前的 10月15日 V2EX 老帖不得通过推送时效门禁
  const oct15 = new Date(Date.now() - 29 * 86_400_000).toISOString();
  assert.equal(freshEnoughForPush(oct15), false);
  assert.equal(
    passesPushFilters(
      {
        title: "美团单车 7 天 66 次卡，免费送，先到先得",
        score: 85,
        codes: [],
        isFree: true,
        aiKeep: true,
        category: "other",
        obtain: "free",
        publishedAt: oct15,
      },
      DEFAULT_SETTINGS,
    ),
    false,
  );

  // 2) 当 retention.keptDays=3 时，超过 7 天的陈旧帖不再被重新入库循环推送
  saveRetention({ keptDays: 3 });
  const staleRes = ingestItems("v2ex-free", [
    {
      externalId: "v2ex-oct15",
      url: "https://www.v2ex.com/t/1249059",
      title: "美团单车 7 天 66 次卡，免费送，先到先得",
      publishedAt: oct15,
    },
  ]);
  assert.equal(staleRes.inserted, 0);
  assert.equal(staleRes.skipped, 1);

  // 3) OpenRouter 新免费模型：过门禁 + 质量分 4/5 达标，AI 拒绝压至 <=35
  const orTitle = "OpenRouter 新增免费模型 particle-ai/particle-1:free 基于DeepSeek V4.1 Flash";
  assert.equal(DEAL_HINT.test(orTitle), true);
  assert.equal(WIDE_AI_TRIGGER.test(orTitle), true);
  const orEnriched = enrichItem(
    { externalId: "or-1", url: "https://linux.do/t/1", title: orTitle, publishedAt: new Date().toISOString() },
    "linuxdo-welfare",
  )!;
  assert.equal(orEnriched.category, "ai");
  assert.ok(calibrateScoreByObtain(orEnriched.score, "free", true, 4) >= 80);
  assert.ok(calibrateScoreByObtain(orEnriched.score, "free", false, 1) <= 35);
});

test("GET /api/items 支持多选分类与中英文语言筛选，且 /api/ai 返回反馈样本数", async () => {
  const { Hono } = await import("hono");
  const { registerApi } = await import("../src/server/routes.ts");
  const app = new Hono();
  registerApi(app);

  const now = new Date().toISOString();
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, summary, category, score, status, starred, first_seen_at, last_seen_at, published_at)
     VALUES ('linuxdo-welfare', 'cat-1', 'https://example.com/cat1', 'https://example.com/cat1', 'OpenRouter 免费模型福利', 'openrouter', '', 'ai', 80, 'active', 1, ?, ?, ?)`,
    now, now, now,
  );
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, summary, category, score, status, starred, first_seen_at, last_seen_at, published_at)
     VALUES ('epic-free', 'cat-2', 'https://example.com/cat2', 'https://example.com/cat2', 'Knightica Free on Epic Games', 'unique_test_game_xyz', '', 'game', 78, 'active', 0, ?, ?, ?)`,
    now, now, now,
  );
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, summary, category, score, status, starred, first_seen_at, last_seen_at, published_at)
     VALUES ('v2ex-free', 'cat-3', 'https://example.com/cat3', 'https://example.com/cat3', '送一个域名优惠码', 'domaincode', '', 'domain', 75, 'ignored', 0, ?, ?, ?)`,
    now, now, now,
  );

  // 多选分类：ai,game
  const resMulti = await app.request("/api/items?category=ai,game");
  const dataMulti = (await resMulti.json()) as { items: { external_id: string }[] };
  assert.ok(dataMulti.items.some((i) => i.external_id === "cat-1"));
  assert.ok(dataMulti.items.some((i) => i.external_id === "cat-2"));
  assert.ok(!dataMulti.items.some((i) => i.external_id === "cat-3"));

  // 语言筛选：zh vs en
  const resZh = await app.request("/api/items?category=ai,game&lang=zh");
  const dataZh = (await resZh.json()) as { items: { external_id: string }[] };
  assert.ok(dataZh.items.some((i) => i.external_id === "cat-1"));
  assert.ok(!dataZh.items.some((i) => i.external_id === "cat-2"));

  const resEn = await app.request("/api/items?category=ai,game&lang=en");
  const dataEn = (await resEn.json()) as { items: { external_id: string }[] };
  assert.ok(dataEn.items.some((i) => i.external_id === "cat-2"));
  assert.ok(!dataEn.items.some((i) => i.external_id === "cat-1"));

  // /api/ai 返回 learnFromFeedback 与 feedback 样本数
  const resAi = await app.request("/api/ai");
  const dataAi = (await resAi.json()) as { settings: { learnFromFeedback: boolean }; feedback: { positive: number; negative: number } };
  assert.equal(dataAi.settings.learnFromFeedback, true);
  assert.ok(dataAi.feedback.positive >= 1);
  assert.ok(dataAi.feedback.negative >= 1);
});

test("AI 规则初筛开关、自定义噪音词、按源分流与扩展配置持久化", async () => {
  const {
    getAiSettings,
    matchesEntryNoise,
    saveAiSettings,
    shouldPassSourceToAi,
  } = await import("../src/server/enrich/ai-settings.ts");

  saveAiSettings({
    preFilterEnabled: true,
    customNoiseKeywords: ["拼车", "代购"],
    skipFreebieSources: true,
    sourceMode: "exclude",
    sourceIds: ["v2ex-deals"],
    batchSize: 8,
    concurrency: 3,
    timeoutSec: 20,
    extraPrompt: "只看直接可用的免费福利",
    feedbackLimit: 4,
  });

  const s = getAiSettings();
  assert.equal(s.preFilterEnabled, true);
  assert.deepEqual(s.customNoiseKeywords, ["拼车", "代购"]);
  assert.equal(s.skipFreebieSources, true);
  assert.equal(s.batchSize, 8);
  assert.equal(s.concurrency, 3);
  assert.equal(s.timeoutSec, 20);
  assert.equal(s.feedbackLimit, 4);

  // 入口噪音初筛：内置 + 自定义词
  assert.equal(matchesEntryNoise("请问哪里有免费节点", s), true);
  assert.equal(matchesEntryNoise("某服务拼车找人", s), true);
  assert.equal(matchesEntryNoise("Epic 本周免费游戏领", s), false);

  // 关掉规则初筛后不再拦截
  const off = saveAiSettings({ preFilterEnabled: false });
  assert.equal(matchesEntryNoise("某服务拼车找人", off), false);

  // 纯白嫖专源免送 AI + exclude 过滤
  assert.equal(shouldPassSourceToAi("epic-free", s), false);
  assert.equal(shouldPassSourceToAi("v2ex-deals", s), false);
  assert.equal(shouldPassSourceToAi("linuxdo-welfare", s), true);

  // 恢复默认避免影响后续测试
  saveAiSettings({
    preFilterEnabled: true,
    customNoiseKeywords: [],
    skipFreebieSources: false,
    sourceMode: "all",
    sourceIds: [],
    extraPrompt: "",
  });
});

test("推送策略：AI 兜底模式、时效/开关/阈值联动、preview 拦截诊断与 pickDaily 放行 AI 真福利", async () => {
  const {
    aiAllowed,
    getPushSettings,
    isQuietNow,
    previewPush,
    savePushSettings,
    DEFAULT_SETTINGS,
  } = await import("../src/server/push.ts");
  const { saveAiSettings } = await import("../src/server/enrich/ai-settings.ts");
  const { pickDaily } = await import("../src/server/digest.ts");

  saveAiSettings({ enabled: true, baseUrl: "https://example.com/v1", model: "test-model" });
  savePushSettings({
    ...DEFAULT_SETTINGS,
    pushTiming: "instant_first",
    instantScore: 65,
    batchScore: 90, // 故意高于 instantScore，应被自动钳制 <= 65
    quietEnabled: false,
    quietHours: "00:00-23:59",
  });

  const ps = getPushSettings();
  assert.equal(ps.pushTiming, "instant_first");
  assert.equal(ps.batchScore, 65);
  assert.equal(isQuietNow(ps), false); // quietEnabled=false 时不进入免打扰

  // /api/ai 同步反映 pushTiming
  const aiRes = await app.request("/api/ai");
  const aiJson = (await aiRes.json()) as {
    settings: { reviewBeforePush: boolean };
    feedback: { positiveSamples: string[]; negativeSamples: string[] };
  };
  assert.equal(aiJson.settings.reviewBeforePush, false);
  assert.ok(Array.isArray(aiJson.feedback.positiveSamples));

  // 三种 AI 兜底模式行为
  const unreviewedItem = { title: "某软件限时领取", score: 75, codes: [], aiKeep: null };
  const rejectedItem = { title: "行业新闻", score: 80, codes: [], aiKeep: false };
  assert.equal(aiAllowed(unreviewedItem, { ...ps, aiFallbackMode: "strict" }), false);
  assert.equal(aiAllowed(unreviewedItem, { ...ps, aiFallbackMode: "rule_fallback" }), true);
  assert.equal(aiAllowed(rejectedItem, { ...ps, aiFallbackMode: "rule_fallback" }), false);
  assert.equal(aiAllowed(rejectedItem, { ...ps, aiFallbackMode: "ignore_ai" }), true);

  // 无中文 DEAL_HINT 但 aiKeep=true 的条目不应被 pickDaily 或 previewPush 误杀
  run("DELETE FROM items");
  const now = new Date().toISOString();
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, category, score, published_at, status, is_free, obtain, ai, ai_keep, first_seen_at, last_seen_at)
     VALUES ('steam-free', 'ai-true-1', 'https://store.steampowered.com/app/123', 'steam/123', 'Portal 2 Giveaway Weekend', 'portal2', 'game', 72, ?, 'active', 1, 'free', '{"keep":true,"reason":"Steam 限免入库"}', 1, ?, ?)`,
    now, now, now,
  );
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, category, score, published_at, status, is_free, obtain, ai, ai_keep, first_seen_at, last_seen_at)
     VALUES ('v2ex-free', 'ai-false-1', 'https://v2ex.com/t/999', 'v2ex/999', '行业报告：今年云计算市场增长 20%', 'cloudreport', 'cloud', 60, ?, 'active', 0, 'free', '{"keep":false,"reason":"行业报告"}', 0, ?, ?)`,
    now, now, now,
  );

  savePushSettings({ ...DEFAULT_SETTINGS, aiFallbackMode: "rule_fallback", maxAgeHours: 72 });
  const daily = pickDaily(new Date(), 10);
  assert.ok(daily.some((d) => d.url.includes("123")));

  const pv = previewPush(6);
  assert.equal(pv.matched, 1);
  assert.ok(pv.instant.some((t) => t.includes("Portal 2")));
  assert.equal(pv.rejectedBy.ai, 1);
});


test("GET /api/items 全分类 48h 窗口跨源折叠：cloud 分类同标题合并且跨天不误遮蔽", async () => {
  run("DELETE FROM items");
  const nowIso = new Date().toISOString();
  const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();

  // 当天 NodeSeek 与 TG 同时发《【每日免费CDK】住宅代理IP流量》（cloud 分类），应合并为 1 条并保留高分（76）
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, category, score, published_at, status, is_free, obtain, first_seen_at, last_seen_at)
     VALUES ('rss-nodeseek', 'ns-1', 'https://nodeseek.com/1', 'nodeseek/1', '【每日免费CDK】住宅代理IP流量', '住宅代理ip流量', 'cloud', 76, ?, 'active', 1, 'free', ?, ?)`,
    nowIso, nowIso, nowIso,
  );
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, category, score, published_at, status, is_free, obtain, first_seen_at, last_seen_at)
     VALUES ('tg-cn-deals', 'tg-1', 'https://t.me/s/nodeseekc/1', 't.me/1', '【每日免费CDK】住宅代理IP流量', '住宅代理ip流量', 'cloud', 75, ?, 'active', 1, 'free', ?, ?)`,
    nowIso, nowIso, nowIso,
  );
  // 5 天前的同标题日常贴应作为独立期数保留，不跟今天撞车合并
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, category, score, published_at, status, is_free, obtain, first_seen_at, last_seen_at)
     VALUES ('rss-nodeseek', 'ns-old', 'https://nodeseek.com/old', 'nodeseek/old', '【每日免费CDK】住宅代理IP流量', '住宅代理ip流量', 'cloud', 71, ?, 'active', 1, 'free', ?, ?)`,
    fiveDaysAgo, fiveDaysAgo, fiveDaysAgo,
  );

  const res = await app.request("/api/items?limit=20&sort=score");
  const json = (await res.json()) as { items: Array<{ id: number; score: number; dupCount: number; source_id: string }> };
  assert.equal(json.items.length, 2);
  assert.equal(json.items[0]!.score, 76);
  assert.equal(json.items[0]!.source_id, "rss-nodeseek");
  assert.equal(json.items[0]!.dupCount, 2);
  assert.equal(json.items[1]!.score, 71);
  assert.equal(json.items[1]!.dupCount, 1);

  const relRes = await app.request(`/api/items/${json.items[0]!.id}/related`);
  const relJson = (await relRes.json()) as { items: Array<{ source_id: string }> };
  assert.equal(relJson.items.length, 1);
  assert.equal(relJson.items[0]!.source_id, "tg-cn-deals");
});

test("rssCollector 源级分类/关键词/only100Off 提纯过滤与 openrouterCollector 新免费模型解析", async () => {
  const { rssCollector } = await import("../src/server/collectors/rss.ts");
  const { openrouterCollector } = await import("../src/server/collectors/openrouter.ts");

  const fakeNsXml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>NodeSeek</title>
    <item><title>溢价200出VPS</title><link>https://nodeseek.com/1</link><category>trade</category></item>
    <item><title>【免费领】某云厂商每日免费 CDK</title><link>https://nodeseek.com/2</link><category>info</category></item>
    <item><title>日常吐槽帖</title><link>https://nodeseek.com/3</link><category>info</category></item>
  </channel></rss>`;

  const nsOut = await rssCollector.collect({
    sourceId: "rss-nodeseek",
    cursor: null,
    maxItems: 20,
    config: {
      feeds: [{ id: "nodeseek", url: "https://rss.nodeseek.com/", includeCategories: ["info"], titleKeywords: ["免费", "cdk"] }],
    },
    http: {
      text: async () => ({ status: 200, url: "", body: fakeNsXml, headers: new Headers(), bytes: Buffer.alloc(0), contentType: "application/xml" }),
      json: async () => ({ status: 200, url: "", data: {} as never, response: { status: 200, url: "", body: "", headers: new Headers(), bytes: Buffer.alloc(0), contentType: "" } }),
      raw: async () => ({ status: 200, url: "", body: "", headers: new Headers(), bytes: Buffer.alloc(0), contentType: "" }),
    },
    log: () => {},
  });
  assert.equal(nsOut.items.length, 1);
  assert.ok(nsOut.items[0]!.title.includes("每日免费 CDK"));

  const fakeItchXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>itch</title>
    <item><title>Paid 10%</title><link>https://a.itch.io/1</link><price>$9.00</price><discountpercent>10</discountpercent></item>
    <item><title>Free 100% Game</title><link>https://a.itch.io/2</link><price>$0.00</price><discountpercent>100</discountpercent><fullPrice>$5.00</fullPrice></item>
  </channel></rss>`;

  const itchOut = await rssCollector.collect({
    sourceId: "rss-itch-free",
    cursor: null,
    maxItems: 20,
    config: { feeds: [{ id: "itch-free", url: "https://itch.io/games/on-sale.xml", only100Off: true }] },
    http: {
      text: async () => ({ status: 200, url: "", body: fakeItchXml, headers: new Headers(), bytes: Buffer.alloc(0), contentType: "application/xml" }),
      json: async () => ({ status: 200, url: "", data: {} as never, response: { status: 200, url: "", body: "", headers: new Headers(), bytes: Buffer.alloc(0), contentType: "" } }),
      raw: async () => ({ status: 200, url: "", body: "", headers: new Headers(), bytes: Buffer.alloc(0), contentType: "" }),
    },
    log: () => {},
  });
  assert.equal(itchOut.items.length, 1);
  assert.equal(itchOut.items[0]!.categoryHint, "game");
  assert.ok(itchOut.items[0]!.summary?.includes("$5.00"));

  const nowSec = Math.floor(Date.now() / 1000) - 600;
  const oldSec = Math.floor(Date.now() / 1000) - 40 * 86_400;
  const orOut = await openrouterCollector.collect({
    sourceId: "openrouter-free",
    cursor: null,
    maxItems: 20,
    config: { maxAgeDays: 14 },
    http: {
      text: async () => ({ status: 200, url: "", body: "", headers: new Headers(), bytes: Buffer.alloc(0), contentType: "" }),
      raw: async () => ({ status: 200, url: "", body: "", headers: new Headers(), bytes: Buffer.alloc(0), contentType: "" }),
      json: async () => ({
        status: 200,
        url: "",
        data: {
          data: [
            { id: "vendor/new-model:free", name: "New Free Model", created: nowSec, context_length: 131072, pricing: { prompt: "0", completion: "0" } },
            { id: "vendor/old-model:free", name: "Old Free Model", created: oldSec, pricing: { prompt: "0", completion: "0" } },
            { id: "vendor/paid-model", name: "Paid Model", created: nowSec, pricing: { prompt: "0.001", completion: "0.002" } },
          ],
        } as never,
        headers: new Headers(),
        response: { status: 200, url: "", body: "", headers: new Headers(), bytes: Buffer.alloc(0), contentType: "application/json" },
      }),
    },
    log: () => {},
  });
  assert.equal(orOut.items.length, 1);
  assert.equal(orOut.items[0]!.externalId, "vendor/new-model:free");
  assert.equal(orOut.items[0]!.categoryHint, "ai");
});


test("多兴趣频道重构：kind 分流、取消 paid 25分封顶、放行好价/开源初筛与多路由推送", async () => {
  const { NOISE_TITLE, hasValueSignal } = await import("../src/server/enrich/noise.ts");
  const { enrichItem } = await import("../src/server/enrich/index.ts");
  const { calibrateScoreByObtain } = await import("../src/server/enrich/alias.ts");
  const { DEFAULT_SETTINGS, priceAllowed, previewPush, savePushSettings } = await import("../src/server/push.ts");
  const { pickDaily } = await import("../src/server/digest.ts");

  // 1) 黑五降价促销、VPS 测评、开源工具盘点不再被 NOISE_TITLE 全局误杀
  assert.equal(NOISE_TITLE.test("RackNerd 黑五 VPS 降价促销年付 $10.99"), false);
  assert.equal(NOISE_TITLE.test("2026 自托管开源监控工具盘点与深度测评"), false);
  assert.equal(NOISE_TITLE.test("请问黑五哪里有便宜 VPS"), true);
  assert.equal(NOISE_TITLE.test("《某游戏》免费更新内容公告"), true);

  // 2) 黑五 VPS 与开源项目能识别正确 kind 并获得合理高分（不再被 paid<=25 截断）
  const now = new Date().toISOString();
  const vpsDeal = enrichItem(
    {
      externalId: "bf-vps-1",
      url: "https://lowendbox.com/bf-1",
      title: "[黑五特惠] RackNerd 2核2G KVM VPS 年付 $10.99 限时促销",
      summary: "Black Friday KVM VPS 年付特价",
      publishedAt: now,
    },
    "rss-lowendbox",
  )!;
  assert.equal(vpsDeal.kind, "deal");
  assert.equal(vpsDeal.category, "vps");
  assert.equal(hasValueSignal(vpsDeal.title, vpsDeal.kind), true);
  assert.ok(calibrateScoreByObtain(vpsDeal.score, "paid", true, 5, "deal") >= 75);

  const osItem = enrichItem(
    {
      externalId: "os-1",
      url: "https://github.com/example/panel",
      title: "开源自托管轻量 Docker 监控面板 v2.1.0 发布 (MIT 协议)",
      summary: "GitHub 开源项目 self-hosted",
      publishedAt: now,
    },
    "linuxdo-resource",
  )!;
  assert.equal(osItem.kind, "opensource");
  assert.equal(osItem.category, "opensource");
  assert.equal(hasValueSignal(osItem.title, osItem.kind), true);
  assert.ok(calibrateScoreByObtain(osItem.score, "free", true, 5, "opensource") >= 75);

  const carpoolItem = enrichItem(
    {
      externalId: "carpool-1",
      url: "https://nodeseek.com/post-100",
      title: "ChatGPT Team 拼车发车 3缺1 ¥35/月 稳车",
      summary: "合租车位",
      publishedAt: now,
    },
    "rss-nodeseek",
  )!;
  assert.equal(carpoolItem.category, "carpool");
  assert.equal(carpoolItem.kind, "deal");
  assert.equal(hasValueSignal(carpoolItem.title, carpoolItem.kind), true);

  const tradeItem = enrichItem(
    {
      externalId: "trade-1",
      url: "https://nodeseek.com/post-101",
      title: "[出鸡] 明盘 80 出 RackNerd 2核2G 带原邮",
      summary: "转让闲置小鸡",
      publishedAt: now,
    },
    "rss-nodeseek",
  )!;
  assert.equal(tradeItem.category, "trade");
  assert.equal(tradeItem.kind, "deal");
  assert.equal(hasValueSignal(tradeItem.title, tradeItem.kind), true);

  const newsItem = enrichItem(
    {
      externalId: "news-1",
      url: "https://ruanyifeng.com/blog/2026/11/weekly.html",
      title: "科技爱好者周刊（第 380 期）：AI 编程工具新趋势发布",
      summary: "每周技术动态与新闻周刊",
      publishedAt: now,
    },
    "rss-ruanyifeng",
  )!;
  assert.equal(newsItem.kind, "info");
  assert.equal(hasValueSignal(newsItem.title, newsItem.kind), true);
  // 默认推送策略保持只推 freebie，科技资讯不会污染默认白嫖推送
  assert.deepEqual(DEFAULT_SETTINGS.kinds, ["freebie"]);

  // 3) priceAllowed：maxPrice=100 允许 <=100 元的 paid 好价；maxPrice=0 拦截 paid
  assert.equal(priceAllowed({ price: 78, isFree: false, obtain: "paid" }, 100), true);
  assert.equal(priceAllowed({ price: 78, isFree: false, obtain: "paid" }, 0), false);

  // 4) 入库后按 kind 查询、统计 byKind，并验证多路由推送 & 日报放行
  run("DELETE FROM items");
  run(
    `INSERT INTO items (source_id, external_id, url, url_key, title, title_key, category, kind, score, price, is_free, obtain, ai, ai_keep, ai_quality, published_at, status, first_seen_at, last_seen_at)
     VALUES ('rss-lowendbox', 'bf-1', 'https://lowendbox.com/bf-1', 'leb/bf1', '[黑五特惠] RackNerd KVM VPS 年付 $10.99', 'racknerd bf', 'cloud', 'deal', 82, 78, 0, 'paid', '{"keep":true,"kind":"deal","quality":5,"reason":"黑五神价VPS"}', 1, 5, ?, 'active', ?, ?),
            ('linuxdo-resource', 'os-2', 'https://github.com/acme/radar', 'gh/radar', '开源自托管面板 v2.1 (MIT)', 'acme radar', 'opensource', 'opensource', 76, NULL, 1, 'free', '{"keep":true,"kind":"opensource","quality":4,"reason":"实用开源面板"}', 1, 4, ?, 'active', ?, ?)`,
    now, now, now, now, now, now,
  );

  const dealRes = await app.request("/api/items?kind=deal");
  const dealJson = (await dealRes.json()) as { total: number; items: { kind: string }[] };
  assert.equal(dealJson.total, 1);
  assert.equal(dealJson.items[0]!.kind, "deal");

  const statsRes = await app.request("/api/stats");
  const statsJson = (await statsRes.json()) as { byKind: { kind: string; n: number }[] };
  assert.ok(statsJson.byKind.some((k) => k.kind === "deal" && k.n === 1));
  assert.ok(statsJson.byKind.some((k) => k.kind === "opensource" && k.n === 1));

  // 多路由推送：仅推「黑五 VPS」即时 + 「开源项目」攒批
  savePushSettings({
    ...DEFAULT_SETTINGS,
    routes: [
      {
        id: "vps",
        name: "黑五VPS",
        enabled: true,
        kinds: ["deal"],
        categories: ["cloud"],
        obtainModes: ["paid", "free"],
        keywords: ["黑五", "vps"],
        maxPrice: 100,
        minScore: 60,
        instant: true,
        header: "🖥 VPS",
      },
      {
        id: "os",
        name: "开源雷达",
        enabled: true,
        kinds: ["opensource"],
        categories: [],
        obtainModes: [],
        keywords: [],
        maxPrice: null,
        minScore: 60,
        instant: false,
      },
    ],
  });

  const pv = previewPush(6);
  assert.equal(pv.matched, 2);
  assert.equal(pv.instant.length, 1);
  assert.ok(pv.instant[0]!.includes("RackNerd"));
  assert.equal(pv.batch.length, 1);
  assert.ok(pv.batch[0]!.includes("开源自托管面板"));

  const daily = pickDaily(new Date(), 10);
  assert.equal(daily.length, 2);

  // 恢复默认推送设置以免影响其他测试
  savePushSettings({ ...DEFAULT_SETTINGS });
});


test("封面图提取与持久化：sanitizeImageUrl 过滤杂图、RSS 抽图并写入 image_url 返回给列表 API", async () => {
  const { sanitizeImageUrl, extractImageFromHtml } = await import("../src/server/enrich/normalize.ts");
  const { rssCollector } = await import("../src/server/collectors/rss.ts");

  assert.equal(sanitizeImageUrl("https://gravatar.com/avatar/123"), null);
  assert.equal(sanitizeImageUrl("data:image/png;base64,xxx"), null);
  assert.equal(sanitizeImageUrl("//cdn.example.com/cover.jpg"), "https://cdn.example.com/cover.jpg");

  const html = `<img src="https://example.com/pixel.gif" width="1" height="1" /><img src="https://img.example.com/hero.png" />`;
  assert.equal(extractImageFromHtml(html, "https://example.com"), "https://img.example.com/hero.png");

  const fakeXml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Feed</title>
    <item>
      <title>免费领取封面游戏 A</title>
      <link>https://example.com/game-a</link>
      <media:thumbnail url="https://cdn.example.com/game-a.jpg" />
    </item>
    <item>
      <title>开源工具 B 发布</title>
      <link>https://example.com/tool-b</link>
      <description><![CDATA[<p>介绍</p><img src="/assets/tool-b.png" />]]></description>
    </item>
  </channel></rss>`;

  const out = await rssCollector.collect({
    sourceId: "rss-test-img",
    cursor: null,
    maxItems: 10,
    config: { feeds: [{ id: "img", url: "https://example.com/rss.xml" }] },
    http: {
      text: async () => ({ status: 200, url: "", body: fakeXml, headers: new Headers(), bytes: Buffer.alloc(0), contentType: "application/xml" }),
      json: async () => ({ status: 200, url: "", data: {} as never, response: { status: 200, url: "", body: "", headers: new Headers(), bytes: Buffer.alloc(0), contentType: "" } }),
      raw: async () => ({ status: 200, url: "", body: "", headers: new Headers(), bytes: Buffer.alloc(0), contentType: "" }),
    },
    log: () => {},
  });

  assert.equal(out.items.length, 2);
  assert.equal(out.items[0]!.imageUrl, "https://cdn.example.com/game-a.jpg");
  assert.equal(out.items[1]!.imageUrl, "https://example.com/assets/tool-b.png");

  run("DELETE FROM items");
  const { saveAiSettings } = await import("../src/server/enrich/ai-settings.ts");
  saveAiSettings({ enabled: false });
  ingestItems("rss-ithome", out.items.map((it) => ({ ...it, publishedAt: new Date().toISOString() })));
  const res = await app.request("/api/items?limit=10");
  const json = (await res.json()) as { items: { title: string; image_url: string | null }[] };
  const gameA = json.items.find((i) => i.title.includes("游戏 A"));
  const toolB = json.items.find((i) => i.title.includes("工具 B"));
  assert.equal(gameA?.image_url, "https://cdn.example.com/game-a.jpg");
  assert.equal(toolB?.image_url, "https://example.com/assets/tool-b.png");
});

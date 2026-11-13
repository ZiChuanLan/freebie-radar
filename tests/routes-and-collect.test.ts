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

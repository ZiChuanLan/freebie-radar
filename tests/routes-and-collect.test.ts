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

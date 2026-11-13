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

  // 模拟 AI 异步二审写回为非福利 + trial
  run("UPDATE items SET ai_keep = 0, obtain = 'trial', score = ROUND(score * 0.5) WHERE source_id = 'rss-ithome' AND external_id = 'post-1'");
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

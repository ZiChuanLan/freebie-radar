import assert from "node:assert/strict";
import { after, before, test } from "node:test";

// 内存库适配器（node:sqlite 后端），避免污染本地 data
const { useMemoryDb } = await import("./sqlite-adapter.ts");
useMemoryDb();

const { migrate, run, closeDb } = await import("../src/server/db.ts");
const { dedupeByTitle, extractMergeKeys, mergeKey, TitleDeduper } = await import("../src/server/enrich/dedup.ts");
const { pickDaily } = await import("../src/server/digest.ts");

before(() => {
  migrate();
});

after(() => {
  closeDb();
});

test("extractMergeKeys：中英双语《》同时抽中文与英文别名", () => {
  assert.deepEqual(
    extractMergeKeys("Epic 喜加一：《斗阵骑士 Knightica》游戏免费领取"),
    ["knightica", "斗阵骑士"],
  );
  assert.deepEqual(
    extractMergeKeys("Epic《斗阵骑士》免费领，11月20日0点截止"),
    ["斗阵骑士"],
  );
  assert.deepEqual(
    extractMergeKeys("【Epic移动版】《斗阵骑士》本周免费领取"),
    ["斗阵骑士"],
  );
  assert.deepEqual(
    extractMergeKeys("【Epic】免费领取《斗阵骑士》（Knightica）"),
    ["knightica", "斗阵骑士"],
  );
  assert.deepEqual(
    extractMergeKeys("【gamesforfarm】完成任务免费领取《Milf City》"),
    ["milf city"],
  );
});

test("mergeKey：非《》中文标题保留主体词，不误合并不同商家", () => {
  const zhipu = mergeKey("智谱的coding plan免费送【7天体验卡】");
  const ali = mergeKey("阿里云 coding plan 免费送");
  assert.ok(zhipu.includes("智谱"));
  assert.ok(ali.includes("阿里云"));
  assert.notEqual(zhipu, ali);

  // 《AFF》不当作书名，不退化成 "aff windows"
  const tianyi = mergeKey("《AFF》天翼的免费云电脑，8G+4核，竟然是Windows的");
  assert.ok(tianyi.includes("天翼"));
  assert.notEqual(tianyi, "aff windows");

  // 英文游戏与无《》中文标题也能打通
  assert.equal(mergeKey("Epic 免费领 Flotsam"), "flotsam");
  assert.equal(mergeKey("Flotsam is free on Epic Games Store"), "flotsam");
});

test("TitleDeduper：无论排序先后，双语桥接都能把英文/双语/纯中文归为同一组", () => {
  const items = [
    { id: 1, title: "Knightica is free on Epic Games Store" },
    { id: 2, title: "Epic《斗阵骑士》免费领，11月20日0点截止" },
    { id: 3, title: "Epic 喜加一：《斗阵骑士 Knightica》游戏免费领取" },
    { id: 4, title: "【Epic移动版】《斗阵骑士》本周免费领取" },
    { id: 5, title: "【gamesforfarm】完成任务免费领取《Milf City》" },
  ];
  const out = dedupeByTitle(items);
  assert.deepEqual(out.map((i) => i.id), [1, 5]);
});

test("TitleDeduper：无《》中文近重复能合并，不同品牌不误并", () => {
  const items = [
    { id: 1, title: "阿里云免费领取 3 个月 ECS 云服务器" },
    { id: 2, title: "阿里云免费领3个月ECS云服务器体验" },
    { id: 3, title: "腾讯云免费领取 3 个月轻量服务器" },
    { id: 4, title: "智谱的coding plan免费送【7天体验卡】" },
    { id: 5, title: "阿里云百炼 coding plan 免费送" },
  ];
  const out = dedupeByTitle(items);
  assert.deepEqual(out.map((i) => i.id), [1, 3, 4, 5]);
});

test("TitleDeduper：跨日 seed 命中英文版时，后续中文与双语版也被拦截", () => {
  const seeds = [{ title: "[Epic Games] (Game) Knightica" }];
  const today = [
    { id: 10, title: "Epic《斗阵骑士》免费领，11月20日0点截止" },
    { id: 11, title: "Epic 喜加一：《斗阵骑士 Knightica》游戏免费领取" },
    { id: 12, title: "【Epic移动版】《斗阵骑士》本周免费领取" },
    { id: 13, title: "【gamesforfarm】完成任务免费领取《Milf City》" },
  ];
  const deduper = new TitleDeduper(today, seeds);
  assert.equal(deduper.isDuplicate(today[0]!), true);
  assert.equal(deduper.isDuplicate(today[1]!), true);
  assert.equal(deduper.isDuplicate(today[2]!), true);
  assert.equal(deduper.isDuplicate(today[3]!), false);
});

test("pickDaily：同轮多个来源报道《斗阵骑士》只保留 1 条并自动顺延补足条数", () => {
  const now = new Date().toISOString();
  const sample = [
    { id: 1, src: "linuxdo-welfare", cat: "other", score: 88, title: "智谱的coding plan免费送【7天体验卡】" },
    { id: 2, src: "rss-ithome", cat: "game", score: 85, title: "Epic 喜加一：《斗阵骑士 Knightica》游戏免费领取" },
    { id: 3, src: "rss-nodeseek", cat: "other", score: 82, title: "免费1GB流量eSIM 大陆可以用 多地区 🈚aff" },
    { id: 4, src: "linuxdo-welfare", cat: "other", score: 80, title: "众安银行lv2拼团，免费领实体卡攻略" },
    { id: 5, src: "rss-nodeseek", cat: "ai", score: 78, title: "《AFF》天翼的免费云电脑，8G+4核，竟然是Windows的" },
    { id: 6, src: "rss-smzdm", cat: "game", score: 76, title: "Epic《斗阵骑士》免费领，11月20日0点截止" },
    { id: 7, src: "rss-keylol", cat: "game", score: 74, title: "【Epic移动版】《斗阵骑士》本周免费领取" },
    { id: 8, src: "rss-keylol", cat: "game", score: 72, title: "【gamesforfarm】完成任务免费领取《Milf City》" },
    { id: 9, src: "steam-free", cat: "game", score: 70, title: "Steam 免费领取《Flotsam》游戏本体" },
    { id: 10, src: "v2ex-free", cat: "cloud", score: 68, title: "免费领取 Cloudflare R2 10GB 永久额度" },
  ];

  for (const s of sample) {
    run(
      `INSERT INTO items (id, source_id, external_id, url, url_key, title, title_key, category, score, published_at, status, is_free, obtain, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 'free', ?, ?)`,
      s.id,
      s.src,
      String(s.id),
      `https://example.com/${s.id}`,
      `example.com/${s.id}`,
      s.title,
      mergeKey(s.title),
      s.cat,
      s.score,
      now,
      now,
      now,
    );
  }

  const picked = pickDaily(new Date(), 8);
  assert.equal(picked.length, 8);
  const pickedIds = picked.map((p) => p.id);
  // 2、6、7 同属《斗阵骑士》，只保留高分 #2，自动顺延补进 #9 与 #10
  assert.deepEqual(pickedIds, [1, 2, 3, 4, 5, 8, 9, 10]);

  // 昨日日报如果已经发过英文版 Knightica，今日再挑精选时 2/6/7 应全部跳过
  const yesterday = new Date(Date.now() - 86_400_000);
  const yDay = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  run(
    `INSERT INTO items (id, source_id, external_id, url, url_key, title, title_key, category, score, published_at, status, is_free, obtain, first_seen_at, last_seen_at)
     VALUES (99, 'epic-free', '99', 'https://example.com/99', 'example.com/99', 'Knightica is free on Epic Games Store', 'knightica', 'game', 90, ?, 'active', 1, 'free', ?, ?)`,
    yesterday.toISOString(),
    yesterday.toISOString(),
    yesterday.toISOString(),
  );
  run(
    "INSERT INTO digests (date, item_ids, payload, created_at, pushed_at) VALUES (?, ?, '{}', ?, ?)",
    yDay,
    JSON.stringify([99]),
    yesterday.toISOString(),
    yesterday.toISOString(),
  );

  const pickedNext = pickDaily(new Date(), 8);
  const nextIds = pickedNext.map((p) => p.id);
  assert.equal(nextIds.includes(2), false);
  assert.equal(nextIds.includes(6), false);
  assert.equal(nextIds.includes(7), false);
});

test("mergeKey：Bluesky / TG / Reddit / IndieGameBundles 长尾推文全部收敛为 knightica", () => {
  const variants = [
    "Knightica is free on Epic Games Store — build an army and let the synergies do the fighting",
    "[Epic Games Mobile] (Game) Knightica **Knightica** \\-> Android ( EGS Store ) / iOS ( EGS Store ) **Claim All** (Mobile) -> Here . View Post on Reddit for comments Join | Shar",
    "Knightica is free on Epic Games Store mobile iOS buff.ly/vcvjSZ1 Android buff.ly/MgFQWTQ",
    "Knightica (Mobile) is Free via Epic Games Store. IOS https://ow.ly/iIhn51069o5 Android https://ow.ly/IBIv51069ob",
    "[Epic/Epic Mobile] (Game) Knightica is free! See the /r/FreeGameFindings thread below. #FGF #FreeGameFindings #Free redd.it/1xuginp redd.it/1xugop9",
    "(PCDD) Knightica is Free via The Epic Games Store. Alien: Isolation & Mark of the Deep Will be Free Next Week. https://ow.ly/E74a51068Ut #ad",
    "Knightica is free on Epic Games Store. Alien: Isolation & Mark of the Deep are the next free titles buff.ly/MdEraPT",
    "Free Knightica (Epic Games, reg. $14.99) — free to keep starting today 11 AM ET through Nov 19",
    "[Multi] [Knightica] [CA$16.99 → Free] [Recruit units, place them strategically and find the best synergies]",
  ];
  for (const t of variants) {
    assert.equal(mergeKey(t), "knightica", `failed on: ${t}`);
  }
});

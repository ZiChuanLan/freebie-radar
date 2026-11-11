import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, enrichItem, scoreItem } from "../src/server/enrich/index.ts";
import { cleanText, guessExpiry, normalizeUrl, parseDate, urlKey } from "../src/server/enrich/normalize.ts";

test("URL 规范化：追踪参数、片段、尾斜杠都不影响去重键", () => {
  const a = "https://Example.com/deal/1?utm_source=x&utm_medium=y&b=2#top";
  const b = "https://example.com/deal/1/?b=2";
  assert.equal(normalizeUrl(a), "https://example.com/deal/1?b=2");
  assert.equal(urlKey(a), urlKey(b));
});

test("URL 规范化：不同 query 值仍是不同资源", () => {
  assert.notEqual(urlKey("https://a.com/p?id=1"), urlKey("https://a.com/p?id=2"));
});

test("URL 规范化：保留有意义的 query，去掉 utm_ 前缀的全部参数", () => {
  assert.equal(normalizeUrl("https://a.com/p?utm_campaign=z&page=3&spm=abc"), "https://a.com/p?page=3");
});

test("分类：AI 额度", () => {
  assert.equal(classify("免费领取 GPT-4 API 额度", "").category, "ai");
  assert.equal(classify("Gemini Pro 注册送 10 美元", "").category, "ai");
});

test("分类：影音会员", () => {
  assert.equal(classify("网易云音乐免费领取会员 7 天，需要自取", "").category, "media");
});

test("分类：域名与主机", () => {
  assert.equal(classify("免费 .dev 域名注册一年", "").category, "domain");
});

test("分类：无关键词落 other", () => {
  assert.equal(classify("今天天气不错", "").category, "other");
});

test("评分：过期资源归零且 keep=false", () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const enriched = enrichItem(
    { externalId: "x", url: "https://a.com/x", title: "免费领取会员", expiresAt: past },
    "linuxdo-welfare",
  );
  assert.ok(enriched);
  assert.equal(enriched.score, 0);
  assert.equal(enriched.keep, false);
});

test("评分：24 小时内发布明显高于 60 天前", () => {
  const fresh = new Date().toISOString();
  const old = new Date(Date.now() - 60 * 86400000).toISOString();
  const base = { summary: "免费领取", sourceId: "v2ex-free", category: "other" as const, tags: [], expiresAt: null };
  const sFresh = scoreItem({ ...base, title: "免费领取会员", publishedAt: fresh }).score;
  const sOld = scoreItem({ ...base, title: "免费领取会员", publishedAt: old }).score;
  assert.ok(sFresh > sOld + 15, "fresh=" + sFresh + " old=" + sOld);
});

test("评分：求资源类疑问句被压分", () => {
  const p = new Date().toISOString();
  const base = { summary: "", sourceId: "linuxdo-welfare", category: "other" as const, tags: [], expiresAt: null };
  const ask = scoreItem({ ...base, title: "请问有没有免费的 GPT 额度", publishedAt: p }).score;
  const deal = scoreItem({ ...base, title: "免费送 GPT 额度，先到先得", publishedAt: p }).score;
  assert.ok(deal > ask, "deal=" + deal + " ask=" + ask);
});

test("清洗：HTML 转纯文本并截断", () => {
  assert.equal(cleanText("<p>免费&nbsp;领取</p><script>x</script>"), "免费 领取");
  assert.ok(cleanText("a".repeat(500), 10).endsWith("…"));
});

test("时间解析：秒级时间戳与 RFC822", () => {
  assert.equal(parseDate(1794329084), new Date(1794329084 * 1000).toISOString());
  assert.equal(parseDate("Wed, 10 Nov 2026 16:24:46 GMT"), "2026-11-10T16:24:46.000Z");
  assert.equal(parseDate("not a date"), null);
});

test("过期推断：识别月日与相对天数", () => {
  assert.ok(guessExpiry("活动截止 12 月 31 日"));
  assert.ok(guessExpiry("3 天内有效"));
  assert.equal(guessExpiry("没有任何日期"), null);
});

test("AI 二审关闭时（默认配置）全链路正常出结果", () => {
  const enriched = enrichItem(
    { externalId: "y", url: "https://a.com/y", title: "免费领取 7 天会员", publishedAt: new Date().toISOString() },
    "v2ex-free",
  );
  assert.ok(enriched);
  assert.ok(enriched.score >= 40);
  assert.equal(enriched.category, "media");
});

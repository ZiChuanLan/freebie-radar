const base = "http://127.0.0.1:8788";

async function j(path) {
  const r = await fetch(base + path);
  if (!r.ok) return { error: r.status };
  return r.json();
}

const verified = await j("/api/items?unexpired=1&maxAgeDays=7&aiOnly=1&obtain=free&limit=3");
console.log("真福利精选 total:", verified.total);
for (const it of verified.items ?? []) {
  console.log("  ", (it.obtain ?? "?").padEnd(11), "|", it.title.slice(0, 46));
}

const lottery = await j("/api/items?obtain=lottery&limit=3");
console.log("\n抽奖 total:", lottery.total);
for (const it of lottery.items ?? []) console.log("  ", (it.obtain ?? "?").padEnd(11), "|", it.title.slice(0, 46));

const trial = await j("/api/items?obtain=trial&limit=2");
console.log("\n试用 total:", trial.total);

const promo = await j("/api/items?obtain=promo&limit=2");
console.log("推广 total:", promo.total);

const stats = await j("/api/stats");
console.log("\nstats.cleanFree:", stats.totals?.cleanFree, " aiKept:", stats.totals?.aiKept);

const push = await j("/api/push");
console.log("push.obtainModes:", JSON.stringify(push.settings?.obtainModes));

const prev = await j("/api/push/preview");
console.log("推送预览 instant:", prev.instant?.length ?? 0, "batch:", prev.batch?.length ?? 0);
for (const t of (prev.instant ?? []).slice(0, 3)) {
  console.log("  ⚡", t.split("\n")[1]?.slice(0, 50));
}

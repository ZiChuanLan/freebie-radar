const FS = "http://127.0.0.1:8191/v1";
async function fsGet(url) {
  const r = await fetch(FS, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 45000 }),
    signal: AbortSignal.timeout(50000),
  });
  const j = await r.json();
  return { status: j.solution?.status ?? 0, body: String(j.solution?.response ?? "") };
}

for (const u of [
  "https://nitter.tiekoetter.com/EpicGames/rss",
  "https://lightbrd.com/EpicGames/rss",
  "https://nitter.privacyredirect.com/EpicGames/rss",
  "https://gg.deals/deals/freebies/",
  "https://www.steamgifts.com/giveaways/feed",
]) {
  try {
    const r = await fsGet(u);
    const items = (r.body.match(/<item[\s>]|<entry[\s>]|game-info-title|data-original-title/g) || []).length;
    console.log(u.padEnd(48), r.status, String(r.body.length).padStart(7) + "B", "hits=" + items, r.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 70));
  } catch (e) {
    console.log(u.padEnd(48), "ERR", String(e).slice(0, 50));
  }
}

console.log("\n=== CheapShark sample ===");
const cs = await fetch("https://www.cheapshark.com/api/1.0/deals?upperPrice=1&pageSize=8", { signal: AbortSignal.timeout(15000) });
const csj = await cs.json();
console.log(JSON.stringify(csj.slice(0, 3), null, 1).slice(0, 800));

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

const mirrors = [
  "https://xcancel.com/EpicGames/rss",
  "https://nitter.poast.org/EpicGames/rss",
  "https://nitter.privacyredirect.com/EpicGames/rss",
  "https://lightbrd.com/EpicGames/rss",
  "https://nitter.tiekoetter.com/EpicGames/rss",
  "https://twiiit.com/EpicGames/rss",
  "https://rss-bridge.org/bridge01/?action=display&bridge=TwitterBridge&context=By+username&u=EpicGames&format=Atom",
  "https://www.cheapshark.com/api/1.0/deals?upperPrice=0&pageSize=20",
  "https://www.cheapshark.com/api/1.0/deals?upperPrice=1&pageSize=10",
  "https://www.reddit.com/r/FreeGamesOnSteam/hot.rss",
  "https://www.reddit.com/r/kindlefreebies/hot.rss",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const url of mirrors) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    const text = await res.text();
    const items = (text.match(/<item[\s>]|<entry[\s>]/g) || []).length;
    console.log(url.slice(0, 62).padEnd(64), String(res.status).padEnd(5), String(text.length).padStart(7) + "B", "items=" + items, text.replace(/\s+/g, " ").slice(0, 60));
  } catch (e) {
    console.log(url.slice(0, 62).padEnd(64), "ERR ", String(e.cause?.code || e.name || e).slice(0, 30));
  }
  await sleep(1500);
}

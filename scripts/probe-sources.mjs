const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const targets = [
  ["reddit_rss", "https://www.reddit.com/r/FreeGameFindings/hot.rss"],
  ["old_reddit_json", "https://old.reddit.com/r/FreeGameFindings/hot.json?limit=10"],
  ["gog_free", "https://www.gog.com/games/ajax/filtered?mediaType=game&price=free&sort=newest"],
  ["itch_free", "https://itch.io/games/free"],
  ["steam_free", "https://store.steampowered.com/search/?maxprice=free&specials=1"],
  ["slickdeals_rss", "https://slickdeals.net/newsearch.php?rss=1&searcharea=deals&searchin=first"],
  ["freestufffinder", "https://freestufffinder.com/feed/"],
  ["heyitsfree", "https://heyitsfree.net/feed/"],
  ["gamerpower_steam", "https://www.gamerpower.com/api/giveaways?platform=steam&type=game"],
  ["gamerpower_all", "https://www.gamerpower.com/api/giveaways?type=game"],
  ["epic_freegames", "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US"],
  ["keylol_rss", "https://keylol.com/forum.php?mod=rss"],
  ["nga_free", "https://bbs.nga.cn/thread.php?fid=-7"],
  ["prime_gaming", "https://gaming.amazon.com/home"],
  ["humble_free", "https://www.humblebundle.com/store/search?sort=bestselling&filter=onsale"],
  ["x_epicgames", "https://x.com/EpicGames"],
  ["nitter_epic", "https://nitter.net/EpicGames/rss"],
  ["steamdb_free", "https://steamdb.info/upcoming/free/"],
];
const out = await Promise.allSettled(targets.map(async ([name, url]) => {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = (res.headers.get("content-type") || "").split(";")[0];
  return name.padEnd(18) + " " + String(res.status).padEnd(4) + " " + ct.padEnd(28) + " " + String(buf.length).padStart(7) + "B " + (Date.now() - t0) + "ms";
}));
for (let i = 0; i < out.length; i += 1) {
  const r = out[i];
  console.log(r.status === "fulfilled" ? r.value : targets[i][0].padEnd(18) + " ERR " + String(r.reason).slice(0, 60));
}

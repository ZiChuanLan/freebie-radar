const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const targets = [
  ["r_freebies", "https://www.reddit.com/r/freebies/hot.rss"],
  ["r_coupons", "https://www.reddit.com/r/coupons/hot.rss"],
  ["r_deals", "https://www.reddit.com/r/deals/hot.rss"],
  ["r_apphookup", "https://www.reddit.com/r/AppHookup/hot.rss"],
  ["r_googleplaydeals", "https://www.reddit.com/r/googleplaydeals/hot.rss"],
  ["r_freeebooks", "https://www.reddit.com/r/FreeEBOOKS/hot.rss"],
  ["r_udemyfreebies", "https://www.reddit.com/r/udemyfreebies/hot.rss"],
  ["r_freeudemycoupons", "https://www.reddit.com/r/FreeUdemyCoupons/hot.rss"],
  ["r_freegamesonsteam", "https://www.reddit.com/r/freegamesonsteam/hot.rss"],
  ["r_freegamestuff", "https://www.reddit.com/r/FreeGameStuffs/hot.rss"],
  ["giveawayoftheday", "https://www.giveawayoftheday.com/feed/"],
  ["appinn", "https://www.appinn.com/feed/"],
  ["sspai", "https://sspai.com/feed"],
  ["ithome", "https://www.ithome.com/rss/"],
  ["producthunt", "https://www.producthunt.com/feed"],
  ["hnrss", "https://hnrss.org/frontpage?points=100"],
  ["dealnews", "https://www.dealnews.com/rss/"],
  ["bensbargains", "https://www.bensbargains.com/rss/"],
  ["hunt4freebies", "https://hunt4freebies.com/feed/"],
  ["freebieshark", "https://www.freebieshark.com/feed/"],
  ["sampleaday", "https://sampleaday.com/feed/"],
  ["ninetofive", "https://9to5toys.com/feed/"],
  ["dealmac", "https://www.dealmac.com/rss/"],
  ["gog_free_games", "https://www.gog.com/games?priceRange=0,0"],
  ["fanatical_free", "https://www.fanatical.com/en/free-games"],
  ["indiegala_freebies", "https://freebies.indiegala.com/"],
  ["gmg_freebies", "https://www.greenmangaming.com/freebies/"],
  ["humble_free", "https://www.humblebundle.com/store/search?sort=bestselling&filter=onsale"],
  ["psn_monthly", "https://www.playstation.com/en-us/ps-plus/whats-new/"],
  ["xbox_gwg", "https://www.xbox.com/en-US/games/games-with-gold"],
  ["epic_free_page", "https://store.epicgames.com/zh-CN/free-games"],
  ["kafan", "https://www.kafan.cn/"],
  ["pcbeta", "https://bbs.pcbeta.com/forum.php?mod=rss"],
  ["jd_try", "https://try.jd.com/"],
  ["smzdm_haojia", "https://www.smzdm.com/feed"],
  ["free_app_watch", "https://freeappswatch.com/"],
  ["appsliced", "https://appsliced.co/"],
  ["steamgifts", "https://www.steamgifts.com/"],
  ["keyforsteam", "https://www.keyforsteam.de/"],
  ["giveawaybase", "https://www.giveawaybase.com/"],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = new Array(targets.length).fill(null);
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const i = cursor++;
    const [name, url] = targets[i];
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = (res.headers.get("content-type") || "").split(";")[0];
      results[i] = name.padEnd(20) + String(res.status).padEnd(5) + ct.padEnd(26) + String(buf.length).padStart(7) + "B";
    } catch (e) {
      results[i] = name.padEnd(20) + "ERR  " + String(e.cause?.code || e.name || e).slice(0, 30);
    }
    await sleep(400);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
for (const r of results) console.log(r);

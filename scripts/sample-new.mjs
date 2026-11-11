const UA = "freebie-radar/0.2 (+https://github.com/local/freebie-radar)";
const feeds = [
  ["isthereanydeal", "https://isthereanydeal.com/feeds/US/giveaways.rss"],
  ["indiegamebundles", "https://www.indiegamebundles.com/category/free/feed/"],
  ["sharewareonsale", "https://sharewareonsale.com/feed"],
  ["giveaway_tick", "https://giveaway.tickcoupon.com/feed/"],
  ["iapps_me", "https://www.iapps.me/feed"],
  ["iplaysoft", "https://www.iplaysoft.com/feed"],
  ["guoke_ghxi", "https://www.ghxi.com/feed"],
  ["runningcheese", "https://www.runningcheese.com/feed"],
  ["vonbeau", "https://www.vonbeau.com/feed/"],
  ["hip2save", "https://hip2save.com/feed/"],
  ["ozbargain", "https://www.ozbargain.com.au/feed"],
  ["hotukdeals", "https://www.hotukdeals.com/rss/new"],
  ["dealabs", "https://www.dealabs.com/rss/nouveaux"],
  ["nodeseek", "https://rss.nodeseek.com/"],
  ["lowendbox", "https://lowendbox.com/feed/"],
  ["gg_deals_news", "https://gg.deals/news/feed/"],
  ["ruanyifeng", "https://www.ruanyifeng.com/blog/atom.xml"],
];

await Promise.all([
  ...feeds.map(async ([name, url]) => {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
      const t = await r.text();
      const titles = [...t.matchAll(/<(?:item|entry)[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/gi)]
        .slice(0, 2)
        .map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/\s+/g, " ").trim().slice(0, 48));
      console.log(name.padEnd(18), titles.join("  ||  "));
    } catch (e) { console.log(name.padEnd(18), "ERR"); }
  }),
  ...["wario64.bsky.social", "cheapassgamer.com", "dekudeals.com", "freegamefindings.bsky.social", "freegamealert.bsky.social", "frugalfreebies.bsky.social", "plugindeals.net"].map(async (actor) => {
    try {
      const r = await fetch("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=" + actor + "&limit=3", { signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      const first = (j.feed || []).map((f) => f?.post?.record?.text?.replace(/\s+/g, " ")?.slice(0, 48)).slice(0, 2);
      console.log(("bsky:" + actor.split(".")[0]).padEnd(18), first.join("  ||  "));
    } catch { console.log("bsky:" + actor, "ERR"); }
  }),
]);

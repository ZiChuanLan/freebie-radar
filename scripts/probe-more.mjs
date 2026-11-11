const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FS = "http://127.0.0.1:8191/v1";

const directTargets = [
  // === 1. 游戏 / 折扣 / 限免 API 与 RSS ===
  ["cheapshark_free", "https://www.cheapshark.com/api/1.0/deals?upperPrice=0&pageSize=30"],
  ["cheapshark_1usd", "https://www.cheapshark.com/api/1.0/deals?upperPrice=1&pageSize=20"],
  ["isthereanydeal_rss", "https://isthereanydeal.com/feeds/US/giveaways.rss"],
  ["indiegamebundles", "https://www.indiegamebundles.com/category/free/feed/"],
  ["grabfreegames", "https://www.grabfreegames.com/feed/"],
  ["freegamesdl", "https://www.freegamesdl.net/feed/"],
  ["gg_deals_news", "https://gg.deals/news/feed/"],
  ["gg_deals_freebies", "https://gg.deals/deals/freebies/"],
  ["steamgifts_rss", "https://www.steamgifts.com/giveaways/feed"],
  ["lootscraper_json", "https://raw.githubusercontent.com/eXceLiTe/LootScraper/main/data/all.json"],

  // === 2. 软件 / App 限免 / 科技工具 ===
  ["sharewareonsale", "https://sharewareonsale.com/feed"],
  ["giveaway_tick", "https://giveaway.tickcoupon.com/feed/"],
  ["winningpc", "https://winningpc.com/feed/"],
  ["bitsdujour", "https://www.bitsdujour.com/rss/software"],
  ["mac_free", "https://www.macrumors.com/roundups/free-apps/"],
  ["appsgonefree", "https://www.appadvice.com/appsgonefree/rss"],
  ["iapps_me", "https://www.iapps.me/feed"],
  ["app_so_rss", "https://www.ifanr.com/feed"],
  ["iplaysoft", "https://www.iplaysoft.com/feed"],
  ["gh_trending_json", "https://api.github.com/search/repositories?q=free+api+OR+awesome+free+sort:updated&per_page=20"],
  ["gh_public_apis", "https://api.github.com/repos/public-apis/public-apis/contents/README.md"],
  ["gh_free_certs", "https://api.github.com/repos/cloudcommunity/Cloud-Free-Tier-Comparison/contents/README.md"],
  ["gh_ai_free", "https://api.github.com/repos/mahseema/awesome-ai-tools/contents/README.md"],
  ["gh_awesome_selfhosted", "https://api.github.com/repos/awesome-selfhosted/awesome-selfhosted/contents/README.md"],

  // === 3. 国外综合羊毛 / 样装 / 电子书 / 教育 ===
  ["reddit_freestuff", "https://www.reddit.com/r/FreeStuff/hot.rss"],
  ["reddit_pcgames", "https://www.reddit.com/r/FreeGamesOnSteam/hot.rss"],
  ["reddit_kindle", "https://www.reddit.com/r/kindlefreebies/hot.rss"],
  ["reddit_steamgiveaway", "https://www.reddit.com/r/steam_giveaway/hot.rss"],
  ["reddit_randomactsofgaming", "https://www.reddit.com/r/RandomActsOfGaming/hot.rss"],
  ["reddit_audible", "https://www.reddit.com/r/audible/hot.rss"],
  ["reddit_buildapcsales", "https://www.reddit.com/r/buildapcsales/hot.rss"],
  ["vonbeau", "https://www.vonbeau.com/feed/"],
  ["mysavings", "https://www.mysavings.com/rss/"],
  ["hip2save", "https://hip2save.com/feed/"],
  ["dealabs_free", "https://www.dealabs.com/rss/gratuit"],
  ["hotukdeals_free", "https://www.hotukdeals.com/rss/freebies"],
  ["mydealz_free", "https://www.mydealz.de/rss/kostenlos"],
  ["ozbargain_free", "https://www.ozbargain.com.au/deals/free/feed"],

  // === 4. 国内社区 / 博客 / V2EX 更多节点 ===
  ["v2ex_deals", "https://www.v2ex.com/api/topics/show.json?node_name=deals"],
  ["v2ex_share", "https://www.v2ex.com/api/topics/show.json?node_name=share"],
  ["v2ex_promotions", "https://www.v2ex.com/api/topics/show.json?node_name=promotions"],
  ["v2ex_cloud", "https://www.v2ex.com/api/topics/show.json?node_name=cloud"],
  ["ruanyifeng", "https://www.ruanyifeng.com/blog/atom.xml"],
  ["runningcheese", "https://www.runningcheese.com/feed"],
  ["guoke_ghxi", "https://www.ghxi.com/feed"],
  ["lanzou_free_blog", "https://www.423down.com/feed"],
  ["yiciyuan", "https://www.iplaysoft.com/feed"],
  ["mpyit", "https://www.mpyit.com/feed"],
  ["aizhan_free", "https://www.aibase.com/zh/rss"],
  ["qbitai", "https://www.qbitai.com/feed"],
  ["jiqizhixin", "https://www.jiqizhixin.com/rss"],

  // === 5. Telegram 公开羊毛/资源频道候选 ===
  ["tg_freegames", "https://t.me/s/FreeGamesInfo"],
  ["tg_epicfree", "https://t.me/s/EpicFreeGames"],
  ["tg_zaihuapd", "https://t.me/s/zaihuapd"],
  ["tg_xhb", "https://t.me/s/xiaohongbao"],
  ["tg_fuli", "https://t.me/s/fulishe"],
  ["tg_yangmao", "https://t.me/s/yangmaozhujia"],
  ["tg_vps", "https://t.me/s/vps_offers"],
  ["tg_lowendtalk", "https://t.me/s/lowendspirit"],
  ["tg_app_free", "https://t.me/s/AppsGoneFree"],
  ["tg_steam_free", "https://t.me/s/freegamesnews"],
  ["tg_ai_news", "https://t.me/s/ai_newss"],
  ["tg_linuxdo", "https://t.me/s/linuxdo_channel"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkDirect([name, url]) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") || "").split(";")[0];
    const body = buf.toString("utf8");
    const items = (body.match(/<item[\s>]|<entry[\s>]|tgme_widget_message_wrap/g) || []).length;
    let jsonHint = "";
    if (ct.includes("json") || body.trimStart().startsWith("{") || body.trimStart().startsWith("[")) {
      try {
        const j = JSON.parse(body);
        jsonHint = Array.isArray(j) ? "arr(" + j.length + ")" : "obj(" + Object.keys(j).slice(0,4).join(",") + ")";
      } catch {}
    }
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
    const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/\s+/g, " ").trim().slice(0, 32) : "";
    return { name, status: res.status, ct, bytes: buf.length, items, jsonHint, title };
  } catch (e) {
    return { name, err: String(e.cause?.code || e.name || e).slice(0, 28) };
  }
}

let idx = 0;
const out = new Array(directTargets.length);
await Promise.all(Array.from({ length: 6 }, async () => {
  while (idx < directTargets.length) {
    const i = idx++;
    out[i] = await checkDirect(directTargets[i]);
    await sleep(300);
  }
}));

for (const r of out) {
  if (r.err) console.log(r.name.padEnd(24), "ERR ", r.err);
  else console.log(r.name.padEnd(24), String(r.status).padEnd(5), (r.ct || "-").padEnd(24), String(r.bytes).padStart(7) + "B", "items=" + String(r.items).padEnd(4), r.jsonHint || r.title);
}

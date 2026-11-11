const UA = "freebie-radar/0.2 (+https://github.com/local/freebie-radar)";
const FS = "http://127.0.0.1:8191/v1";

const rssAndTg = [
  ["ozbargain_all", "https://www.ozbargain.com.au/feed"],
  ["ozbargain_cat_free", "https://www.ozbargain.com.au/cat/freebies/feed"],
  ["hotukdeals_new", "https://www.hotukdeals.com/rss/new"],
  ["mydealz_new", "https://www.mydealz.de/rss/alle"],
  ["dealabs_new", "https://www.dealabs.com/rss/nouveaux"],
  ["tg_zaihua_bot", "https://t.me/s/zaihuayouhui"],
  ["tg_appinn", "https://t.me/s/appinnfeed"],
  ["tg_tginfo", "https://t.me/s/TestFlightCN"],
  ["tg_freegame_cn", "https://t.me/s/free_game_cn"],
  ["tg_linuxdo_fast", "https://t.me/s/linuxdo_org"],
  ["tg_nodeseek", "https://t.me/s/nodeseekc"],
  ["tg_hostloc", "https://t.me/s/hostloc_channel"],
  ["tg_epic_notify", "https://t.me/s/epicgamesfree"],
  ["tg_ios_free", "https://t.me/s/ios_xianmian"],
  ["tg_xianmian", "https://t.me/s/xianmian"],
  ["tg_aigc_free", "https://t.me/s/aigc_free"],
  ["v2ex_all_deals", "https://www.v2ex.com/api/topics/latest.json"],
  ["epic_rss_mirror", "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN"],
];

for (const [name, url] of rssAndTg) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const body = buf.toString("utf8");
    const items = (body.match(/<item[\s>]|<entry[\s>]|tgme_widget_message_wrap/g) || []).length;
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "")?.replace(/\s+/g, " ")?.trim()?.slice(0, 32) || "";
    console.log(name.padEnd(20), String(res.status).padEnd(5), String(buf.length).padStart(7) + "B", "items=" + String(items).padEnd(4), t);
  } catch (e) {
    console.log(name.padEnd(20), "ERR ", String(e.cause?.code || e.name || e).slice(0, 28));
  }
}

console.log("\n=== FlareSolverr tests ===");
const fsTargets = [
  ["fs_lowendtalk", "https://lowendtalk.com/discussions/feed.rss"],
  ["fs_steamgifts", "https://www.steamgifts.com/giveaways/feed"],
  ["fs_gg_freebies", "https://gg.deals/deals/freebies/"],
  ["fs_hostloc_rss", "https://hostloc.com/forum.php?mod=rss"],
];
for (const [name, url] of fsTargets) {
  try {
    const r = await fetch(FS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 45000, session: "radar" }),
      signal: AbortSignal.timeout(50000),
    });
    const j = await r.json();
    const body = String(j.solution?.response ?? "");
    const items = (body.match(/<item[\s>]|<entry[\s>]|data-original-title|game-info-title/g) || []).length;
    console.log(name.padEnd(20), String(j.solution?.status ?? 0).padEnd(5), String(body.length).padStart(7) + "B", "hits=" + items, body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60));
  } catch (e) {
    console.log(name.padEnd(20), "ERR ", String(e).slice(0, 50));
  }
}

const UA = "freebie-radar/0.2 (+https://github.com/local/freebie-radar)";
const targets = [
  ["dealabs_free", "https://www.dealabs.com/rss/gratuit"],
  ["hotukdeals_free", "https://www.hotukdeals.com/rss/freebies"],
  ["mydealz_free", "https://www.mydealz.de/rss/kostenlos"],
  ["ozbargain_free", "https://www.ozbargain.com.au/deals/free/feed"],
  ["v2ex_deals", "https://www.v2ex.com/api/topics/show.json?node_name=deals"],
  ["v2ex_share", "https://www.v2ex.com/api/topics/show.json?node_name=share"],
  ["v2ex_promotions", "https://www.v2ex.com/api/topics/show.json?node_name=promotions"],
  ["v2ex_cloud", "https://www.v2ex.com/api/topics/show.json?node_name=cloud"],
  ["ruanyifeng", "https://www.ruanyifeng.com/blog/atom.xml"],
  ["runningcheese", "https://www.runningcheese.com/feed"],
  ["guoke_ghxi", "https://www.ghxi.com/feed"],
  ["423down", "https://www.423down.com/feed"],
  ["mpyit", "https://www.mpyit.com/feed"],
  ["aibase", "https://www.aibase.com/zh/rss"],
  ["qbitai", "https://www.qbitai.com/feed"],
  ["nodeseek_rss", "https://rss.nodeseek.com/"],
  ["nodeseek_home", "https://www.nodeseek.com/"],
  ["lowendtalk_rss", "https://lowendtalk.com/discussions/feed.rss"],
  ["lowendbox", "https://lowendbox.com/feed/"],
  ["tg_freegamesinfo", "https://t.me/s/FreeGamesInfo"],
  ["tg_epicfreegames", "https://t.me/s/EpicFreeGames"],
  ["tg_zaihuapd", "https://t.me/s/zaihuapd"],
  ["tg_zaihuayun", "https://t.me/s/zaihuayun"],
  ["tg_fulibao", "https://t.me/s/fuliba"],
  ["tg_pinyangmao", "https://t.me/s/yangmao"],
  ["tg_vps_offers", "https://t.me/s/vps_offers"],
  ["tg_lowendspirit", "https://t.me/s/lowendspirit"],
  ["tg_appsgonefree", "https://t.me/s/AppsGoneFree"],
  ["tg_freegamesnews", "https://t.me/s/freegamesnews"],
  ["tg_steam_news", "https://t.me/s/steamdb"],
  ["tg_linuxdo", "https://t.me/s/linux_do_channel"],
];

for (const [name, url] of targets) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") || "").split(";")[0];
    const body = buf.toString("utf8");
    const items = (body.match(/<item[\s>]|<entry[\s>]|tgme_widget_message_wrap/g) || []).length;
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "")?.replace(/\s+/g, " ")?.trim()?.slice(0, 32) || "";
    console.log(name.padEnd(20), String(res.status).padEnd(5), (ct || "-").padEnd(22), String(buf.length).padStart(7) + "B", "items=" + String(items).padEnd(4), t);
  } catch (e) {
    console.log(name.padEnd(20), "ERR ", String(e.cause?.code || e.name || e).slice(0, 28));
  }
}

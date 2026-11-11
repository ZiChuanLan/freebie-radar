const UA = "Mozilla/5.0 Chrome/131.0.0.0";

// 1) Bluesky 搜索相关博主（免登录）
for (const term of ["freegame", "gamedeals", "freebies", "epicgames", "dekudeals"]) {
  const r = await fetch("https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=" + encodeURIComponent(term) + "&limit=5", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  console.log("actor search:", term, "->", (j.actors || []).map((a) => a.handle + "(" + (a.displayName || "").slice(0, 20) + ")").join(" | "));
}

// 2) 检查几个确定好用的 TG 频道内容质量
for (const ch of ["zaihuapd", "nodeseekc", "linux_do_channel", "FreeGamesInfo", "EpicFreeGames", "freegamesnews", "xianmian", "appinnfeed", "vps_offers"]) {
  const r = await fetch("https://t.me/s/" + ch, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
  const html = await r.text();
  const texts = [...html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  console.log("\nTG", ch, "msgs=" + texts.length, "latest:", (texts[texts.length - 1] || "").slice(0, 90));
}

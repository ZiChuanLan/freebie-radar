const UA = "Mozilla/5.0 Chrome/131.0.0.0";
await Promise.all([
  ...["gamedeals", "freebies", "dekudeals", "cheapassgamer", "ai tools"].map(async (term) => {
    const r = await fetch("https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=" + encodeURIComponent(term) + "&limit=4", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    console.log("bsky:", term, "->", (j.actors || []).map((a) => a.handle).join(" | "));
  }),
  ...["zaihuapd", "nodeseekc", "linux_do_channel", "FreeGamesInfo", "EpicFreeGames", "freegamesnews", "xianmian", "appinnfeed", "vps_offers"].map(async (ch) => {
    const r = await fetch("https://t.me/s/" + ch, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
    const html = await r.text();
    const texts = [...html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    console.log("TG", ch.padEnd(18), "msgs=" + String(texts.length).padEnd(3), (texts[texts.length - 1] || "").slice(0, 80));
  }),
]);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
// X 的 syndication embed endpoint 在海外服务器常直接返回 JSON/HTML，不需要登录态！
for (const handle of ["EpicGames", "Wario64", "FreeGameFinding", "SteamDB"]) {
  const url = "https://syndication.twitter.com/srv/timeline-profile/screen-name/" + handle;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(text);
    let tweets = 0;
    let firstText = "";
    if (m) {
      try {
        const j = JSON.parse(m[1]);
        const entries = j?.props?.pageProps?.timeline?.entries ?? [];
        tweets = entries.length;
        const first = entries.find((e) => e?.content?.tweet?.full_text);
        firstText = first?.content?.tweet?.full_text?.replace(/\s+/g, " ")?.slice(0, 60) ?? "";
      } catch {}
    }
    console.log("syndication", handle.padEnd(18), res.status, text.length + "B", "tweets=" + tweets, firstText);
  } catch (e) {
    console.log("syndication", handle.padEnd(18), "ERR", String(e.cause?.code || e.name || e).slice(0, 30));
  }
}

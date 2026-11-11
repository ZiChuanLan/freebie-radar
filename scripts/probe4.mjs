const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

// 1) CheapShark
const cs = await fetch("https://www.cheapshark.com/api/1.0/deals?upperPrice=1&pageSize=8", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
const csText = await cs.text();
console.log("CheapShark:", cs.status, csText.slice(0, 400));

// 2) Bluesky public API (免登录、JSON、无反爬，大量 X 羊毛/游戏博主同步在 bsky)
for (const actor of ["wario64.bsky.social", "steamdb.bsky.social", "gamerpower.bsky.social", "epicgames.bsky.social", "freegames.bsky.social"]) {
  const u = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=" + encodeURIComponent(actor) + "&limit=5";
  try {
    const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    const feed = j.feed ?? [];
    console.log("bsky", actor.padEnd(26), r.status, "posts=" + feed.length, feed[0]?.post?.record?.text?.replace(/\s+/g, " ")?.slice(0, 60) || j.message || "");
  } catch (e) {
    console.log("bsky", actor.padEnd(26), "ERR", String(e).slice(0, 40));
  }
}

// 3) Bluesky 关键词搜索接口（免登录！）
for (const q of ["free game epic steam", "freebie giveaway"]) {
  const u = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=" + encodeURIComponent(q) + "&sort=latest&limit=8";
  try {
    const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    const posts = j.posts ?? [];
    console.log("bsky search", q.padEnd(22), r.status, "posts=" + posts.length, posts[0]?.record?.text?.replace(/\s+/g, " ")?.slice(0, 60) || j.message || "");
  } catch (e) {
    console.log("bsky search", q.padEnd(22), "ERR", String(e).slice(0, 40));
  }
}

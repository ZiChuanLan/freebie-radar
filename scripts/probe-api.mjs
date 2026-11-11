const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const targets = [
  ["gog_catalog", "https://catalog.gog.com/v1/catalog?limit=48&price=free&productType=in:game&countryCode=US&locale=en-US&currencyCode=USD"],
  ["humble_api", "https://www.humblebundle.com/store/api/search?sort=bestselling&filter=onsale&request=1"],
  ["fanatical_api", "https://www.fanatical.com/api/all/en?alt=true"],
  ["itch_free_json", "https://itch.io/games/free.json"],
  ["steam_search_json", "https://store.steampowered.com/search/results/?query&start=0&count=50&maxprice=free&specials=1&infinite=1"],
  ["epic_graphql", "https://store.epicgames.com/graphql"],
  ["psn_api", "https://web.np.playstation.com/api/graphql/v1//op?operationName=categoryGridRetrieve&variables=%7B%22id%22%3A%22d282e057-6a02-4d1a-9b1f-2d1a1f0f8a4a%22%7D&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22d0f2b1c1e0b0c9c0a3a3e0c4e0f0b0a0a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0d0%22%7D%7D"],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [name, url] of targets) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const txt = buf.toString("utf8");
    let hint = "";
    try {
      const j = JSON.parse(txt);
      hint = Array.isArray(j) ? "array(" + j.length + ")" : "keys=" + Object.keys(j).slice(0, 6).join(",");
    } catch { hint = txt.replace(/\s+/g, " ").slice(0, 60); }
    console.log(name.padEnd(18), String(res.status).padEnd(5), String(buf.length).padStart(8) + "B", hint.slice(0, 80));
  } catch (e) {
    console.log(name.padEnd(18), "ERR", String(e.cause?.code || e.name).slice(0, 40));
  }
  await sleep(800);
}

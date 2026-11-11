const UA = "Mozilla/5.0 Chrome/131.0.0.0";
async function tryGog(label, qs) {
  const url = "https://catalog.gog.com/v1/catalog?" + qs;
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const prods = j.products ?? [];
    const free = prods.filter((x) => String(x.price?.finalMoney?.amount ?? x.price?.final ?? "").startsWith("0"));
    console.log(label.padEnd(22), r.status, "count=" + prods.length, "free=" + free.length, free[0] ? free[0].title : "");
  } catch (e) { console.log(label.padEnd(22), "ERR", String(e).slice(0, 60)); }
}
await tryGog("discount=100", "limit=48&discount=100&productType=in:game&countryCode=US&locale=en-US&currencyCode=USD");
await tryGog("priceBetween=0,0", "limit=48&priceBetween=0,0&productType=in:game&countryCode=US&locale=en-US&currencyCode=USD");
await tryGog("price=0,0", "limit=48&price=0,0&productType=in:game&countryCode=US&locale=en-US&currencyCode=USD");

const steam = await fetch("https://store.steampowered.com/search/results/?query&start=0&count=50&maxprice=free&specials=1&infinite=1", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25000) });
const sj = await steam.json();
const html = sj.results_html ?? "";
const rows = [...html.matchAll(/<a href="(https:\/\/store\.steampowered\.com\/app\/[^"]+)"[\s\S]*?<span class="title">([^<]+)<\/span>/g)];
console.log("\nsteam total:", sj.total_count, "parsed rows:", rows.length);
for (const [, href, title] of rows.slice(0, 8)) console.log("  -", title.trim(), "|", href.split("?")[0]);

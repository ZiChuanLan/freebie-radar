const UA = "Mozilla/5.0 Chrome/131.0.0.0";
const gog = await fetch("https://catalog.gog.com/v1/catalog?limit=48&price=free&productType=in:game&countryCode=US&locale=en-US&currencyCode=USD", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25000) });
const gj = await gog.json();
const prods = gj.products ?? [];
console.log("gog products:", prods.length, "productCount:", gj.productCount);
const p = prods[0] ?? {};
console.log("keys:", Object.keys(p).join(", "));
console.log("sample:", JSON.stringify({ id: p.id, title: p.title, slug: p.slug, price: p.price, storeLink: p.storeLink, releaseDate: p.releaseDate }).slice(0, 500));
const freeOnes = prods.filter((x) => String(x.price?.finalAmount ?? x.price?.amount ?? "") === "0" || String(x.price?.final ?? "").includes("0.00"));
console.log("free by price:", freeOnes.length);

const steam = await fetch("https://store.steampowered.com/search/results/?query&start=0&count=10&maxprice=free&specials=1&infinite=1", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25000) });
const sj = await steam.json();
console.log("\nsteam total_count:", sj.total_count, "html len:", (sj.results_html ?? "").length);
const html = sj.results_html ?? "";
const row = html.slice(0, 1200);
console.log("row sample:", row);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const gogUrl = "https://catalog.gog.com/v1/catalog?limit=48&discount=100&productType=in:game&countryCode=US&locale=en-US&currencyCode=USD";
const gr = await fetch(gogUrl, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(25000) });
const gj = await gr.json();
const prods = gj.products ?? [];
console.log("gog products", prods.length);
const samples = prods.slice(0, 5).map((p) => ({ title: p.title, price: p.price }));
console.log(JSON.stringify(samples, null, 1).slice(0, 900));
const zeros = prods.filter((p) => String(p.price?.finalMoney?.amount ?? p.price?.final ?? "").startsWith("0"));
console.log("zeros:", zeros.length, zeros.slice(0, 3).map((z) => z.title + "|" + JSON.stringify(z.price?.finalMoney)).join(" ;; "));

const steamUrl = "https://store.steampowered.com/search/results/?query&start=0&count=50&maxprice=free&specials=1&infinite=1&cc=us&l=schinese";
const sr = await fetch(steamUrl, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25000) });
const sj = await sr.json();
const html = sj.results_html ?? "";
console.log("\nsteam total", sj.total_count, "html len", html.length);
console.log("has search_result_row:", html.includes("search_result_row"), "| has span title:", html.includes('class="title"'));
console.log(html.slice(0, 500));

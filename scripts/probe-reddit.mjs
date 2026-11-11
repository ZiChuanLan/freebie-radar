const UA = "freebie-radar/0.1 (+https://github.com/local/freebie-radar)";
const subs = ["AppHookup", "FreeEBOOKS", "udemyfreebies", "FreeUdemyCoupons", "freegamesonsteam", "coupons", "deals", "FreeGameStuffs", "googleplaydeals"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const s of subs) {
  const url = "https://www.reddit.com/r/" + s + "/hot.rss";
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/atom+xml" }, signal: AbortSignal.timeout(20000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const body = buf.toString("utf8");
    const entries = (body.match(/<entry>/g) || []).length;
    console.log(s.padEnd(20), String(res.status).padEnd(5), String(buf.length).padStart(7) + "B", "entries=" + entries);
  } catch (e) {
    console.log(s.padEnd(20), "ERR", String(e.cause?.code || e.name).slice(0, 30));
  }
  await sleep(9000);
}

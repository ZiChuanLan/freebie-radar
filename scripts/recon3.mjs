// recon 第三轮：确认可用入口与样本
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FS = "http://10.144.144.6:8191/v1";

async function fsGet(target) {
  const res = await fetch(FS, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url: target, maxTimeout: 60000 }),
  });
  const j = await res.json();
  const raw = String(j.solution?.response ?? "");
  const m = raw.match(/<pre>([\s\S]*?)<\/pre>/);
  return { status: j.solution?.status, body: (m ? m[1] : raw).replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') };
}
async function get(target) {
  const r = await fetch(target, { headers: { "user-agent": UA, accept: "*/*" } });
  const b = Buffer.from(await r.arrayBuffer());
  return { status: r.status, body: b.toString("utf8") };
}
const titles = (xml, tag = "title") => [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim());

console.log("==================== A. linux.do c/36 welfare ====================");
{
  const { status, body } = await fsGet("https://linux.do/c/36/l/latest.json?order=created");
  console.log("status:", status, "len:", body.length);
  try {
    const d = JSON.parse(body);
    console.log("topics:", d.topic_list?.topics?.length);
    for (const t of (d.topic_list?.topics ?? []).slice(0, 8)) console.log(`  #${t.id} ${t.title} | tags=${(t.tags ?? []).join(",")} | ${t.created_at}`);
  } catch (e) { console.log("parse fail", body.slice(0, 200)); }
}

console.log("\n==================== B. 52pojie RSS ====================");
{
  const { status, body } = await get("https://www.52pojie.cn/forum.php?mod=rss");
  console.log("status:", status, "len:", body.length);
  const ts = titles(body);
  console.log("items:", ts.length - 2);
  ts.slice(1, 9).forEach((t) => console.log("  " + t));
}

console.log("\n==================== C. smzdm RSS ====================");
{
  const { status, body } = await get("https://www.smzdm.com/rss/");
  console.log("status:", status, "len:", body.length);
  const ts = titles(body);
  console.log("items:", ts.length - 2);
  ts.slice(1, 9).forEach((t) => console.log("  " + t));
}

console.log("\n==================== D. 小黑盒 SPA bundle ====================");
{
  const { status, body } = await get("https://www.xiaoheihe.cn/");
  console.log("status:", status, "len:", body.length);
  const srcs = [...body.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  console.log("scripts:", srcs.slice(0, 6).join("\n  "));
  for (const s of srcs.slice(0, 3)) {
    const u = s.startsWith("http") ? s : "https://www.xiaoheihe.cn" + s;
    try {
      const r = await get(u);
      const apis = [...new Set([...r.body.matchAll(/["'`](\/bbs\/app\/[a-z0-9_\/]+)["'`]/gi)].map((m) => m[1]))].slice(0, 15);
      console.log(`\n  ${u} -> ${r.status} ${r.body.length}B  apis=${apis.length}`);
      apis.slice(0, 10).forEach((a) => console.log("     " + a));
    } catch (e) { console.log("  fetch fail", u, String(e).slice(0, 80)); }
  }
}

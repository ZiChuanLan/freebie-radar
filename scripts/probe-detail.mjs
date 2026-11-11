const FS = "http://10.144.144.6:8191/v1";
async function fsGet(target, session) {
  const body = { cmd: "request.get", url: target, maxTimeout: 60000 };
  if (session) body.session = session;
  const res = await fetch(FS, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  const raw = String(j.solution?.response ?? "");
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(raw);
  return { status: j.solution?.status ?? 0, msg: j.message, body: (pre ? pre[1] : raw).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") };
}
let list = await fsGet("https://linux.do/c/36/l/latest.json?order=created", "radar");
if (!list.body) { console.log("session miss:", list.msg); list = await fsGet("https://linux.do/c/36/l/latest.json?order=created"); }
console.log("list status", list.status, "len", list.body.length);
const data = JSON.parse(list.body);
const t = data.topic_list.topics[0];
console.log("topic:", t.id, "|", t.title.slice(0, 50));
const t0 = Date.now();
const detail = await fsGet("https://linux.do/t/" + t.id + ".json", "radar");
console.log("detail status", detail.status, "len", detail.body.length, "in", Date.now() - t0, "ms");
const d = JSON.parse(detail.body);
const cooked = String(d.post_stream?.posts?.[0]?.cooked ?? "");
const text = cooked.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
console.log("first post text len:", text.length);
console.log("excerpt:", text.slice(0, 300));
const codes = text.match(/\b[A-Z0-9]{6,24}(?:-[A-Z0-9]{4,12}){0,3}\b/g) || [];
console.log("code-like:", [...new Set(codes)].slice(0, 15).join(" | "));

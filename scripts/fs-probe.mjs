// 通过 RN 上的 FlareSolverr 抓 linux.do，验证跨内网可用
const url = "http://10.144.144.6:8191/v1";
const body = { cmd: "request.get", url: "https://linux.do/latest.json", maxTimeout: 60000 };

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log("http", res.status, "bytes", text.length);
try {
  const j = JSON.parse(text);
  const sol = j.solution ?? {};
  console.log("status:", j.status, "solution.status:", sol.status, "resp len:", sol.response?.length);
  const raw = String(sol.response ?? "");
  const m = raw.match(/<pre>([\s\S]*?)<\/pre>/);
  const jsonText = m ? m[1] : raw;
  const data = JSON.parse(jsonText);
  console.log("topics:", data.topic_list?.topics?.length, "more:", data.topic_list?.more_topics_url);
  const cats = {};
  for (const t of data.topic_list?.topics ?? []) cats[t.category_id] = (cats[t.category_id] ?? 0) + 1;
  console.log("category_id histogram:", JSON.stringify(cats));
  console.log("sample:", (data.topic_list?.topics ?? []).slice(0, 5).map((t) => `[${t.category_id}] ${t.title}`).join("\n  "));
} catch (e) {
  console.log("parse fail:", String(e).slice(0, 200));
  console.log(text.slice(0, 500));
}

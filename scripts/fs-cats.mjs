// 抓 linux.do 分类清单与目标板块
const fsUrl = "http://10.144.144.6:8191/v1";

async function fsGet(target) {
  const res = await fetch(fsUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url: target, maxTimeout: 60000 }),
  });
  const j = await res.json();
  const raw = String(j.solution?.response ?? "");
  const m = raw.match(/<pre>([\s\S]*?)<\/pre>/);
  return (m ? m[1] : raw).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

const cats = JSON.parse(await fsGet("https://linux.do/categories.json"));
const list = cats.category_list?.categories ?? [];
console.log("=== top categories ===");
for (const c of list) {
  console.log(`${c.id}\t${c.slug}\t${c.name}\ttopics=${c.topic_count}\tsubcats=${(c.subcategory_ids ?? []).join(",")}`);
}

// 二级分类
const all = [...list];
for (const c of list) for (const s of c.subcategory_list ?? []) all.push(s);
if (all.length > list.length) {
  console.log("=== subcategories ===");
  for (const c of all.slice(list.length)) console.log(`${c.id}\t${c.slug}\t${c.name}\ttopics=${c.topic_count}`);
}

console.log("=== keyword match ===");
for (const c of all) {
  if (/福利|羊毛|优惠|免费|白嫖|资源|deal|free/i.test(c.name + " " + c.slug)) {
    console.log(`MATCH ${c.id} ${c.slug} ${c.name} topics=${c.topic_count}`);
  }
}

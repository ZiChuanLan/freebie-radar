import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("./data/radar.db");
console.log("by source:", JSON.stringify(d.prepare("select source_id, count(*) n, round(avg(score)) avg from items group by source_id").all()));
console.log("by category:", JSON.stringify(d.prepare("select category, count(*) n from items group by category order by n desc").all()));
console.log("--- top 8 ---");
for (const r of d.prepare("select source_id, round(score) s, category, title from items order by score desc limit 8").all()) console.log(r.s, "|", r.source_id, "|", r.category, "|", r.title.slice(0, 70));
console.log("--- latest linuxdo ---");
for (const r of d.prepare("select title, published_at from items where source_id like 'linuxdo%' order by published_at desc limit 5").all()) console.log(r.published_at, "|", r.title.slice(0, 60));

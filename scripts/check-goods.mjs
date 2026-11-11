import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("./data/radar.db");
for (const r of d.prepare("select id, title, summary, tags from items where title like '%维修%' or title like '%上门%'").all()) {
  console.log("ID", r.id, "|", r.title);
  console.log("  tags:", r.tags);
  console.log("  summary:", String(r.summary).slice(0, 200));
}

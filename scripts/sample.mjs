import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("./data/radar.db");
const sources = d.prepare("select distinct source_id from items order by source_id").all();
let i = 0;
for (const s of sources) {
  const rows = d.prepare("select category, round(score) s, title from items where source_id = ? order by score desc limit 4").all(s.source_id);
  for (const r of rows) {
    i += 1;
    console.log(i + ". [" + r.category + "] (" + s.source_id + ") " + r.title.slice(0, 78));
  }
}

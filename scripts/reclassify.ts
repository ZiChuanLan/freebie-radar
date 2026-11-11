import { all, migrate, run } from "../src/server/db.ts";
import { enrichItem } from "../src/server/enrich/index.ts";

type Row = {
  id: number; source_id: string; external_id: string; url: string; title: string;
  summary: string | null; author: string | null; published_at: string | null;
  expires_at: string | null; tags: string; raw: string; category: string | null;
};

migrate();
const rows = all<Row>("SELECT * FROM items WHERE source_id NOT LIKE 'github%'");
let changed = 0;
for (const row of rows) {
  let tags: string[] = [];
  try { tags = JSON.parse(row.tags) as string[]; } catch { tags = []; }
  const e = enrichItem({
    externalId: row.external_id,
    url: row.url,
    title: row.title,
    summary: row.summary ?? "",
    author: row.author,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    tags,
  }, row.source_id);
  if (!e) continue;
  const status = e.keep ? "active" : "expired";
  if (e.category !== row.category) changed += 1;
  run(
    "UPDATE items SET category = ?, tags = ?, score = ?, expires_at = ?, status = CASE WHEN status = 'ignored' THEN 'ignored' ELSE ? END WHERE id = ?",
    e.category, JSON.stringify(e.tags), e.score, e.expiresAt, status, row.id,
  );
}
console.log("reclassified", rows.length, "items, category changed", changed);

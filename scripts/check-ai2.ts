import { all } from "./src/server/db.ts";

const probes = ["FreeBSD", "ovh 年付", "受访开发者", "谁有"];

console.log("=== 用户指出的两条 ===");
for (const p of probes) {
  for (const r of all<{ title: string; score: number; ai: string | null; pushed_at: string | null }>(
    "SELECT title, score, ai, pushed_at FROM items WHERE title LIKE ? LIMIT 3",
    `%${p}%`,
  )) {
    const v = r.ai ? (JSON.parse(r.ai) as { keep?: boolean; reason?: string }) : null;
    console.log(
      (v ? (v.keep ? "KEEP  " : "REJECT") : "未审  "),
      "| score=" + r.score,
      "|", r.title.slice(0, 46).padEnd(48),
      "|", v?.reason ?? "-",
    );
  }
}

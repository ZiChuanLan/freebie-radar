import { config } from "../config.ts";
import type { RawItem } from "../collectors/types.ts";
import { cdpBase, fetchSite, SITES, type SiteKey } from "./cdp.ts";

const args = process.argv.slice(2);
const siteArg = (args[0] ?? "all") as SiteKey | "all";
const kwIndex = args.indexOf("--keyword");
const keyword = kwIndex >= 0 ? (args[kwIndex + 1] ?? "免费领取") : "免费领取";
const dryRun = args.includes("--dry-run");
const server = (process.env.SERVER_URL ?? "http://10.144.144.6:8788").replace(/\/+$/, "");
const token = process.env.INGEST_TOKEN ?? config.ingestToken;

async function push(sourceId: string, items: RawItem[]) {
  const res = await fetch(server + "/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({ sourceId, items }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error("ingest HTTP " + res.status + ": " + body.slice(0, 160));
  return body;
}

async function main() {
  console.log("[local] cdp=" + cdpBase() + " server=" + server + " keyword=" + keyword + (dryRun ? " (dry-run)" : ""));
  const AUTO: SiteKey[] = ["zhihu", "xhs"];
  const sites: SiteKey[] = siteArg === "all" ? AUTO : [siteArg];
  for (const site of sites) {
    const spec = SITES[site];
    try {
      const items = await fetchSite(site, keyword);
      console.log("[local] " + site + " 抓到 " + items.length + " 条");
      items.slice(0, 3).forEach((i) => console.log("   - " + i.title.slice(0, 60) + "  " + i.url.slice(0, 60)));
      if (!items.length) continue;
      if (dryRun) continue;
      if (!token) throw new Error("缺少 INGEST_TOKEN");
      const out = await push(spec.sourceId, items);
      console.log("[local] " + site + " 回传: " + out);
    } catch (err) {
      console.error("[local] " + site + " 失败: " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

import { all, get, migrate, run } from "./db.ts";
import { runAll, runSource, ensureSources } from "./collectors/index.ts";
import { lastDigests, runDaily } from "./digest.ts";

const [cmd = "help", ...args] = process.argv.slice(2);
migrate();
ensureSources();

async function main() {
  switch (cmd) {
    case "collect": {
      if (args.length) {
        for (const id of args) await runSource(id);
      } else {
        const results = await runAll();
        const failed = results.filter((r) => r.status === "failed").length;
        console.log(`[collect] done: ${results.length} sources, ${failed} failed, ${results.reduce((n, r) => n + r.inserted, 0)} inserted`);
        if (failed && failed === results.length) process.exitCode = 1;
      }
      break;
    }
    case "sources": {
      const rows = all<Record<string, unknown>>("SELECT id, name, kind, enabled, last_status, last_run_at, cursor FROM sources ORDER BY id");
      for (const r of rows) console.log(`${r.enabled ? "on " : "off"} ${r.id}\t${r.kind}\t${r.last_status ?? "-"}\t${r.last_run_at ?? "-"}\tcursor=${r.cursor ?? "-"}`);
      break;
    }
    case "enable": {
      for (const id of args) run("UPDATE sources SET enabled = 1 WHERE id = ?", id);
      console.log("enabled:", args.join(","));
      break;
    }
    case "disable": {
      for (const id of args) run("UPDATE sources SET enabled = 0 WHERE id = ?", id);
      console.log("disabled:", args.join(","));
      break;
    }
    case "config": {
      const [id, json] = args;
      if (!id || json === undefined) throw new Error("usage: config <sourceId> <json>");
      JSON.parse(json);
      run("UPDATE sources SET config = ? WHERE id = ?", json, id);
      console.log("config updated:", id);
      break;
    }
    case "daily": {
      const dryRun = args.includes("--dry-run");
      const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
      const date = dateArg ? new Date(dateArg + "T08:00:00") : new Date();
      const result = await runDaily({ dryRun, date });
      if (!dryRun) console.log("[daily] " + result.date + " count=" + result.count + " pushed=" + result.pushed);
      break;
    }
    case "digests": {
      console.log(lastDigests(10));
      break;
    }
    case "stats": {
      console.log(get("SELECT COUNT(*) AS items FROM items"));
      console.log(get("SELECT source_id, COUNT(*) AS n FROM items GROUP BY source_id"));
      break;
    }
    default:
      console.log("usage: cli.ts <collect [sourceId...] | sources | enable <id...> | disable <id...> | config <id> <json> | stats>");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

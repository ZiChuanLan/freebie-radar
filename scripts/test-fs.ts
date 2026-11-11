import { flaresolverrGet } from "../src/server/flaresolverr.ts";
import { config } from "../src/server/config.ts";
console.log("fs url:", JSON.stringify(config.flaresolverrUrl), "timeout:", config.flaresolverrTimeoutMs);
try {
  const r = await flaresolverrGet("https://linux.do/c/36/l/latest.json?order=created");
  console.log("status", r.status, "len", r.body.length);
} catch (e) {
  console.log("ERR:", e instanceof Error ? e.message : String(e));
}

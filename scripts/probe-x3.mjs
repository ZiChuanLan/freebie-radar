const FS = "http://127.0.0.1:8191/v1";
const r = await fetch(FS, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ cmd: "request.get", url: "https://x.com/FreeGameFinding", maxTimeout: 45000 }),
  signal: AbortSignal.timeout(50000),
});
const j = await r.json();
const body = String(j.solution?.response ?? "");
const text = body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
console.log("x.com via FS status:", j.solution?.status, "html:", body.length, "text:", text.length);
console.log("excerpt:", text.slice(0, 350));

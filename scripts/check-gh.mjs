for (const repo of ["public-apis/public-apis", "mahseema/awesome-ai-tools", "awesome-selfhosted/awesome-selfhosted"]) {
  const r = await fetch("https://api.github.com/repos/" + repo + "/contents/README.md", { headers: { accept: "application/vnd.github.raw", "user-agent": "freebie-radar" }, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  const bullets = (text.match(/^\s*[-*+]\s+\[.+?\]\(https?:\/\//gm) || []).length;
  const tables = (text.match(/^\|\s*\[.+?\]\(https?:\/\//gm) || []).length;
  console.log(repo.padEnd(40), "status=" + r.status, "len=" + text.length, "bullets=" + bullets, "tables=" + tables);
}

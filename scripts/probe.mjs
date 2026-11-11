// 一次性数据源可达性探测，结果写入 docs/probe-results.json
import { writeFileSync, mkdirSync } from "node:fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const targets = [
  ["linuxdo_latest_json", "https://linux.do/latest.json"],
  ["linuxdo_latest_rss", "https://linux.do/latest.rss"],
  ["linuxdo_categories", "https://linux.do/categories.json"],
  ["linuxdo_top_daily", "https://linux.do/top.json?period=daily"],
  ["linuxdo_search_free", "https://linux.do/search.json?q=%E5%85%8D%E8%B4%B9"],
  ["linuxdo_c_deals", "https://linux.do/c/deals.json"],
  ["gh_api_free_for_dev", "https://api.github.com/repos/ripienaar/free-for-dev"],
  ["gh_api_rate", "https://api.github.com/rate_limit"],
  ["gh_commits_atom", "https://github.com/ripienaar/free-for-dev/commits/main.atom"],
  ["gh_search_awesome_free", "https://api.github.com/search/repositories?q=awesome+free+stuff&per_page=3"],
  ["smzdm_feed", "https://www.smzdm.com/feed"],
  ["fuliba_feed", "https://fuliba.net/feed"],
  ["rsshub_zhihu_hotlist", "https://rsshub.app/zhihu/hotlist"],
  ["zhihu_search_api", "https://www.zhihu.com/api/v4/search_v3?t=general&q=%E5%85%8D%E8%B4%B9%E9%A2%86%E5%8F%96&correction=1&offset=0&limit=10"],
  ["zhihu_home", "https://www.zhihu.com/"],
  ["xiaoheihe_home", "https://www.xiaoheihe.cn/"],
  ["xhs_explore", "https://www.xiaohongshu.com/explore"],
];

const results = [];

async function probe([name, url]) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "application/json, text/html, application/xml;q=0.9, */*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") ?? "";
    let body = buf.toString("utf8");
    if (/gzip|br/.test(res.headers.get("content-encoding") ?? "")) body = "(encoded)";
    const snippet = body.replace(/\s+/g, " ").slice(0, 240);
    results.push({
      name, url, status: res.status, finalUrl: res.url,
      contentType: ct, bytes: buf.length, ms: Date.now() - started,
      server: res.headers.get("server"), snippet,
    });
  } catch (err) {
    results.push({ name, url, error: String(err?.cause?.code ?? err?.name ?? err), ms: Date.now() - started });
  } finally {
    clearTimeout(timer);
  }
}

const pool = 4;
let i = 0;
await Promise.all(
  Array.from({ length: pool }, async () => {
    while (i < targets.length) {
      const t = targets[i++];
      await probe(t);
    }
  }),
);

results.sort((a, b) => targets.findIndex((t) => t[0] === a.name) - targets.findIndex((t) => t[0] === b.name));
mkdirSync("docs", { recursive: true });
writeFileSync("docs/probe-results.json", JSON.stringify(results, null, 2));

for (const r of results) {
  const head = r.error ? `ERR ${r.error}` : `${r.status} ${r.contentType?.slice(0, 40)} ${r.bytes}B ${r.ms}ms`;
  console.log(`\n## ${r.name}  -> ${head}\n   ${r.url}${r.finalUrl && r.finalUrl !== r.url ? `\n   final: ${r.finalUrl}` : ""}\n   ${(r.snippet ?? "").slice(0, 200)}`);
}

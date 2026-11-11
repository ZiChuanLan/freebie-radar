// 第二轮：国内可达源与可用入口验证
import { writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const targets = [
  ["v2ex_api_free_node", "https://www.v2ex.com/api/topics/show.json?node_name=free"],
  ["v2ex_index_xml", "https://www.v2ex.com/index.xml"],
  ["v2ex_feed_free", "https://www.v2ex.com/feed/tab/free.xml"],
  ["v2ex_api_nodes", "https://www.v2ex.com/api/nodes/show.json?name=free"],
  ["gh_contents_readme", "https://api.github.com/repos/ripienaar/free-for-dev/contents/README.md"],
  ["gh_contents_list", "https://api.github.com/repos/ripienaar/free-for-dev/contents/"],
  ["52pojie_rss", "https://www.52pojie.cn/forum.php?mod=rss"],
  ["smzdm_rss", "https://www.smzdm.com/rss/"],
  ["fuliba_feed", "https://fuliba.net/feed"],
  ["xhh_api_feeds", "https://api.xiaoheihe.cn/bbs/app/api/web/feeds?list_type=general&offset=0&limit=10"],
  ["xhh_api_home", "https://api.xiaoheihe.cn/bbs/app/api/web/home"],
  ["zhihu_hot_api", "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=10"],
  ["xhs_user_page", "https://www.xiaohongshu.com/user/profile/5b0d3d5b4badb10001d6b3f6"],
  ["ithome_rss", "https://www.ithome.com/rss/"],
  ["freebuf_rss", "https://www.freebuf.com/feed"],
  ["hostloc_rss_direct", "https://hostloc.com/forum.php?mod=rss&fid=45"],
  ["rsshub_public_alt", "https://rsshub.rssforever.com/zhihu/hotlist"],
  ["rsshub_alt2", "https://rsshub.pseudoyu.com/zhihu/hotlist"],
  ["telegram_api", "https://api.telegram.org/bot123:abc/getMe"],
];

const results = [];
async function probe([name, url]) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*", "accept-language": "zh-CN,zh;q=0.9" },
      redirect: "follow",
      signal: ac.signal,
    });
    const raw = Buffer.from(await res.arrayBuffer());
    const body = raw.toString("utf8");
    results.push({
      name, url, status: res.status, finalUrl: res.url,
      ct: res.headers.get("content-type") ?? "", bytes: raw.length,
      ms: Date.now() - t0,
      head: body.replace(/\s+/g, " ").slice(0, 160),
      // 结构化线索
      jsonHint: (() => {
        try {
          const j = JSON.parse(body);
          return Array.isArray(j) ? `array(${j.length})` : `object keys: ${Object.keys(j).slice(0, 8).join(",")}`;
        } catch { return null; }
      })(),
      rssHint: /<(rss|feed)[\s>]/i.test(body) ? `rss items=${(body.match(/<item[\s>]/gi) ?? []).length + (body.match(/<entry[\s>]/gi) ?? []).length}` : null,
    });
  } catch (e) {
    results.push({ name, url, error: String(e?.cause?.code ?? e?.name ?? e), ms: Date.now() - t0 });
  } finally { clearTimeout(timer); }
}

let i = 0;
await Promise.all(Array.from({ length: 5 }, async () => { while (i < targets.length) await probe(targets[i++]); }));
results.sort((a, b) => targets.findIndex((t) => t[0] === a.name) - targets.findIndex((t) => t[0] === b.name));
writeFileSync("docs/probe2-results.json", JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(`\n## ${r.name}  ${r.error ? "ERR " + r.error : `${r.status} ${r.ct?.slice(0, 30)} ${r.bytes}B ${r.ms}ms`}`);
  if (r.jsonHint) console.log(`   json: ${r.jsonHint}`);
  if (r.rssHint) console.log(`   ${r.rssHint}`);
  console.log(`   ${r.head ?? ""}`);
}

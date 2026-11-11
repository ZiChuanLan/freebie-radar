import { withPage, evaluate } from "../src/server/local/cdp.ts";

const url = process.argv[2] ?? "https://www.xiaoheihe.cn/";
const out = await withPage(url, 6000, async (ws) => {
  return await evaluate<Record<string, unknown>>(ws, "(() => ({ title: document.title, href: location.href, text: (document.body.innerText || '').slice(0, 600), links: Array.from(document.querySelectorAll('a[href]')).slice(0, 25).map((a) => ((a.textContent || '').trim().slice(0, 30) + ' -> ' + a.getAttribute('href'))) }))()");
});
console.log(JSON.stringify(out, null, 2));

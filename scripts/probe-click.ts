import { withPage, evaluate } from "../src/server/local/cdp.ts";

const out = await withPage("https://www.xiaoheihe.cn/", 5000, async (ws) => {
  const before = await evaluate<string>(ws, "location.href");
  await evaluate<string>(ws, "(() => { const el = Array.from(document.querySelectorAll('a,button,div,span')).find((n) => (n.textContent || '').trim() === '社区'); if (el) { el.click(); return 'clicked'; } return 'not-found'; })()");
  await new Promise((r) => setTimeout(r, 4000));
  const after = await evaluate<string>(ws, "location.href");
  const text = await evaluate<string>(ws, "(document.body.innerText || '').slice(0, 400)");
  const links = await evaluate<string[]>(ws, "Array.from(document.querySelectorAll('a[href]')).slice(0, 15).map((a) => ((a.textContent||'').trim().slice(0,20) + ' -> ' + a.getAttribute('href')))");
  return { before, after, text, links };
});
console.log(JSON.stringify(out, null, 2));

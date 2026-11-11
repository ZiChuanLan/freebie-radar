import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ bypassCSP: true });
const page = await ctx.newPage();
const events = [];
page.on("response", (r) => events.push(r.status() + " " + r.url().replace("http://10.144.144.6:8788", "").slice(0, 42)));
page.on("pageerror", (e) => events.push("ERR " + e.message.slice(0, 90)));

await page.goto("http://10.144.144.6:8788/?nocache=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 25000 }).catch((e) => console.log("goto:", String(e).slice(0, 60)));
await page.waitForTimeout(8000);
const info = await page.evaluate(() => ({
  root: (document.getElementById("root")?.innerHTML || "").length,
  articles: document.getElementsByTagName("article").length,
  hasScript: !!document.querySelector('script[src*="/assets/"]'),
  scriptSrc: document.querySelector('script[src*="/assets/"]')?.getAttribute("src") ?? "",
}));
console.log(JSON.stringify(info));
console.log(events.slice(0, 8).join(" ; "));
await browser.close();

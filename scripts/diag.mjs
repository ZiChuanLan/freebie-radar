import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1150 } });
const reqs = [];
page.on("request", (r) => { if (r.url().includes("/api/items")) reqs.push(r.url().split("/api/items")[1]); });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 300)));
await page.goto("http://10.144.144.6:8788/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(6000);
console.log("initial reqs:", JSON.stringify(reqs));
const before = await page.evaluate(() => document.getElementsByTagName("article").length);
await page.getByRole("button", { name: "完全白嫖" }).first().click();
await page.waitForTimeout(6000);
const after = await page.evaluate(() => ({
  articles: document.getElementsByTagName("article").length,
  mainText: (document.querySelector("main")?.innerText || "(no main)").slice(0, 200),
  mainLen: (document.querySelector("main")?.innerHTML || "").length,
}));
console.log("before articles:", before);
console.log("after:", JSON.stringify(after, null, 1));
console.log("reqs after click:", JSON.stringify(reqs));
await browser.close();

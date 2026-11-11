import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1120 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const log = [];
page.on("pageerror", (e) => log.push("PAGEERR " + e.message.slice(0, 260)));
page.on("console", (m) => { if (m.type() === "error") log.push("CONSOLE " + m.text().slice(0, 260)); });

try {
  await page.goto("http://10.144.144.6:8788/", { waitUntil: "domcontentloaded", timeout: 25000 });
} catch (e) {
  console.log("goto failed:", String(e).slice(0, 120));
}
await page.waitForTimeout(9000);
console.log("root:", await page.evaluate(() => (document.getElementById("root")?.innerHTML || "").length).catch(() => -1));
console.log("articles:", await page.evaluate(() => document.getElementsByTagName("article").length).catch(() => -1));
console.log(log.slice(0, 6).join("\n"));
await browser.close();

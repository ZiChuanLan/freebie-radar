import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1150 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
await page.goto("http://10.144.144.6:8788/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(6000);
const before = await page.evaluate(() => document.getElementsByTagName("article").length);
await page.getByRole("button", { name: "完全白嫖" }).first().click();
await page.waitForTimeout(5000);
const after = await page.evaluate(() => ({
  articles: document.getElementsByTagName("article").length,
  countLine: (Array.from(document.querySelectorAll("div")).map((d) => (d.textContent || "").trim()).find((t) => /^共 \d+ 条/.test(t)) || ""),
}));
console.log("errs:", JSON.stringify(errs.slice(0, 3)));
console.log("before:", before, "after:", JSON.stringify(after));
await page.screenshot({ path: "docs/ui-price.png" });
await browser.close();

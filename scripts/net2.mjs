import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const events = [];
page.on("response", (r) => events.push(r.status() + " " + r.url().replace("http://10.144.144.6:8788", "")));
page.on("domcontentloaded", () => events.push("DOMCONTENTLOADED"));
page.on("load", () => events.push("LOAD"));

for (const u of ["http://10.144.144.6:8788/", "http://10.144.144.6:8788/index.html"]) {
  events.length = 0;
  try {
    await page.goto(u, { waitUntil: "commit", timeout: 15000 });
    await page.waitForTimeout(6000);
    const html = await page.evaluate(() => document.documentElement.outerHTML.length).catch(() => -1);
    console.log(u, "htmlLen:", html, "| events:", events.slice(0, 6).join(" ; "));
  } catch (e) {
    console.log(u, "FAIL", String(e).slice(0, 60));
  }
}
await browser.close();

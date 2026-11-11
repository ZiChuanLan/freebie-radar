import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const log = [];
page.on("response", async (r) => {
  if (r.url().includes("/api/")) {
    let len = 0; try { len = (await r.text()).length; } catch {}
    log.push(r.status() + " " + r.url().replace("http://10.144.144.6:8788", "") + " " + len + "B");
  }
});
page.on("console", (m) => { if (m.type() === "error") log.push("CONSOLE-ERR " + m.text().slice(0, 160)); });
page.on("pageerror", (e) => log.push("PAGEERR " + e.message.slice(0, 160)));
page.on("requestfailed", (r) => log.push("REQFAIL " + r.url().slice(-60) + " " + (r.failure()?.errorText ?? "")));
await page.goto("http://10.144.144.6:8788/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(9000);
console.log(log.join("\n"));
console.log("--- articles:", await page.evaluate(() => document.getElementsByTagName("article").length));
console.log("--- body snippet:", await page.evaluate(() => (document.querySelector("main")?.innerText || "(no main)").slice(0, 120)));
await browser.close();

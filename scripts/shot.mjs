import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://10.144.144.6:8788/#digest", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: "docs/ui-digest.png" });
console.log("shot ok", await page.title());
await browser.close();

import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
for (const u of ["http://10.144.144.6:8788/health", "https://example.com"]) {
  try {
    const r = await page.goto(u, { waitUntil: "domcontentloaded", timeout: 12000 });
    console.log(u, "->", r?.status());
  } catch (e) {
    console.log(u, "-> FAIL", String(e).slice(0, 70));
  }
}
await browser.close();

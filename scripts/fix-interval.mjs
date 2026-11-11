import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/data/radar.db");

const intervals = {
  "linuxdo-welfare": 90,
  "linuxdo-resource": 180,
  "v2ex-free": 120,
  "gamerpower": 900,
  "steam-free": 1800,
  "epic-free": 3600,
  "gog-free": 21600,
  "github-free-for-dev": 21600,
  "rss-reddit-freegames": 1800,
  "rss-reddit-efreebies": 1800,
  "rss-reddit-freebies": 1800,
  "rss-reddit-apphookup": 1800,
  "rss-reddit-freeebooks": 1800,
  "rss-reddit-googleplay": 1800,
  "rss-reddit-gamedeals": 1800,
  "rss-slickdeals": 1800,
  "rss-keylol": 900,
  "rss-fuliba": 900,
  "rss-52pojie": 1800,
  "rss-smzdm": 1800,
  "rss-heyitsfree": 3600,
  "rss-freebieshark": 3600,
  "rss-giveawayoftheday": 3600,
  "rss-appinn": 3600,
  "rss-sspai": 3600,
  "rss-ithome": 1800,
  "rss-producthunt": 3600,
  "rss-hnrss": 3600,
  "rss-9to5toys": 3600,
};
for (const [id, sec] of Object.entries(intervals)) {
  db.prepare("UPDATE sources SET interval_sec = ? WHERE id = ?").run(sec, id);
}
// linux.do 福利羊毛开启正文快照（抓兑换码）
db.prepare("UPDATE sources SET config = ? WHERE id = ?").run(JSON.stringify({ categoryId: 36, fetchContent: true, fetchContentLimit: 5 }), "linuxdo-welfare");
// GOG 实测 API 筛不出免费，禁用
db.prepare("UPDATE sources SET enabled = 0 WHERE id = ?").run("gog-free");

console.log("intervals set:", db.prepare("SELECT COUNT(*) AS n FROM sources WHERE interval_sec != 10800").get().n);
for (const r of db.prepare("SELECT id, interval_sec, enabled FROM sources WHERE enabled = 1 ORDER BY interval_sec").all()) {
  console.log("  " + String(r.interval_sec).padStart(6) + "s  " + r.id);
}

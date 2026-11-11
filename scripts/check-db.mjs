import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("./data/radar.db");
const tables = db.prepare("select name from sqlite_master where type='table' order by name").all();
console.log("tables:", tables.map((t) => t.name).join(","));
console.log("user_version:", db.prepare("pragma user_version").get());

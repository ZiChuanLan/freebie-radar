import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("./data/radar.db");
console.log("local total:", d.prepare("select count(*) c from items").get().c);

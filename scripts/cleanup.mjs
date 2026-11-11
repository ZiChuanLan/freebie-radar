import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync("./data/radar.db");
d.exec("DELETE FROM runs WHERE source_id = 'mock-source'");
d.exec("UPDATE sources SET last_status = NULL, last_error = NULL, cursor = NULL WHERE id = 'mock-source'");
console.log("runs left:", d.prepare("select count(*) c from runs").get().c);

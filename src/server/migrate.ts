import { migrate, dbPath } from "./db.ts";

const version = migrate();
console.log(`[migrate] schema v${version} ready at ${dbPath()}`);

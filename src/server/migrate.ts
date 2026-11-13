import { migrate, dbPath } from "./db.ts";
import { ensureSources } from "./collectors/index.ts";

const version = migrate();
ensureSources();
console.log(`[migrate] schema v${version} ready at ${dbPath()}`);

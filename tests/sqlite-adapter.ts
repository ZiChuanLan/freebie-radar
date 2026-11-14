import { DatabaseSync } from "node:sqlite";
import { initDbBackend, type SqlValue } from "../src/server/db.ts";

/**
 * node:sqlite 适配器：让测试继续用真实 SQLite 跑（:memory:）。
 * 只服务 tests/，不进 Worker bundle。
 */
export function useMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  initDbBackend({
    exec: (query, params: SqlValue[]) => {
      const sql = query.trim();
      // node:sqlite 的 prepare 对多语句串只执行第一条 —— 多于一句时走 exec
      if (sql.split(";").filter((s) => s.trim()).length > 1) {
        db.exec(sql);
        return { rows: [], rowsWritten: 0 };
      }
      const stmt = db.prepare(sql.replace(/;+\s*$/, ""));
      if (/^(select|pragma|with|explain)/i.test(sql)) {
        return { rows: stmt.all(...params) as Record<string, unknown>[], rowsWritten: 0 };
      }
      const info = stmt.run(...params);
      return { rows: [], rowsWritten: Number(info.changes) };
    },
    transactionSync: <T,>(fn: () => T): T => {
      db.exec("BEGIN");
      try {
        const out = fn();
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  });
  return db;
}

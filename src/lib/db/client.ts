import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);
  _db = drizzle(sql, { schema });
  return _db;
}

// Proxy keeps the `db.select(...)` call shape but defers the env-var check
// until the first real use, so route modules can be loaded at build time
// without a live DATABASE_URL.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});

export { schema };

import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";
import { mkdir } from "node:fs/promises";
import { schema } from "./schema";
import { importSchema } from "./imports/schema";
export type Row = Record<string, any>;
export type DB = {
  query: (sql: string, params?: any[]) => Promise<{ rows: Row[] }>;
};
const state = globalThis as typeof globalThis & {
  pricepilotDB?: Promise<{ db: DB; local: PGlite | null }>;
  pricepilotLock?: Promise<void>;
};
async function connect() {
  if (process.env.DATABASE_URL) {
    const db = new Pool({ connectionString: process.env.DATABASE_URL });
    await db.query(schema + importSchema);
    return { db, local: null };
  }
  if (process.env.NODE_ENV === "production" && process.env.APP_ENV !== "local")
    throw new Error("Production requires DATABASE_URL");
  await mkdir(process.env.LOCAL_DATA_DIR || ".data", { recursive: true });
  const local = new PGlite(
    (process.env.LOCAL_DATA_DIR || ".data") + "/postgres",
  );
  await local.exec(schema + importSchema);
  return { db: local as DB, local };
}
export async function query(sql: string, params: any[] = []) {
  const { db } = await (state.pricepilotDB ??= connect());
  return (await db.query(sql, params)).rows;
}
export async function transaction<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const connection = await (state.pricepilotDB ??= connect());
  if (connection.local)
    return connection.local.transaction((tx) => fn(tx as DB));
  const client = await (connection.db as Pool).connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client as PoolClient);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export const id = () => crypto.randomUUID();
export async function audit(
  db: DB,
  org: string,
  actor: string,
  action: string,
  details: Row = {},
) {
  await db.query(
    "INSERT INTO audit_logs(id,organization_id,actor_id,action,details) VALUES($1,$2,$3,$4,$5)",
    [id(), org, actor, action, JSON.stringify(details)],
  );
}

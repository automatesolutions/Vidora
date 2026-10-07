import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

export function createDb(url = process.env.DATABASE_URL, opts: { max?: number } = {}) {
  if (!url) throw new Error("DATABASE_URL is not set")
  // prepare: false keeps this working behind PgBouncer-style poolers (Neon pooled URLs).
  const client = postgres(url, { max: opts.max ?? 10, prepare: false })
  const db = drizzle({ client, schema, casing: "snake_case" })
  return Object.assign(db, { close: () => client.end() })
}

export type Db = ReturnType<typeof createDb>
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export type DbOrTx = Db | Tx

// One shared client per process (Next.js dev reloads modules, so cache it on globalThis).
const g = globalThis as unknown as { __vidoraDb?: Db }
export function getDb() {
  g.__vidoraDb ??= createDb()
  return g.__vidoraDb
}

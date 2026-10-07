import path from "node:path"
import { fileURLToPath } from "node:url"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { createDb } from "./client"

// Usage: pnpm --filter @vidora/db db:migrate  (needs DATABASE_URL)
const db = createDb(process.env.DATABASE_URL, { max: 1 })
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations")
await migrate(db, { migrationsFolder })
console.log("Migrations applied.")
await db.close()

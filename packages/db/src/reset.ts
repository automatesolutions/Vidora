import postgres from "postgres"

// Local development only: drops every table and the migration history, so `pnpm db:migrate` starts
// clean. Refuses to touch anything that isn't a database on this machine.
//   pnpm db:reset && pnpm db:migrate
const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set")
const host = new URL(url).hostname
if (!["localhost", "127.0.0.1", "::1"].includes(host) || process.env.NODE_ENV === "production") {
  console.error(`Refusing to reset ${host}: db:reset only runs against a local database.`)
  process.exit(1)
}

const sql = postgres(url, { max: 1, onnotice: () => {} })
await sql.unsafe("drop schema if exists drizzle cascade; drop schema public cascade; create schema public;")
await sql.end()
console.log("Local database reset. Run pnpm db:migrate next.")

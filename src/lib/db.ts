import { Pool, types, type QueryResultRow } from "pg"
import { config } from "./config"

// Parse numeric/decimal columns as JS numbers instead of strings
types.setTypeParser(1700, (val: string) => parseFloat(val))

// Pool is created OUTSIDE the handler — persists across warm Lambda invocations.
// Each Lambda container gets its own pool. At high concurrency, multiple containers
// = multiple pools = many DB connections. See: Lambda-RDS-Connection-Exhaustion.
// Solution at scale: add RDS Proxy and point DB_HOST to the proxy endpoint.
const pool = new Pool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  port: config.db.port,
  ssl: { rejectUnauthorized: false },
  max: 5, // Keep small for Lambda — each container has its own pool
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
  keepAlive: true,
})

pool.on("error", (err) => {
  console.error("Unexpected idle client error:", err)
})

// Diagnostic on first query — logs DB info and tables
let diagnosticRun = false
const runDiagnostic = async (): Promise<void> => {
  if (diagnosticRun) return
  diagnosticRun = true

  try {
    console.log("=== DATABASE DIAGNOSTIC ===")
    const dbCheck = await pool.query("SELECT current_database()")
    console.log("Connected to:", dbCheck.rows[0].current_database)

    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `)
    console.log("Tables:", tables.rows.map((r) => r.table_name).join(", ") || "(none)")
    console.log("=== END DIAGNOSTIC ===")
  } catch (err) {
    console.error("Diagnostic error:", err)
  }
}

/**
 * Execute a parameterized SQL query.
 * Uses $1, $2, etc. for parameter placeholders (PostgreSQL syntax).
 */
export const executeQuery = async <T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> => {
  await runDiagnostic()

  try {
    const result = await pool.query<T>(sql, params)
    return result.rows
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException & { code?: string }
    console.error("Query error:", err.message)
    console.error("Query:", sql.substring(0, 120))

    if (err.code === "ENOTFOUND") {
      console.error("Host not found — check DB_HOST and VPC access")
    } else if (err.code === "ECONNREFUSED") {
      console.error("Connection refused — check RDS status and security groups")
    } else if (err.code === "28P01") {
      console.error("Auth failed — check DB_USER and DB_PASSWORD")
    } else if (err.code === "3D000") {
      console.error("Database not found — check DB_NAME")
    }

    throw error
  }
}

// Expose pool for transactions: const client = await pool.connect()
export { pool }

/**
 * dbConnector.js
 * This module handles PostgreSQL database connections using connection pooling
 * for improved performance and resource management.
 */

const { Pool } = require("pg");
require("dotenv").config();
const config = require("./config");

// Create a connection pool to efficiently manage database connections
const pool = new Pool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  port: config.db.port || 5432, // PostgreSQL default port
  // SSL Configuration for AWS RDS
  ssl: {
    rejectUnauthorized: false, // Required for AWS RDS
  },
  // Connection pool settings
  max: 10, // Maximum number of connections in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 20000, // Return error after 20 seconds if connection not established
  keepAlive: true, // Enable TCP Keep-Alive packets
});

// Handle pool errors
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
});

// Diagnostic: Log connection info and available tables on first connection
let diagnosticRun = false;
const runDiagnostic = async () => {
  if (diagnosticRun) return;
  diagnosticRun = true;

  try {
    console.log('=== DATABASE DIAGNOSTIC ===');
    console.log('Connecting to:', {
      host: config.db.host,
      database: config.db.database,
      user: config.db.user,
      port: config.db.port || 5432
    });

    // Check what database we're actually connected to
    const dbCheck = await pool.query('SELECT current_database()');
    console.log('Connected to database:', dbCheck.rows[0].current_database);

    // Check current search_path
    const searchPath = await pool.query('SHOW search_path');
    console.log('Search path:', searchPath.rows[0].search_path);

    // List all tables in public schema
    const tables = await pool.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log('Available tables in public schema:');
    tables.rows.forEach(row => {
      console.log(`  - ${row.table_schema}.${row.table_name}`);
    });
    console.log('=== END DIAGNOSTIC ===');
  } catch (err) {
    console.error('Diagnostic error:', err);
  }
};

/**
 * Function to execute queries with auto-reconnection capability
 * @param {string} sql - The SQL query to execute
 * @param {Array} params - The parameters for the SQL query (use $1, $2, etc. in the query)
 * @returns {Promise<Object>} - The query results
 */
const executeQuery = async (sql, params = []) => {
  try {
    // Run diagnostic on first query
    await runDiagnostic();

    // Using the connection pool to automatically handle connections
    const result = await pool.query(sql, params);
    console.log(`Query executed successfully: ${sql.substring(0, 100)}...`);
    return result.rows; // PostgreSQL returns rows in result.rows
  } catch (error) {
    // Enhanced error logging with connection details
    console.error("Database query error:", error);
    console.error("Connection params:", {
      host: config.db.host,
      database: config.db.database,
      port: config.db.port || 5432,
      user: config.db.user,
      // Don't log the actual password, but log whether it's defined
      passwordDefined: !!config.db.password,
    });

    // Check for common connection issues
    if (error.code === "ENOTFOUND") {
      console.error(
        "Host not found. Check if the database endpoint is correct and if the Lambda has VPC access."
      );
    } else if (error.code === "ECONNREFUSED") {
      console.error(
        "Connection refused. Check if the database is running and if security groups allow access."
      );
    } else if (error.code === "28P01") {
      console.error(
        "Access denied. Check your database username and password."
      );
    } else if (error.code === "3D000") {
      console.error(
        "Database does not exist. Check your database name."
      );
    }

    throw error; // Re-throw to allow handling by the caller
  }
};

module.exports = {
  executeQuery,
  // Expose the pool for transaction support
  pool,
};

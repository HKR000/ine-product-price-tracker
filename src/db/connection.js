/**
 * PostgreSQL Connection Pool for Supabase.
 * 
 * DESIGN PRINCIPLES:
 * 1. Connection Pooling: Efficiently re-uses connections, critical for Render's free tier.
 * 2. SSL Configuration: Configured for cloud databases (Supabase requires SSL).
 * 3. Environment Fallback: Reads DATABASE_URL or SUPABASE_DB_URL.
 */

const { Pool } = require('pg');

let pool = null;

function getDbPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    // Return null if environment variable is not configured yet (e.g. during mock unit tests)
    return null;
  }

  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on('error', (err) => {
    console.error('[DATABASE_POOL_ERROR] Unexpected error on idle client:', err);
  });

  return pool;
}

async function closeDbPool() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}

module.exports = {
  getDbPool,
  closeDbPool
};

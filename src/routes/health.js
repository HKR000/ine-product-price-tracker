/**
 * Health Check & Diagnostic Endpoint.
 * 
 * GET /health
 * Verifies that the backend process is alive, uptime, memory, and database connectivity.
 */

const express = require('express');
const { getDbPool } = require('../db/connection');

const router = express.Router();
const startTime = Date.now();

router.get('/health', async (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const memoryUsage = process.memoryUsage();

  let dbStatus = 'disconnected';
  let dbLatencyMs = null;
  let dbError = null;

  const pool = getDbPool();
  if (pool) {
    const dbStart = Date.now();
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      dbStatus = 'connected';
      dbLatencyMs = Date.now() - dbStart;
    } catch (err) {
      dbStatus = 'error';
      dbError = err.message;
    }
  } else {
    dbStatus = 'unconfigured';
  }

  const isHealthy = dbStatus === 'connected' || dbStatus === 'unconfigured';
  const statusCode = isHealthy ? 200 : 503;

  return res.status(statusCode).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    environment: process.env.NODE_ENV || 'development',
    configuration: {
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL),
      hasCronSecret: Boolean(process.env.CRON_SECRET),
      mockStoreBaseUrl: process.env.MOCK_STORE_BASE_URL || 'https://demo.inelabteamdev.com'
    },
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
      error: dbError
    },
    system: {
      nodeVersion: process.version,
      rssMb: Math.round(memoryUsage.rss / 1024 / 1024),
      heapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024)
    }
  });
});

module.exports = router;

/**
 * Production Server Entry Point.
 * 
 * Boots Express HTTP server with graceful shutdown handlers.
 */

require('dotenv').config();
const app = require('./app');
const { closeDbPool } = require('./db/connection');
const { defaultBrowserPool } = require('./scraper/browserPool');
const { defaultLogger } = require('./scraper/logger');

const PORT = parseInt(process.env.PORT, 10) || 3000;

const server = app.listen(PORT, () => {
  defaultLogger.info('SERVER_STARTED', {
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'development',
    pid: process.pid,
    url: `http://localhost:${PORT}`
  });
  console.log(`\n🚀 INE Price Tracker API listening on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Search: http://localhost:${PORT}/api/products/search?q=shoe\n`);
});

// Graceful Shutdown Handlers
async function gracefulShutdown(signal) {
  defaultLogger.info('SERVER_SHUTTING_DOWN', { signal });
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  server.close(async () => {
    try {
      await defaultBrowserPool.closeAll();
      await closeDbPool();
      defaultLogger.info('SERVER_SHUTDOWN_COMPLETE');
      console.log('All connections closed. Exiting process.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });

  // Force shutdown after 10s if hanging
  setTimeout(() => {
    console.error('Forced shutdown after 10s timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = server;

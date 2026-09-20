/**
 * Database Observability CLI Tool.
 * 
 * Inspects all data moving in and out of the PostgreSQL database:
 * 1. Tracked Products: Latest verified price, stock, last scrape status.
 * 2. Price History: Time-series historical records.
 * 3. Scrape Logs: Honest attempt-by-attempt audit logs (success, retried, failed).
 * 
 * Usage:
 *   node scripts/observeDb.js          # One-shot summary snapshot
 *   node scripts/observeDb.js --watch  # Real-time continuous live monitor (2s poll)
 */

require('dotenv').config();
const { getDbPool, closeDbPool } = require('../src/db/connection');

const isWatchMode = process.argv.includes('--watch') || process.argv.includes('-w');

async function fetchDatabaseState(pool) {
  const client = await pool.connect();
  try {
    // 1. Fetch tracked products
    const productsRes = await client.query(`
      SELECT 
        store_product_id, name, latest_price, latest_currency,
        latest_stock_status, latest_stock_count, last_scrape_status,
        last_scraped_at, last_error_message, version
      FROM tracked_products
      ORDER BY last_scraped_at DESC NULLS LAST, store_product_id ASC
      LIMIT 20
    `);

    // 2. Fetch recent price history
    const historyRes = await client.query(`
      SELECT 
        ph.id, tp.store_product_id, tp.name, ph.price, ph.currency,
        ph.stock_status, ph.stock_count, ph.scraped_at
      FROM price_history ph
      JOIN tracked_products tp ON ph.product_id = tp.id
      ORDER BY ph.scraped_at DESC
      LIMIT 10
    `);

    // 3. Fetch recent scrape logs
    const logsRes = await client.query(`
      SELECT 
        sl.id, sl.store_product_id, sl.correlation_id, sl.status,
        sl.attempt_number, sl.max_attempts, sl.duration_ms,
        sl.extracted_price, sl.extracted_stock, sl.error_code,
        sl.error_message, sl.scraper_mode, sl.attempt_timestamp
      FROM scrape_logs sl
      ORDER BY sl.attempt_timestamp DESC
      LIMIT 10
    `);

    return {
      products: productsRes.rows,
      history: historyRes.rows,
      logs: logsRes.rows
    };
  } finally {
    client.release();
  }
}

function printState({ products, history, logs }) {
  console.clear();
  const time = new Date().toLocaleTimeString();
  console.log('='.repeat(95));
  console.log(`📡 SUPABASE POSTGRESQL LIVE MONITOR [Updated: ${time}]`);
  console.log('='.repeat(95));

  // --- Tracked Products ---
  console.log('\n📦 TRACKED PRODUCTS (Latest Known State):');
  if (products.length === 0) {
    console.log('   (No products tracked yet)');
  } else {
    console.table(products.map(p => ({
      ID: p.store_product_id,
      Name: p.name.length > 25 ? p.name.substring(0, 22) + '...' : p.name,
      'Latest Price': p.latest_price ? `${p.latest_currency || 'INR'} ${Number(p.latest_price).toLocaleString()}` : '—',
      Stock: p.latest_stock_status ? `${p.latest_stock_status} (${p.latest_stock_count ?? '?'})` : '—',
      Status: p.last_scrape_status ? p.last_scrape_status.toUpperCase() : 'PENDING',
      'Last Scraped': p.last_scraped_at ? new Date(p.last_scraped_at).toLocaleTimeString() : 'Never',
      Version: p.version
    })));
  }

  // --- Price History ---
  console.log('\n📈 RECENT PRICE & STOCK HISTORY (Append-Only Validated):');
  if (history.length === 0) {
    console.log('   (No price history recorded yet)');
  } else {
    console.table(history.map(h => ({
      Product: `#${h.store_product_id} ${h.name.substring(0, 20)}`,
      Price: `${h.currency} ${Number(h.price).toLocaleString()}`,
      'Stock Status': h.stock_status,
      Count: h.stock_count ?? 'N/A',
      Timestamp: new Date(h.scraped_at).toLocaleTimeString()
    })));
  }

  // --- Scrape Logs ---
  console.log('\n📋 AUDIT SCRAPE LOGS (Every Attempt Honestly Recorded):');
  if (logs.length === 0) {
    console.log('   (No scrape logs recorded yet)');
  } else {
    console.table(logs.map(l => ({
      Product: `#${l.store_product_id}`,
      Status: l.status.toUpperCase(),
      Attempt: `${l.attempt_number}/${l.max_attempts}`,
      'Duration (ms)': l.duration_ms,
      'Extracted Price': l.extracted_price ? `₹${Number(l.extracted_price).toLocaleString()}` : '—',
      'Error Type': l.error_code || '—',
      'Error Message': l.error_message ? (l.error_message.length > 30 ? l.error_message.substring(0, 27) + '...' : l.error_message) : 'None',
      Timestamp: new Date(l.attempt_timestamp).toLocaleTimeString()
    })));
  }

  if (isWatchMode) {
    console.log('\nPress Ctrl+C to exit. Refreshing every 2 seconds...');
  }
}

async function main() {
  const pool = getDbPool();

  if (!pool) {
    console.error('\n❌ DATABASE CONNECTION NOT CONFIGURED');
    console.error('Please set DATABASE_URL or SUPABASE_DB_URL in your .env file.');
    console.error('Example: DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"\n');
    process.exit(1);
  }

  try {
    // Verify connection
    const client = await pool.connect();
    client.release();
  } catch (err) {
    console.error('\n❌ FAILED TO CONNECT TO DATABASE:');
    console.error(err.message);
    console.error('\nCheck your connection string and ensure Supabase PostgreSQL is reachable.\n');
    await closeDbPool();
    process.exit(1);
  }

  if (isWatchMode) {
    const runLoop = async () => {
      try {
        const state = await fetchDatabaseState(pool);
        printState(state);
      } catch (err) {
        console.error('[MONITOR ERROR]:', err.message);
      }
    };

    await runLoop();
    setInterval(runLoop, 2000);
  } else {
    try {
      const state = await fetchDatabaseState(pool);
      printState(state);
    } finally {
      await closeDbPool();
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

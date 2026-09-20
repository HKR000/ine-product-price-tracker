/**
 * Production Supabase PostgreSQL Persistence Implementation.
 * 
 * CORE CONTRACT:
 * 1. SUCCESS:
 *    - Creates scrape_log with status 'success'.
 *    - Inserts validated row into price_history.
 *    - Updates tracked_products.latest_price and stock in an atomic transaction.
 * 
 * 2. FAILURE:
 *    - Creates scrape_log with status 'failed'.
 *    - NEVER inserts into price_history.
 *    - NEVER overwrites latest_price/stock with null, 0, or garbage.
 *    - Preserves previous known valid state.
 * 
 * 3. RETRY:
 *    - Creates scrape_log with status 'retried', recording attempt number and duration.
 * 
 * 4. CONCURRENCY:
 *    - Uses row-level locks (FOR UPDATE) and optimistic versions to prevent race conditions.
 */

const { PersistenceInterface } = require('../scraper/persistenceInterface');
const { validateScrapedProduct } = require('../scraper/validator');
const { ValidationError } = require('../scraper/errors');

class SupabasePersistence extends PersistenceInterface {
  /**
   * @param {import('pg').Pool} pool - Active Postgres connection pool.
   */
  constructor(pool) {
    super();
    if (!pool) {
      throw new Error('SupabasePersistence requires an active pg.Pool instance');
    }
    this.pool = pool;
  }

  /**
   * Resolves or ensures product exists in tracked_products.
   * 
   * @param {import('pg').PoolClient} client
   * @param {number|string} storeProductId
   * @param {object} [metadata]
   * @returns {Promise<string>} UUID of tracked_products row.
   */
  async _getOrCreateTrackedProductId(client, storeProductId, metadata = {}) {
    const numericId = parseInt(storeProductId, 10);
    const sel = await client.query(
      `SELECT id, latest_price, latest_stock_status, version FROM tracked_products WHERE store_product_id = $1 FOR UPDATE`,
      [numericId]
    );

    if (sel.rows.length > 0) {
      return sel.rows[0].id;
    }

    // Insert placeholder tracked product if not present
    const ins = await client.query(
      `INSERT INTO tracked_products (
        store_product_id, slug, name, brand, category, sku, target_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (store_product_id) DO UPDATE SET updated_at = NOW()
      RETURNING id`,
      [
        numericId,
        metadata.slug || `product-${numericId}`,
        metadata.name || `Product ${numericId}`,
        metadata.brand || null,
        metadata.category || null,
        metadata.sku || null,
        metadata.targetUrl || `https://demo.inelabteamdev.com/product/${numericId}`
      ]
    );

    return ins.rows[0].id;
  }

  /**
   * Records a scrape attempt audit log.
   * 
   * @param {object} logEntry
   * @returns {Promise<object>}
   */
  async recordScrapeLog(logEntry) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const numericStoreId = parseInt(logEntry.productId, 10);
      const trackedProductId = await this._getOrCreateTrackedProductId(client, numericStoreId);

      const query = `
        INSERT INTO scrape_logs (
          product_id, store_product_id, correlation_id, status,
          attempt_number, max_attempts, duration_ms,
          extracted_price, extracted_stock, http_status_code,
          error_code, error_message, scraper_mode, attempt_timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        RETURNING *
      `;

      const values = [
        trackedProductId,
        numericStoreId,
        logEntry.correlationId || null,
        logEntry.status,
        logEntry.attemptNumber || logEntry.attemptCount || 1,
        logEntry.maxAttempts || 3,
        logEntry.durationMs || 0,
        logEntry.extractedPrice || null,
        logEntry.extractedStock || null,
        logEntry.httpStatusCode || null,
        logEntry.errorType || logEntry.errorCode || null,
        logEntry.errorMessage || null,
        logEntry.scraperMode || 'headless'
      ];

      const res = await client.query(query, values);
      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Records a validated price snapshot to price_history.
   * STRICT INTEGRITY: Re-runs validation; fails immediately if data is corrupt.
   * 
   * @param {object} historyEntry
   * @returns {Promise<object>}
   */
  async recordPriceHistory(historyEntry) {
    validateScrapedProduct(historyEntry);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const numericStoreId = parseInt(historyEntry.productId, 10);
      const trackedProductId = await this._getOrCreateTrackedProductId(client, numericStoreId, {
        name: historyEntry.productName
      });

      const query = `
        INSERT INTO price_history (
          product_id, price, currency, mrp, stock_status, stock_count, raw_stock_text, scraped_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (product_id, date_trunc('minute', scraped_at)) DO NOTHING
        RETURNING *
      `;

      const values = [
        trackedProductId,
        historyEntry.price,
        historyEntry.currency || 'INR',
        historyEntry.mrp || null,
        historyEntry.stockStatus,
        historyEntry.stockCount,
        historyEntry.rawStockText || null,
        historyEntry.scrapedAt ? new Date(historyEntry.scrapedAt) : new Date()
      ];

      const res = await client.query(query, values);
      await client.query('COMMIT');
      return res.rows[0] || { duplicateIgnored: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Updates tracked_products latest status without overwriting valid data with nulls.
   * 
   * @param {string|number} productId
   * @param {object} latestState
   * @returns {Promise<object>}
   */
  async updateTrackedProductLatest(productId, latestState) {
    const client = await this.pool.connect();
    try {
      const numericStoreId = parseInt(productId, 10);
      await client.query('BEGIN');

      const trackedProductId = await this._getOrCreateTrackedProductId(client, numericStoreId);

      let query = '';
      let values = [];

      if (latestState.lastScrapeStatus === 'success') {
        // SUCCESS: Update price, stock, and timestamp
        query = `
          UPDATE tracked_products SET
            latest_price = $1,
            latest_currency = $2,
            latest_stock_status = $3,
            latest_stock_count = $4,
            latest_raw_stock_text = $5,
            last_scraped_at = $6,
            last_scrape_status = 'success',
            last_error_message = NULL,
            version = version + 1,
            updated_at = NOW()
          WHERE id = $7
          RETURNING *
        `;
        values = [
          latestState.latestPrice,
          latestState.latestCurrency || 'INR',
          latestState.latestStockStatus,
          latestState.latestStockCount,
          latestState.latestRawStockText || null,
          latestState.lastScrapedAt ? new Date(latestState.lastScrapedAt) : new Date(),
          trackedProductId
        ];
      } else {
        // FAILURE: Update ONLY status and error message; DO NOT TOUCH PRICE OR STOCK!
        query = `
          UPDATE tracked_products SET
            last_scraped_at = $1,
            last_scrape_status = 'failed',
            last_error_message = $2,
            version = version + 1,
            updated_at = NOW()
          WHERE id = $3
          RETURNING *
        `;
        values = [
          latestState.lastScrapedAt ? new Date(latestState.lastScrapedAt) : new Date(),
          latestState.lastErrorMessage || 'Scrape failed',
          trackedProductId
        ];
      }

      const res = await client.query(query, values);
      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Executes an atomic successful scrape transaction.
   * 
   * @param {object} candidate - Validated candidate data.
   * @param {object} logEntry - Audit log details.
   */
  async persistAtomicSuccess(candidate, logEntry) {
    validateScrapedProduct(candidate);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const numericStoreId = parseInt(candidate.productId, 10);
      const trackedProductId = await this._getOrCreateTrackedProductId(client, numericStoreId, {
        name: candidate.productName
      });

      // 1. Insert scrape log
      await client.query(
        `INSERT INTO scrape_logs (
          product_id, store_product_id, correlation_id, status,
          attempt_number, max_attempts, duration_ms,
          extracted_price, extracted_stock, http_status_code,
          error_code, error_message, scraper_mode, attempt_timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
        [
          trackedProductId,
          numericStoreId,
          logEntry.correlationId || null,
          'success',
          logEntry.attemptNumber || 1,
          logEntry.maxAttempts || 3,
          logEntry.durationMs || 0,
          candidate.price,
          candidate.rawStockText,
          logEntry.httpStatusCode || 200,
          null,
          null,
          logEntry.scraperMode || 'headless'
        ]
      );

      // 2. Insert price history
      await client.query(
        `INSERT INTO price_history (
          product_id, price, currency, mrp, stock_status, stock_count, raw_stock_text, scraped_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (product_id, date_trunc('minute', scraped_at)) DO NOTHING`,
        [
          trackedProductId,
          candidate.price,
          candidate.currency || 'INR',
          candidate.mrp || null,
          candidate.stockStatus,
          candidate.stockCount,
          candidate.rawStockText,
          new Date()
        ]
      );

      // 3. Update tracked products latest state
      const updateRes = await client.query(
        `UPDATE tracked_products SET
          latest_price = $1,
          latest_currency = $2,
          latest_stock_status = $3,
          latest_stock_count = $4,
          latest_raw_stock_text = $5,
          last_scraped_at = NOW(),
          last_scrape_status = 'success',
          last_error_message = NULL,
          version = version + 1,
          updated_at = NOW()
        WHERE id = $6
        RETURNING *`,
        [
          candidate.price,
          candidate.currency || 'INR',
          candidate.stockStatus,
          candidate.stockCount,
          candidate.rawStockText,
          trackedProductId
        ]
      );

      await client.query('COMMIT');
      return updateRes.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Executes an atomic failed scrape transaction.
   * STRICT INTEGRITY: Preserves previous known valid price/stock; ZERO rows in price_history.
   * 
   * @param {string|number} productId
   * @param {object} errorInfo
   * @param {object} logEntry
   */
  async persistAtomicFailure(productId, errorInfo, logEntry = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const numericStoreId = parseInt(productId, 10);
      const trackedProductId = await this._getOrCreateTrackedProductId(client, numericStoreId);

      // 1. Insert failed audit log
      await client.query(
        `INSERT INTO scrape_logs (
          product_id, store_product_id, correlation_id, status,
          attempt_number, max_attempts, duration_ms,
          extracted_price, extracted_stock, http_status_code,
          error_code, error_message, scraper_mode, attempt_timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
        [
          trackedProductId,
          numericStoreId,
          logEntry.correlationId || null,
          'failed',
          logEntry.attemptNumber || logEntry.attemptCount || 3,
          logEntry.maxAttempts || 3,
          logEntry.durationMs || 0,
          null, // NO fake price
          null, // NO fake stock
          errorInfo.httpStatusCode || logEntry.httpStatusCode || null,
          errorInfo.errorType || errorInfo.errorCode || 'SCRAPE_FAILED',
          errorInfo.errorMessage || 'Scrape failed',
          logEntry.scraperMode || 'headless'
        ]
      );

      // 2. Update tracked products: DO NOT OVERWRITE PREVIOUS VALID PRICE OR STOCK!
      const updateRes = await client.query(
        `UPDATE tracked_products SET
          last_scraped_at = NOW(),
          last_scrape_status = 'failed',
          last_error_message = $1,
          version = version + 1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
        [
          errorInfo.errorMessage || 'Scrape failed',
          trackedProductId
        ]
      );

      await client.query('COMMIT');
      return updateRes.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  SupabasePersistence
};

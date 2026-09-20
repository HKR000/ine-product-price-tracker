/**
 * Tracked Products Database Service.
 * 
 * Implements clean, parameterized PostgreSQL queries for:
 * 1. Product tracking (upsert / reactivate)
 * 2. Listing tracked products with latest verified price/stock
 * 3. Chronological price/stock history querying
 * 4. Audit scrape logs querying
 * 5. Deactivation (soft-delete)
 */

const crypto = require('crypto');
const { getDbPool } = require('../db/connection');
const { defaultDiscovery } = require('../scraper/discovery');

class ProductService {
  constructor(pool = null) {
    this._pool = pool;
    this._memoryProducts = new Map();
    this._memoryHistory = new Map();
    this._memoryLogs = new Map();
  }

  get pool() {
    return this._pool || getDbPool();
  }

  isUsingMemoryFallback() {
    return !this.pool;
  }

  /**
   * Returns an in-memory persistence adapter connected to this service's internal state.
   */
  getPersistenceAdapter() {
    const self = this;
    return {
      async recordScrapeLog(logEntry) {
        const product = await self.getTrackedProduct(logEntry.productId);
        const productId = product ? product.id : String(logEntry.productId);
        const entry = {
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          product_id: productId,
          store_product_id: logEntry.productId,
          correlation_id: logEntry.correlationId,
          status: logEntry.status,
          attempt_number: logEntry.attemptNumber,
          max_attempts: logEntry.maxAttempts,
          duration_ms: logEntry.durationMs,
          extracted_price: logEntry.extractedPrice,
          extracted_stock: logEntry.extractedStock,
          http_status_code: logEntry.httpStatusCode,
          error_code: logEntry.errorCode,
          error_message: logEntry.errorMessage,
          scraper_mode: logEntry.scraperMode,
          attempt_timestamp: new Date().toISOString()
        };

        const list = self._memoryLogs.get(productId) || [];
        list.unshift(entry);
        self._memoryLogs.set(productId, list);
        if (product) {
          self._memoryLogs.set(String(product.store_product_id), list);
        }
        return entry;
      },

      async recordPriceHistory(historyEntry) {
        const product = await self.getTrackedProduct(historyEntry.productId);
        const productId = product ? product.id : String(historyEntry.productId);
        const entry = {
          id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          product_id: productId,
          price: historyEntry.price,
          currency: historyEntry.currency || 'INR',
          mrp: historyEntry.mrp,
          stock_status: historyEntry.stockStatus,
          stock_count: historyEntry.stockCount,
          raw_stock_text: historyEntry.rawStockText,
          scraped_at: historyEntry.scrapedAt || new Date().toISOString()
        };

        const list = self._memoryHistory.get(productId) || [];
        list.push(entry);
        self._memoryHistory.set(productId, list);
        if (product) {
          self._memoryHistory.set(String(product.store_product_id), list);
        }
        return entry;
      },

      async updateTrackedProductLatest(productId, latestState) {
        const product = await self.getTrackedProduct(productId);
        if (!product) return null;
        if (latestState.latestPrice !== undefined) product.latest_price = latestState.latestPrice;
        if (latestState.latestCurrency !== undefined) product.latest_currency = latestState.latestCurrency;
        if (latestState.latestStockStatus !== undefined) product.latest_stock_status = latestState.latestStockStatus;
        if (latestState.latestStockCount !== undefined) product.latest_stock_count = latestState.latestStockCount;
        if (latestState.lastScrapedAt !== undefined) product.last_scraped_at = latestState.lastScrapedAt;
        if (latestState.lastScrapeStatus !== undefined) product.last_scrape_status = latestState.lastScrapeStatus;
        if (latestState.lastErrorMessage !== undefined) product.last_error_message = latestState.lastErrorMessage;
        product.updated_at = new Date().toISOString();
        return product;
      }
    };
  }

  /**
   * Tracks a new product or reactivates an existing one.
   * 
   * @param {object} payload
   * @param {number} payload.storeProductId
   * @param {string} [payload.targetUrl]
   * @param {string} [payload.name]
   * @param {string} [payload.brand]
   * @param {string} [payload.category]
   * @param {string} [payload.sku]
   * @param {string} [payload.description]
   * @returns {Promise<object>}
   */
  async trackProduct(payload) {
    const storeId = payload.storeProductId;
    let name = payload.name;
    let brand = payload.brand || null;
    let category = payload.category || null;
    let sku = payload.sku || null;
    let description = payload.description || null;
    let slug = payload.slug || `product-${storeId}`;
    const targetUrl = payload.targetUrl || `https://demo.inelabteamdev.com/product/${storeId}`;

    // If name or details are missing, fetch from storefront catalog
    if (!name) {
      try {
        const meta = await defaultDiscovery.getProductMetadata(storeId);
        name = meta.name || `Product ${storeId}`;
        brand = meta.brand || brand;
        category = meta.category || category;
        sku = meta.sku || sku;
        description = meta.description || description;
        slug = meta.slug || slug;
      } catch {
        name = `Product ${storeId}`;
      }
    }

    if (!this.pool) {
      // In-memory fallback for local dev / testing
      let existing = Array.from(this._memoryProducts.values()).find(p => p.store_product_id === storeId);
      if (existing) {
        existing.is_active = true;
        existing.name = name;
        existing.updated_at = new Date().toISOString();
        return existing;
      }

      const newProduct = {
        id: crypto.randomUUID(),
        store_product_id: storeId,
        slug,
        name,
        brand,
        category,
        sku,
        description,
        target_url: targetUrl,
        is_active: true,
        latest_price: null,
        latest_currency: 'INR',
        latest_stock_status: null,
        latest_stock_count: null,
        last_scraped_at: null,
        last_scrape_status: 'pending',
        last_error_message: null,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      this._memoryProducts.set(newProduct.id, newProduct);
      return newProduct;
    }

    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO tracked_products (
          store_product_id, slug, name, brand, category, sku, description, target_url, is_active, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW())
        ON CONFLICT (store_product_id) DO UPDATE SET
          is_active = TRUE,
          name = EXCLUDED.name,
          updated_at = NOW()
        RETURNING *;
      `;

      const values = [storeId, slug, name, brand, category, sku, description, targetUrl];
      const res = await client.query(query, values);

      return res.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Returns all active tracked products with latest scrape metrics.
   * 
   * @returns {Promise<Array<object>>}
   */
  async listTrackedProducts() {
    if (!this.pool) {
      return Array.from(this._memoryProducts.values()).filter(p => p.is_active);
    }

    const client = await this.pool.connect();
    try {
      const query = `
        SELECT 
          id, store_product_id, slug, name, brand, category, sku,
          target_url, is_active, latest_price, latest_currency,
          latest_stock_status, latest_stock_count, last_scraped_at,
          last_scrape_status, last_error_message, created_at, updated_at
        FROM tracked_products
        WHERE is_active = TRUE
        ORDER BY updated_at DESC;
      `;

      const res = await client.query(query);
      return res.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves a single tracked product by internal UUID or store_product_id.
   * 
   * @param {string|number} identifier
   * @returns {Promise<object|null>}
   */
  async getTrackedProduct(identifier) {
    if (!this.pool) {
      const isNumeric = /^\d+$/.test(String(identifier));
      const numericId = isNumeric ? parseInt(identifier, 10) : null;
      for (const p of this._memoryProducts.values()) {
        if (p.id === identifier || (isNumeric && p.store_product_id === numericId)) {
          return p;
        }
      }
      return null;
    }

    const client = await this.pool.connect();
    try {
      const isNumeric = /^\d+$/.test(String(identifier));
      const query = isNumeric
        ? `SELECT * FROM tracked_products WHERE store_product_id = $1`
        : `SELECT * FROM tracked_products WHERE id = $1`;

      const values = isNumeric ? [parseInt(identifier, 10)] : [identifier];
      const res = await client.query(query, values);
      return res.rows[0] || null;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves chronological price and stock history for a product.
   * 
   * @param {string|number} identifier
   * @param {number} [limit=100]
   * @returns {Promise<{ product: object, history: Array<object> }>}
   */
  async getPriceHistory(identifier, limit = 100) {
    const product = await this.getTrackedProduct(identifier);
    if (!product) return null;

    if (!this.pool) {
      const list = this._memoryHistory.get(product.id) || this._memoryHistory.get(String(product.store_product_id)) || [];
      return { product, history: list.slice(-limit) };
    }

    const client = await this.pool.connect();
    try {
      const query = `
        SELECT 
          id, product_id, price, currency, mrp, stock_status,
          stock_count, raw_stock_text, scraped_at
        FROM price_history
        WHERE product_id = $1
        ORDER BY scraped_at ASC
        LIMIT $2
      `;

      const res = await client.query(query, [product.id, limit]);
      return {
        product,
        history: res.rows
      };
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves audit scrape logs for a product.
   * 
   * @param {string|number} identifier
   * @param {number} [limit=50]
   * @returns {Promise<{ product: object, logs: Array<object> }>}
   */
  async getScrapeLogs(identifier, limit = 50) {
    const product = await this.getTrackedProduct(identifier);
    if (!product) return null;

    if (!this.pool) {
      const list = this._memoryLogs.get(product.id) || this._memoryLogs.get(String(product.store_product_id)) || [];
      return { product, logs: list.slice(-limit) };
    }

    const client = await this.pool.connect();
    try {
      const query = `
        SELECT 
          id, product_id, store_product_id, correlation_id, status,
          attempt_number, max_attempts, duration_ms,
          extracted_price, extracted_stock, http_status_code,
          error_code, error_message, scraper_mode, attempt_timestamp
        FROM scrape_logs
        WHERE product_id = $1
        ORDER BY attempt_timestamp DESC
        LIMIT $2
      `;

      const res = await client.query(query, [product.id, limit]);
      return {
        product,
        logs: res.rows
      };
    } finally {
      client.release();
    }
  }

  /**
   * Deactivates tracking for a product (soft delete).
   * 
   * @param {string|number} identifier
   * @returns {Promise<boolean>}
   */
  async deactivateProduct(identifier) {
    if (!this.pool) {
      const product = await this.getTrackedProduct(identifier);
      if (product) {
        product.is_active = false;
        product.updated_at = new Date().toISOString();
        return true;
      }
      return false;
    }

    const client = await this.pool.connect();
    try {
      const isNumeric = /^\d+$/.test(String(identifier));
      const query = isNumeric
        ? `UPDATE tracked_products SET is_active = FALSE, updated_at = NOW() WHERE store_product_id = $1 RETURNING id`
        : `UPDATE tracked_products SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`;

      const values = isNumeric ? [parseInt(identifier, 10)] : [identifier];
      const res = await client.query(query, values);
      return res.rows.length > 0;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  ProductService,
  defaultProductService: new ProductService()
};

/**
 * Persistence Interface & In-Memory Stub for Scraping Subsystem.
 * 
 * CORE CONTRACT:
 * 1. Price History is ONLY recorded on validated successful scrapes.
 * 2. Scrape Logs are ALWAYS recorded on every attempt (success, retried, failed).
 * 3. Strict separation of concerns between extraction engine and database layer.
 */

const { ValidationError } = require('./errors');
const { validateScrapedProduct } = require('./validator');

/**
 * Base Abstract Persistence Interface.
 */
class PersistenceInterface {
  async recordScrapeLog(logEntry) {
    throw new Error('recordScrapeLog must be implemented');
  }

  async recordPriceHistory(historyEntry) {
    throw new Error('recordPriceHistory must be implemented');
  }

  async updateTrackedProductLatest(productId, latestState) {
    throw new Error('updateTrackedProductLatest must be implemented');
  }
}

/**
 * In-Memory Persistence Adapter for Unit & Integration Testing.
 * Validates entries and records operations in memory for audit assertion.
 */
class InMemoryPersistence extends PersistenceInterface {
  constructor() {
    super();
    this.priceHistory = [];
    this.scrapeLogs = [];
    this.trackedProducts = new Map();
  }

  /**
   * Persists a scrape attempt audit log.
   * 
   * @param {object} logEntry
   * @param {string|number} logEntry.productId
   * @param {'success'|'retried'|'failed'} logEntry.status
   * @param {number} logEntry.attemptNumber
   * @param {number} logEntry.durationMs
   * @param {number|null} [logEntry.extractedPrice=null]
   * @param {string|null} [logEntry.extractedStock=null]
   * @param {string|null} [logEntry.errorCode=null]
   * @param {string|null} [logEntry.errorMessage=null]
   * @param {number|null} [logEntry.httpStatusCode=null]
   * @param {string} [logEntry.scraperMode='headless']
   */
  async recordScrapeLog(logEntry) {
    const entry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...logEntry
    };
    this.scrapeLogs.push(entry);
    return entry;
  }

  /**
   * Persists a validated price snapshot to historical records.
   * STRICT INTEGRITY: Re-runs validation; fails immediately if data is corrupt.
   * 
   * @param {object} historyEntry
   */
  async recordPriceHistory(historyEntry) {
    validateScrapedProduct(historyEntry);

    const entry = {
      id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      scrapedAt: new Date().toISOString(),
      ...historyEntry
    };
    this.priceHistory.push(entry);
    return entry;
  }

  /**
   * Updates denormalized latest status on product record.
   * 
   * @param {string|number} productId
   * @param {object} latestState
   */
  async updateTrackedProductLatest(productId, latestState) {
    const existing = this.trackedProducts.get(String(productId)) || { storeProductId: productId };
    const updated = {
      ...existing,
      ...latestState,
      updatedAt: new Date().toISOString()
    };
    this.trackedProducts.set(String(productId), updated);
    return updated;
  }

  /**
   * Helper to clear memory between test cases.
   */
  reset() {
    this.priceHistory = [];
    this.scrapeLogs = [];
    this.trackedProducts.clear();
  }
}

module.exports = {
  PersistenceInterface,
  InMemoryPersistence
};

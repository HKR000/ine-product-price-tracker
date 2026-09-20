const { describe, it } = require('node:test');
const assert = require('node:assert');
const { InMemoryPersistence } = require('../../src/scraper/persistenceInterface');
const { SupabasePersistence } = require('../../src/db/supabasePersistence');
const { ValidationError } = require('../../src/scraper/errors');

describe('Database Persistence Layer Verification', () => {
  describe('InMemoryPersistence Contracts', () => {
    it('1. SUCCESS: creates scrape log, price history, and updates tracked product', async () => {
      const db = new InMemoryPersistence();

      const candidate = {
        productId: 154,
        productName: 'Summit Approach Shoe Mini',
        price: 13626.00,
        currency: 'INR',
        mrp: 17248.00,
        stockStatus: 'in_stock',
        stockCount: 178,
        rawStockText: 'Selling fast — 178 left'
      };

      const log = {
        productId: 154,
        status: 'success',
        attemptNumber: 1,
        durationMs: 4200,
        extractedPrice: 13626.00,
        extractedStock: 'Selling fast — 178 left',
        httpStatusCode: 200
      };

      await db.recordScrapeLog(log);
      await db.recordPriceHistory(candidate);
      await db.updateTrackedProductLatest(154, {
        latestPrice: candidate.price,
        latestCurrency: candidate.currency,
        latestStockStatus: candidate.stockStatus,
        latestStockCount: candidate.stockCount,
        lastScrapedAt: new Date().toISOString(),
        lastScrapeStatus: 'success'
      });

      // Assertions
      assert.strictEqual(db.scrapeLogs.length, 1);
      assert.strictEqual(db.scrapeLogs[0].status, 'success');
      assert.strictEqual(db.scrapeLogs[0].extractedPrice, 13626);
      assert.ok(db.scrapeLogs[0].timestamp);

      assert.strictEqual(db.priceHistory.length, 1);
      assert.strictEqual(db.priceHistory[0].price, 13626);
      assert.strictEqual(db.priceHistory[0].stockStatus, 'in_stock');
      assert.strictEqual(db.priceHistory[0].stockCount, 178);

      const tracked = db.trackedProducts.get('154');
      assert.strictEqual(tracked.latestPrice, 13626);
      assert.strictEqual(tracked.latestStockStatus, 'in_stock');
      assert.strictEqual(tracked.lastScrapeStatus, 'success');
    });

    it('2. FAILURE: creates failed log, preserves previous valid price, NEVER creates price history', async () => {
      const db = new InMemoryPersistence();

      // Seed previous valid state: Price ₹14,000, Stock 50
      db.trackedProducts.set('154', {
        storeProductId: 154,
        latestPrice: 14000.00,
        latestStockStatus: 'in_stock',
        latestStockCount: 50,
        lastScrapedAt: '2026-09-20T05:00:00.000Z',
        lastScrapeStatus: 'success'
      });

      // Now record a failure
      const failLog = {
        productId: 154,
        status: 'failed',
        attemptNumber: 3,
        durationMs: 8500,
        httpStatusCode: 503,
        errorCode: 'UPSTREAM_ERROR',
        errorMessage: 'Mock store returned 503 upstream_error'
      };

      await db.recordScrapeLog(failLog);
      await db.updateTrackedProductLatest(154, {
        lastScrapedAt: new Date().toISOString(),
        lastScrapeStatus: 'failed',
        lastErrorMessage: failLog.errorMessage
      });

      // CRITICAL VERIFICATION:
      // 1. Zero price history records created
      assert.strictEqual(db.priceHistory.length, 0);

      // 2. Failed log exists with complete diagnostics
      assert.strictEqual(db.scrapeLogs.length, 1);
      assert.strictEqual(db.scrapeLogs[0].status, 'failed');
      assert.strictEqual(db.scrapeLogs[0].attemptNumber, 3);
      assert.strictEqual(db.scrapeLogs[0].errorCode, 'UPSTREAM_ERROR');

      // 3. PREVIOUS VALID STATE PRESERVED (NOT overwritten by null/zero/garbage!)
      const tracked = db.trackedProducts.get('154');
      assert.strictEqual(tracked.latestPrice, 14000.00, 'Previous price must NOT be overwritten');
      assert.strictEqual(tracked.latestStockStatus, 'in_stock', 'Previous stock status must NOT be overwritten');
      assert.strictEqual(tracked.latestStockCount, 50, 'Previous stock count must NOT be overwritten');
      assert.strictEqual(tracked.lastScrapeStatus, 'failed');
    });

    it('3. RETRY THEN SUCCESS: records retried log for attempt 1, success for attempt 2, exactly 1 history row', async () => {
      const db = new InMemoryPersistence();

      // Attempt 1: retried
      await db.recordScrapeLog({
        productId: 154,
        status: 'retried',
        attemptNumber: 1,
        durationMs: 3100,
        httpStatusCode: 503,
        errorCode: 'UPSTREAM_ERROR',
        errorMessage: 'Temporary 503'
      });

      // Attempt 2: success
      const candidate = {
        productId: 154,
        productName: 'Summit Approach Shoe Mini',
        price: 13626.00,
        currency: 'INR',
        stockStatus: 'in_stock',
        stockCount: 178
      };

      await db.recordScrapeLog({
        productId: 154,
        status: 'success',
        attemptNumber: 2,
        durationMs: 4200,
        extractedPrice: 13626.00,
        httpStatusCode: 200
      });

      await db.recordPriceHistory(candidate);

      assert.strictEqual(db.scrapeLogs.length, 2);
      assert.strictEqual(db.scrapeLogs[0].status, 'retried');
      assert.strictEqual(db.scrapeLogs[0].attemptNumber, 1);
      assert.strictEqual(db.scrapeLogs[1].status, 'success');
      assert.strictEqual(db.scrapeLogs[1].attemptNumber, 2);

      assert.strictEqual(db.priceHistory.length, 1);
      assert.strictEqual(db.priceHistory[0].price, 13626.00);
    });

    it('4. ALL RETRIES FAILED: records 2 retried and 1 failed log, zero price history', async () => {
      const db = new InMemoryPersistence();

      await db.recordScrapeLog({ productId: 154, status: 'retried', attemptNumber: 1, durationMs: 2000 });
      await db.recordScrapeLog({ productId: 154, status: 'retried', attemptNumber: 2, durationMs: 2000 });
      await db.recordScrapeLog({ productId: 154, status: 'failed', attemptNumber: 3, durationMs: 2000 });

      assert.strictEqual(db.scrapeLogs.length, 3);
      assert.strictEqual(db.scrapeLogs[0].status, 'retried');
      assert.strictEqual(db.scrapeLogs[1].status, 'retried');
      assert.strictEqual(db.scrapeLogs[2].status, 'failed');
      assert.strictEqual(db.priceHistory.length, 0);
    });

    it('5. INVALID EXTRACTED PRICE: throws ValidationError, ZERO price history written', async () => {
      const db = new InMemoryPersistence();

      const corruptCandidate = {
        productId: 154,
        productName: 'Corrupt Item',
        price: 0, // Illegal: price must be > 0
        currency: 'INR',
        stockStatus: 'in_stock',
        stockCount: 10
      };

      await assert.rejects(async () => {
        await db.recordPriceHistory(corruptCandidate);
      }, ValidationError);
      assert.strictEqual(db.priceHistory.length, 0);
    });

    it('6. INVALID STOCK: throws ValidationError on illegal stock status, ZERO price history written', async () => {
      const db = new InMemoryPersistence();

      const invalidStockCandidate = {
        productId: 154,
        productName: 'Item',
        price: 1000,
        currency: 'INR',
        stockStatus: 'invented_status', // Illegal
        stockCount: 10
      };

      await assert.rejects(async () => {
        await db.recordPriceHistory(invalidStockCandidate);
      }, ValidationError);
      assert.strictEqual(db.priceHistory.length, 0);
    });
  });

  describe('SupabasePersistence SQL Query & Transaction Boundaries', () => {
    function createMockPool() {
      const executedQueries = [];
      const mockClient = {
        query: async (sql, params) => {
          executedQueries.push({ sql: sql.trim(), params });
          if (sql.includes('SELECT id') && sql.includes('FOR UPDATE')) {
            return { rows: [{ id: 'mock-uuid-154', version: 1, latest_price: 14000 }] };
          }
          if (sql.includes('INSERT INTO tracked_products')) {
            return { rows: [{ id: 'mock-uuid-154' }] };
          }
          if (sql.includes('INSERT INTO scrape_logs')) {
            return { rows: [{ id: 'mock-log-1', status: params?.[3], attempt_number: params?.[4] }] };
          }
          if (sql.includes('INSERT INTO price_history')) {
            return { rows: [{ id: 'mock-hist-1', price: params?.[1] }] };
          }
          if (sql.includes('UPDATE tracked_products')) {
            return { rows: [{ id: 'mock-uuid-154', version: 2 }] };
          }
          return { rows: [] };
        },
        release: () => {}
      };

      const pool = {
        connect: async () => mockClient,
        executedQueries
      };

      return { pool, mockClient, executedQueries };
    }

    it('1. SUCCESS: executes atomic BEGIN / COMMIT transaction with FOR UPDATE lock on success', async () => {
      const { pool, executedQueries } = createMockPool();
      const persistence = new SupabasePersistence(pool);

      const candidate = {
        productId: 154,
        productName: 'Summit Shoe',
        price: 13626.00,
        currency: 'INR',
        stockStatus: 'in_stock',
        stockCount: 10,
        rawStockText: 'Only 10 left'
      };

      const logEntry = {
        correlationId: 'corr_test_1',
        attemptNumber: 1,
        durationMs: 3500
      };

      await persistence.persistAtomicSuccess(candidate, logEntry);

      // Verify Transaction SQL Commands
      const sqlStatements = executedQueries.map(q => q.sql);
      assert.ok(sqlStatements.includes('BEGIN'), 'Must begin transaction');
      assert.ok(sqlStatements.some(s => s.includes('FOR UPDATE')), 'Must acquire row lock to prevent race conditions');
      assert.ok(sqlStatements.some(s => s.includes('INSERT INTO scrape_logs')), 'Must insert scrape log');
      assert.ok(sqlStatements.some(s => s.includes('INSERT INTO price_history')), 'Must insert price history');
      assert.ok(sqlStatements.some(s => s.includes('UPDATE tracked_products')), 'Must update tracked product');
      assert.ok(sqlStatements.includes('COMMIT'), 'Must commit transaction');

      // Verify parameters
      const logInsert = executedQueries.find(q => q.sql.includes('INSERT INTO scrape_logs'));
      assert.strictEqual(logInsert.params[3], 'success');
      assert.strictEqual(logInsert.params[7], 13626.00); // extracted_price
    });

    it('2. FAILURE: executes atomic failure transaction WITHOUT inserting into price_history and preserves previous state', async () => {
      const { pool, executedQueries } = createMockPool();
      const persistence = new SupabasePersistence(pool);

      const errorInfo = {
        errorType: 'UPSTREAM_503',
        errorMessage: '503 Service Unavailable',
        httpStatusCode: 503
      };

      const logEntry = {
        correlationId: 'corr_test_2',
        attemptCount: 3,
        durationMs: 4000
      };

      await persistence.persistAtomicFailure(154, errorInfo, logEntry);

      const sqlStatements = executedQueries.map(q => q.sql);
      assert.ok(sqlStatements.includes('BEGIN'));
      assert.ok(sqlStatements.some(s => s.includes('INSERT INTO scrape_logs')));
      assert.ok(sqlStatements.some(s => s.includes('UPDATE tracked_products')));
      assert.ok(sqlStatements.includes('COMMIT'));

      // CRITICAL: Ensure price_history was NEVER inserted!
      assert.ok(
        !sqlStatements.some(s => s.includes('INSERT INTO price_history')),
        'FAILED transaction MUST NOT touch price_history table'
      );

      // Verify failure log details
      const logInsert = executedQueries.find(q => q.sql.includes('INSERT INTO scrape_logs'));
      assert.strictEqual(logInsert.params[3], 'failed');
      assert.strictEqual(logInsert.params[4], 3); // attempt count
      assert.strictEqual(logInsert.params[7], null); // NO fake price
      assert.strictEqual(logInsert.params[8], null); // NO fake stock
      assert.strictEqual(logInsert.params[10], 'UPSTREAM_503'); // error type
      assert.strictEqual(logInsert.params[11], '503 Service Unavailable'); // error message

      // Verify tracked product update does NOT touch latest_price or stock columns
      const updateStmt = executedQueries.find(q => q.sql.includes('UPDATE tracked_products'));
      assert.ok(!updateStmt.sql.includes('latest_price ='), 'Must NOT overwrite latest_price on failure');
      assert.ok(!updateStmt.sql.includes('latest_stock_status ='), 'Must NOT overwrite latest_stock_status on failure');
    });

    it('3. RETRY THEN SUCCESS: records retried log for attempt 1, then atomic success for attempt 2', async () => {
      const { pool, executedQueries } = createMockPool();
      const persistence = new SupabasePersistence(pool);

      // Attempt 1: Retried log
      await persistence.recordScrapeLog({
        productId: 154,
        status: 'retried',
        attemptNumber: 1,
        durationMs: 2500,
        errorType: 'PAGE_TIMEOUT',
        errorMessage: 'Navigation timed out after 15000ms'
      });

      // Attempt 2: Atomic success
      const candidate = {
        productId: 154,
        productName: 'Summit Shoe',
        price: 13626.00,
        currency: 'INR',
        stockStatus: 'in_stock',
        stockCount: 10,
        rawStockText: 'Only 10 left'
      };

      await persistence.persistAtomicSuccess(candidate, {
        attemptNumber: 2,
        durationMs: 3200
      });

      const logInserts = executedQueries.filter(q => q.sql.includes('INSERT INTO scrape_logs'));
      assert.strictEqual(logInserts.length, 2, 'Must record 2 scrape logs');
      assert.strictEqual(logInserts[0].params[3], 'retried');
      assert.strictEqual(logInserts[0].params[4], 1);
      assert.strictEqual(logInserts[1].params[3], 'success');
      assert.strictEqual(logInserts[1].params[4], 2);

      const priceHistInserts = executedQueries.filter(q => q.sql.includes('INSERT INTO price_history'));
      assert.strictEqual(priceHistInserts.length, 1, 'Exactly 1 price history row created');
    });

    it('4. ALL RETRIES FAILED: records retried logs and terminal failure, zero price history rows', async () => {
      const { pool, executedQueries } = createMockPool();
      const persistence = new SupabasePersistence(pool);

      await persistence.recordScrapeLog({ productId: 154, status: 'retried', attemptNumber: 1, durationMs: 1500 });
      await persistence.recordScrapeLog({ productId: 154, status: 'retried', attemptNumber: 2, durationMs: 1500 });
      await persistence.persistAtomicFailure(154, {
        errorType: 'UPSTREAM_503',
        errorMessage: '503 Service Unavailable'
      }, {
        attemptNumber: 3,
        durationMs: 2000
      });

      const logInserts = executedQueries.filter(q => q.sql.includes('INSERT INTO scrape_logs'));
      assert.strictEqual(logInserts.length, 3);
      assert.strictEqual(logInserts[0].params[3], 'retried');
      assert.strictEqual(logInserts[1].params[3], 'retried');
      assert.strictEqual(logInserts[2].params[3], 'failed');

      const priceHistInserts = executedQueries.filter(q => q.sql.includes('INSERT INTO price_history'));
      assert.strictEqual(priceHistInserts.length, 0, 'ZERO price history rows on total failure');
    });

    it('5. INVALID EXTRACTED PRICE: rejects with ValidationError, aborts transaction without touching DB', async () => {
      const { pool, executedQueries } = createMockPool();
      const persistence = new SupabasePersistence(pool);

      const invalidCandidates = [
        { productId: 154, price: 0, stockStatus: 'in_stock' },
        { productId: 154, price: -50, stockStatus: 'in_stock' },
        { productId: 154, price: null, stockStatus: 'in_stock' },
        { productId: 154, price: NaN, stockStatus: 'in_stock' },
        { productId: 154, price: 'one thousand', stockStatus: 'in_stock' }
      ];

      for (const cand of invalidCandidates) {
        await assert.rejects(async () => {
          await persistence.persistAtomicSuccess(cand, { attemptNumber: 1 });
        }, ValidationError);

        await assert.rejects(async () => {
          await persistence.recordPriceHistory(cand);
        }, ValidationError);
      }

      assert.strictEqual(executedQueries.length, 0, 'Must NOT touch DB when price is invalid');
    });

    it('6. INVALID STOCK: rejects with ValidationError, aborts without writing price history', async () => {
      const { pool, executedQueries } = createMockPool();
      const persistence = new SupabasePersistence(pool);

      const invalidStockCandidates = [
        { productId: 154, price: 1000, stockStatus: 'available' }, // not in_stock/out_of_stock
        { productId: 154, price: 1000, stockStatus: null },
        { productId: 154, price: 1000, stockStatus: '' }
      ];

      for (const cand of invalidStockCandidates) {
        await assert.rejects(async () => {
          await persistence.persistAtomicSuccess(cand, { attemptNumber: 1 });
        }, ValidationError);
      }

      assert.strictEqual(executedQueries.length, 0, 'Must NOT touch DB when stock status is invalid');
    });

    it('7. RACE CONDITION & CONCURRENCY: serializes concurrent transactions using FOR UPDATE', async () => {
      const { pool, executedQueries } = createMockPool();
      const persistence = new SupabasePersistence(pool);

      const candidateA = { productId: 154, productName: 'Product 154', price: 1000, currency: 'INR', stockStatus: 'in_stock' };
      const candidateB = { productId: 154, productName: 'Product 154', price: 1100, currency: 'INR', stockStatus: 'in_stock' };

      // Execute concurrently
      await Promise.all([
        persistence.persistAtomicSuccess(candidateA, { attemptNumber: 1 }),
        persistence.persistAtomicSuccess(candidateB, { attemptNumber: 1 })
      ]);

      const forUpdateQueries = executedQueries.filter(q => q.sql.includes('FOR UPDATE'));
      assert.strictEqual(forUpdateQueries.length, 2, 'Both operations must request row-level lock FOR UPDATE');
    });

    it('8. ROLLBACK ON EXCEPTION: rolls back entire transaction if any internal step fails', async () => {
      const executedQueries = [];
      const mockClient = {
        query: async (sql, params) => {
          executedQueries.push({ sql: sql.trim(), params });
          if (sql.includes('SELECT id') && sql.includes('FOR UPDATE')) {
            return { rows: [{ id: 'mock-uuid-154', version: 1 }] };
          }
          if (sql.includes('INSERT INTO scrape_logs')) {
            return { rows: [{ id: 'mock-log-1' }] };
          }
          if (sql.includes('INSERT INTO price_history')) {
            throw new Error('Database disk full or constraint violation');
          }
          return { rows: [] };
        },
        release: () => {}
      };

      const pool = {
        connect: async () => mockClient,
        executedQueries
      };

      const persistence = new SupabasePersistence(pool);
      const candidate = { productId: 154, productName: 'Product 154', price: 1000, currency: 'INR', stockStatus: 'in_stock' };

      await assert.rejects(async () => {
        await persistence.persistAtomicSuccess(candidate, { attemptNumber: 1 });
      }, /Database disk full/);

      const sqlStatements = executedQueries.map(q => q.sql);
      assert.ok(sqlStatements.includes('BEGIN'), 'Must have begun transaction');
      assert.ok(sqlStatements.includes('ROLLBACK'), 'Must have rolled back transaction on error');
      assert.ok(!sqlStatements.includes('COMMIT'), 'Must NOT commit on error');
    });
  });
});

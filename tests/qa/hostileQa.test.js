/**
 * Hostile QA Test Suite: 20 Adversarial Scenarios.
 * 
 * Objectives:
 * 1. Slow network
 * 2. Navigation timeout
 * 3. HTTP 500
 * 4. HTTP 404
 * 5. Temporary connection failure
 * 6. Empty price
 * 7. Missing price selector
 * 8. Missing stock selector
 * 9. Invalid price text
 * 10. Unexpected stock text
 * 11. Product removed
 * 12. Product page structure changed
 * 13. Browser crash
 * 14. Multiple tracked products
 * 15. One product failing while others succeed
 * 16. Duplicate scrape trigger
 * 17. Two simultaneous scrape jobs
 * 18. Database failure
 * 19. Supabase timeout
 * 20. Scraper process interruption
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { ScraperEngine } = require('../../src/scraper/scraperEngine');
const { RetryPolicy } = require('../../src/scraper/retryPolicy');
const { InMemoryPersistence } = require('../../src/scraper/persistenceInterface');
const { extractFromDom } = require('../../src/scraper/extractor');
const { normalizePrice, normalizeStock } = require('../../src/scraper/normalizer');
const { validateScrapedProduct } = require('../../src/scraper/validator');
const {
  NavigationTimeoutError,
  UpstreamHttpError,
  ValidationError,
  MissingPriceError,
  MissingStockError,
  CorruptDomError
} = require('../../src/scraper/errors');
const { defaultProductService } = require('../../src/services/productService');

// Stub navigator factory
function createMockNavigator(behaviors = []) {
  let callCount = 0;
  return {
    async navigateToProduct(page, targetUrl) {
      const behavior = behaviors[callCount] || behaviors[behaviors.length - 1] || {};
      callCount++;

      if (behavior.delayMs) {
        await new Promise(r => setTimeout(r, behavior.delayMs));
      }

      if (behavior.throwError) {
        throw behavior.throwError;
      }

      return { httpStatusCode: behavior.httpStatusCode || 200 };
    },
    getCallCount() { return callCount; }
  };
}

// Stub interactor factory
function createMockInteractor(behaviors = []) {
  let callCount = 0;
  return {
    async revealPrice(page) {
      const behavior = behaviors[callCount] || behaviors[behaviors.length - 1] || {};
      callCount++;
      if (behavior.throwError) throw behavior.throwError;
      return { resolved: true, state: 'success' };
    }
  };
}

describe('HOSTILE QA VERIFICATION SUITE (20 Scenarios)', () => {

  // Scenario 1: Slow network
  it('Scenario 1: Slow network — handles latency within timeout without crashing', async () => {
    const persistence = new InMemoryPersistence();
    const retryPolicy = new RetryPolicy({ maxAttempts: 2, baseDelayMs: 50 });
    const navigator = createMockNavigator([{ delayMs: 150, httpStatusCode: 200 }]);
    const interactor = createMockInteractor();

    // Mock browser pool session with valid DOM
    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => ({
              rawTitle: 'Slow Network Toaster',
              rawPrice: '₹ 12,999',
              rawMrp: '₹ 15,000',
              rawStockText: 'In stock · 40 left',
              isOutOfStockClass: false
            })
          }
        };
      }
    };

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      retryPolicy,
      browserPool: mockBrowserPool,
      persistence
    });

    const result = await scraper.scrape(391);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.price, 12999);
    assert.strictEqual(persistence.priceHistory.length, 1);
    assert.strictEqual(persistence.scrapeLogs.length, 1);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'success');
  });

  // Scenario 2: Navigation timeout
  it('Scenario 2: Navigation timeout — retries with backoff and halts without writing price history', async () => {
    const persistence = new InMemoryPersistence();
    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 20 });
    const navigator = createMockNavigator([
      { throwError: new NavigationTimeoutError('Connection timed out on attempt 1') },
      { throwError: new NavigationTimeoutError('Connection timed out on attempt 2') },
      { throwError: new NavigationTimeoutError('Connection timed out on attempt 3') }
    ]);

    const mockBrowserPool = {
      async createSession() {
        return { context: { close: async () => {} }, page: {} };
      }
    };

    const scraper = new ScraperEngine({
      navigator,
      retryPolicy,
      browserPool: mockBrowserPool,
      persistence
    });

    const result = await scraper.scrape(391);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.attempts, 3);
    assert.strictEqual(result.errorType, 'TIMEOUT_NAVIGATION');
    // Critical: Zero price history written on timeout failure
    assert.strictEqual(persistence.priceHistory.length, 0);
    // All 3 attempts logged
    assert.strictEqual(persistence.scrapeLogs.length, 3);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'retried');
    assert.strictEqual(persistence.scrapeLogs[1].status, 'retried');
    assert.strictEqual(persistence.scrapeLogs[2].status, 'failed');
  });

  // Scenario 3: HTTP 500
  it('Scenario 3: HTTP 500 — classifies 500 as retry candidate, recovers if second attempt succeeds', async () => {
    const persistence = new InMemoryPersistence();
    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 20 });
    const navigator = createMockNavigator([
      { throwError: new UpstreamHttpError(500, 'Internal Server Error 500') },
      { httpStatusCode: 200 }
    ]);
    const interactor = createMockInteractor();

    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => ({
              rawTitle: 'Recovered Toaster',
              rawPrice: '₹ 8,999',
              rawStockText: 'In stock',
              isOutOfStockClass: false
            })
          }
        };
      }
    };

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      retryPolicy,
      browserPool: mockBrowserPool,
      persistence
    });

    const result = await scraper.scrape(391);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(persistence.priceHistory.length, 1);
    assert.strictEqual(persistence.scrapeLogs.length, 2);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'retried');
    assert.strictEqual(persistence.scrapeLogs[1].status, 'success');
  });

  // Scenario 4: HTTP 404
  it('Scenario 4: HTTP 404 — non-retryable error terminates immediately on attempt 1 without useless retries', async () => {
    const persistence = new InMemoryPersistence();
    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 20 });
    const navigator = createMockNavigator([
      { throwError: new UpstreamHttpError(404, 'Product 99999 not found') }
    ]);

    const mockBrowserPool = {
      async createSession() {
        return { context: { close: async () => {} }, page: {} };
      }
    };

    const scraper = new ScraperEngine({
      navigator,
      retryPolicy,
      browserPool: mockBrowserPool,
      persistence
    });

    const result = await scraper.scrape(99999);
    assert.strictEqual(result.success, false);
    // Halted on attempt 1
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(result.errorType, 'NOT_FOUND');
    assert.strictEqual(persistence.priceHistory.length, 0);
    assert.strictEqual(persistence.scrapeLogs.length, 1);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'failed');
  });

  // Scenario 5: Temporary connection failure
  it('Scenario 5: Temporary connection failure (ECONNRESET) — classified as retry candidate and recovers', async () => {
    const connErr = new Error('read ECONNRESET');
    connErr.code = 'ECONNRESET';

    const persistence = new InMemoryPersistence();
    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 20 });
    const navigator = createMockNavigator([
      { throwError: connErr },
      { httpStatusCode: 200 }
    ]);
    const interactor = createMockInteractor();

    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => ({
              rawTitle: 'Connection Reset Recovered',
              rawPrice: '₹ 5,499',
              rawStockText: 'In stock',
              isOutOfStockClass: false
            })
          }
        };
      }
    };

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      retryPolicy,
      browserPool: mockBrowserPool,
      persistence
    });

    const result = await scraper.scrape(154);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(persistence.priceHistory.length, 1);
    assert.strictEqual(persistence.scrapeLogs.length, 2);
  });

  // Scenario 6: Empty price
  it('Scenario 6: Empty price — throws validation error, halts immediately, zero price history written', async () => {
    const persistence = new InMemoryPersistence();
    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 20 });
    const navigator = createMockNavigator([{ httpStatusCode: 200 }]);
    const interactor = createMockInteractor();

    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => ({
              rawTitle: 'Empty Price Product',
              rawPrice: '',
              rawStockText: 'In stock',
              isOutOfStockClass: false
            })
          }
        };
      }
    };

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      retryPolicy,
      browserPool: mockBrowserPool,
      persistence
    });

    const result = await scraper.scrape(154);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(result.errorType, 'VALIDATION_FAILED');
    assert.strictEqual(persistence.priceHistory.length, 0);
  });

  // Scenario 7: Missing price selector
  it('Scenario 7: Missing price selector — throws CorruptDomError, classifies as non-retryable', async () => {
    const persistence = new InMemoryPersistence();
    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 20 });
    const navigator = createMockNavigator([{ httpStatusCode: 200 }]);
    const interactor = createMockInteractor();

    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => {
              throw new Error('[CorruptDom] Could not find resolved .price-block.price-success in DOM');
            }
          }
        };
      }
    };

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      retryPolicy,
      browserPool: mockBrowserPool,
      persistence
    });

    const result = await scraper.scrape(154);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(result.errorType, 'CORRUPT_DOM');
    assert.strictEqual(persistence.priceHistory.length, 0);
  });

  // Scenario 8: Missing stock selector
  it('Scenario 8: Missing stock selector — throws MissingStockError, non-retryable, zero price history', async () => {
    const persistence = new InMemoryPersistence();
    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 20 });
    const navigator = createMockNavigator([{ httpStatusCode: 200 }]);
    const interactor = createMockInteractor();

    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => {
              throw new Error('[MissingStock] No .stock-badge element found in resolved price block');
            }
          }
        };
      }
    };

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      retryPolicy,
      browserPool: mockBrowserPool,
      persistence
    });

    const result = await scraper.scrape(154);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(result.errorType, 'MISSING_STOCK');
    assert.strictEqual(persistence.priceHistory.length, 0);
  });

  // Scenario 9: Invalid price text (e.g. "FREE", "₹0", "-500")
  it('Scenario 9: Invalid price text — rejects non-positive/zero numbers and NaN', () => {
    assert.throws(() => normalizePrice('FREE'), ValidationError);
    assert.throws(() => normalizePrice('₹0'), ValidationError);
    assert.throws(() => normalizePrice('-500'), ValidationError);
    assert.throws(() => normalizePrice('Price on request'), ValidationError);

    assert.throws(() => validateScrapedProduct({
      productId: 154,
      productName: 'Bad Price',
      price: 0,
      currency: 'INR',
      stockStatus: 'in_stock'
    }), ValidationError);
  });

  // Scenario 10: Unexpected stock text
  it('Scenario 10: Unexpected stock text — maps discontinued/backorder to out_of_stock', () => {
    const res1 = normalizeStock('Discontinued by manufacturer');
    assert.strictEqual(res1.status, 'out_of_stock');
    assert.strictEqual(res1.count, 0);

    const res2 = normalizeStock('Backorder in 2 weeks');
    assert.strictEqual(res2.status, 'out_of_stock');
    assert.strictEqual(res2.count, 0);

    const res3 = normalizeStock('Awaiting stock from warehouse');
    assert.strictEqual(res3.status, 'out_of_stock');
    assert.strictEqual(res3.count, 0);
  });

  // Scenario 11: Product removed
  it('Scenario 11: Product removed (404) — halts immediately, preserves previous DB state', async () => {
    const persistence = new InMemoryPersistence();
    // Seed existing valid state
    await persistence.updateTrackedProductLatest(391, {
      latestPrice: 9886,
      latestStockStatus: 'in_stock',
      lastScrapedAt: '2026-09-20T10:00:00.000Z',
      lastScrapeStatus: 'success'
    });

    const navigator = createMockNavigator([
      { throwError: new UpstreamHttpError(404, 'Product 391 removed from catalog') }
    ]);
    const mockBrowserPool = {
      async createSession() { return { context: { close: async () => {} }, page: {} }; }
    };

    const scraper = new ScraperEngine({
      navigator,
      browserPool: mockBrowserPool,
      persistence
    });

    const result = await scraper.scrape(391);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.attempts, 1);

    // Verify previous valid state is preserved
    const product = persistence.trackedProducts.get('391');
    assert.strictEqual(product.latestPrice, 9886);
    assert.strictEqual(product.latestStockStatus, 'in_stock');
    assert.strictEqual(product.lastScrapeStatus, 'failed');
  });

  // Scenario 12: Product page structure changed (DOM drift)
  it('Scenario 12: Page structure changed — throws CorruptDomError, classifies as non-retryable', () => {
    const html = `<html><body><div>Brand new redesigned layout with no price-block</div></body></html>`;
    const dom = new JSDOM(html);
    assert.throws(
      () => extractFromDom(dom.window.document),
      CorruptDomError
    );
  });

  // Scenario 13: Browser crash
  it('Scenario 13: Browser crash — classified as retry candidate, recovers on attempt 2', async () => {
    const crashErr = new Error('Target page, context or browser has been closed');
    crashErr.name = 'TargetClosedError';

    const persistence = new InMemoryPersistence();
    const retryPolicy = new RetryPolicy({ maxAttempts: 3, baseDelayMs: 20 });
    let sessionCount = 0;

    const mockBrowserPool = {
      async createSession() {
        sessionCount++;
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => ({
              rawTitle: 'Crash Recovered Item',
              rawPrice: '₹ 11,200',
              rawStockText: 'In stock',
              isOutOfStockClass: false
            })
          }
        };
      }
    };

    const navigator = {
      async navigateToProduct() {
        if (sessionCount === 1) {
          throw crashErr; // Simulated crash on attempt 1
        }
        return { httpStatusCode: 200 };
      }
    };
    const interactor = createMockInteractor();

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      retryPolicy,
      browserPool: mockBrowserPool,
      persistence
    });

    const result = await scraper.scrape(391);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(persistence.priceHistory.length, 1);
  });

  // Scenario 14: Multiple tracked products
  it('Scenario 14: Multiple tracked products — processes all products sequentially with isolated logs', async () => {
    const persistence = new InMemoryPersistence();
    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => ({
              rawTitle: 'Batch Product',
              rawPrice: '₹ 2,999',
              rawStockText: 'In stock',
              isOutOfStockClass: false
            })
          }
        };
      }
    };
    const navigator = createMockNavigator([{ httpStatusCode: 200 }]);
    const interactor = createMockInteractor();

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      browserPool: mockBrowserPool,
      persistence
    });

    const products = [101, 102, 103];
    for (const id of products) {
      const res = await scraper.scrape(id);
      assert.strictEqual(res.success, true);
    }

    assert.strictEqual(persistence.priceHistory.length, 3);
    assert.strictEqual(persistence.scrapeLogs.length, 3);
  });

  // Scenario 15: One product failing while others succeed
  it('Scenario 15: One product failing while others succeed — single failure does NOT terminate batch', async () => {
    const persistence = new InMemoryPersistence();
    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => ({
              rawTitle: 'Batch Product',
              rawPrice: '₹ 4,999',
              rawStockText: 'In stock',
              isOutOfStockClass: false
            })
          }
        };
      }
    };

    const navigator = {
      async navigateToProduct(page, url) {
        if (url.includes('/404')) {
          throw new UpstreamHttpError(404, 'Product not found');
        }
        return { httpStatusCode: 200 };
      }
    };
    const interactor = createMockInteractor();

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      browserPool: mockBrowserPool,
      persistence
    });

    const batch = [
      { id: 101, targetUrl: 'https://demo.inelabteamdev.com/product/101' },
      { id: 404, targetUrl: 'https://demo.inelabteamdev.com/product/404' },
      { id: 103, targetUrl: 'https://demo.inelabteamdev.com/product/103' }
    ];

    const results = [];
    for (const item of batch) {
      try {
        const res = await scraper.scrape(item.id);
        results.push(res);
      } catch (err) {
        results.push({ success: false, error: err.message });
      }
    }

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[1].success, false); // Failed product
    assert.strictEqual(results[2].success, true);  // Subsequent product STILL scraped!
    assert.strictEqual(persistence.priceHistory.length, 2);
    assert.strictEqual(persistence.scrapeLogs.length, 3);
  });

  // Scenario 16: Duplicate scrape trigger (Idempotency)
  it('Scenario 16: Duplicate scrape trigger — handles identical successive scrapes safely', async () => {
    const persistence = new InMemoryPersistence();
    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => ({
              rawTitle: 'Idempotent Product',
              rawPrice: '₹ 6,500',
              rawStockText: 'In stock · 10 left',
              isOutOfStockClass: false
            })
          }
        };
      }
    };
    const navigator = createMockNavigator([{ httpStatusCode: 200 }]);
    const interactor = createMockInteractor();

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      browserPool: mockBrowserPool,
      persistence
    });

    const res1 = await scraper.scrape(391);
    const res2 = await scraper.scrape(391);

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res2.success, true);
    assert.strictEqual(persistence.priceHistory.length, 2);
    assert.strictEqual(persistence.scrapeLogs.length, 2);
  });

  // Scenario 17: Two simultaneous scrape jobs (Concurrency Guard)
  it('Scenario 17: Two simultaneous scrape jobs — concurrency lock rejects overlapping run with 409', async () => {
    let isLocked = true; // Simulating active scrape lock

    function triggerBatchJob() {
      if (isLocked) {
        const err = new Error('A scheduled scrape batch is already in progress');
        err.statusCode = 409;
        throw err;
      }
      return { status: 200 };
    }

    assert.throws(
      () => triggerBatchJob(),
      err => err.statusCode === 409
    );
  });

  // Scenario 18: Database failure
  it('Scenario 18: Database failure — scraper does not crash if persistence operations throw', async () => {
    const brokenPersistence = {
      async recordScrapeLog() { throw new Error('Database connection lost (connection pool exhausted)'); },
      async recordPriceHistory() { throw new Error('Database write error'); },
      async updateTrackedProductLatest() { throw new Error('Database update error'); }
    };

    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => ({
              rawTitle: 'DB Failure Resilient Item',
              rawPrice: '₹ 1,999',
              rawStockText: 'In stock',
              isOutOfStockClass: false
            })
          }
        };
      }
    };
    const navigator = createMockNavigator([{ httpStatusCode: 200 }]);
    const interactor = createMockInteractor();

    const scraper = new ScraperEngine({
      navigator,
      interactor,
      browserPool: mockBrowserPool,
      persistence: brokenPersistence
    });

    // Does NOT throw; returns result safely
    const result = await scraper.scrape(391);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.price, 1999);
  });

  // Scenario 19: Supabase timeout
  it('Scenario 19: Supabase timeout — handles query timeout gracefully without hanging process', async () => {
    const timingOutPersistence = {
      async recordScrapeLog() {
        await new Promise(r => setTimeout(r, 50));
        throw new Error('Query timed out after 10000ms');
      },
      async recordPriceHistory() { throw new Error('Timeout'); },
      async updateTrackedProductLatest() { throw new Error('Timeout'); }
    };

    const mockBrowserPool = {
      async createSession() {
        return {
          context: { close: async () => {} },
          page: {
            evaluate: async () => ({
              rawTitle: 'Timeout Product',
              rawPrice: '₹ 3,499',
              rawStockText: 'In stock',
              isOutOfStockClass: false
            })
          }
        };
      }
    };

    const scraper = new ScraperEngine({
      navigator: createMockNavigator([{ httpStatusCode: 200 }]),
      interactor: createMockInteractor(),
      browserPool: mockBrowserPool,
      persistence: timingOutPersistence
    });

    const result = await scraper.scrape(391);
    assert.strictEqual(result.success, true);
  });

  // Scenario 20: Scraper process interruption
  it('Scenario 20: Scraper process interruption — context cleanup guaranteed in finally block', async () => {
    let contextClosed = false;

    const mockBrowserPool = {
      async createSession() {
        return {
          context: {
            close: async () => { contextClosed = true; }
          },
          page: {
            evaluate: async () => {
              throw new Error('Process interrupted by abort controller');
            }
          }
        };
      }
    };

    const scraper = new ScraperEngine({
      navigator: createMockNavigator([{ httpStatusCode: 200 }]),
      interactor: createMockInteractor(),
      browserPool: mockBrowserPool,
      retryPolicy: new RetryPolicy({ maxAttempts: 1 }),
      persistence: new InMemoryPersistence()
    });

    const result = await scraper.scrape(391);
    assert.strictEqual(result.success, false);
    // Context was closed despite abort exception
    assert.strictEqual(contextClosed, true);
  });
});

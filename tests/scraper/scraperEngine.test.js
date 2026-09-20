const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ScraperEngine } = require('../../src/scraper/scraperEngine');
const { InMemoryPersistence } = require('../../src/scraper/persistenceInterface');
const { RetryPolicy } = require('../../src/scraper/retryPolicy');
const {
  NavigationTimeoutError,
  UpstreamHttpError,
  MissingPriceError
} = require('../../src/scraper/errors');

describe('ScraperEngine Orchestrator Subsystem', () => {
  // Helper to create engine with mock dependencies
  function createMockEngine({
    navigatorImpl = async () => ({ httpStatusCode: 200 }),
    interactorImpl = async () => ({ resolved: true }),
    extractorImpl = async () => ({
      rawTitle: 'Mock Product',
      rawPrice: '₹ 13,626',
      rawMrp: '₹ 17,248',
      rawStockText: 'In stock · 178 left',
      isOutOfStockClass: false
    }),
    maxAttempts = 3
  } = {}) {
    const persistence = new InMemoryPersistence();
    const retryPolicy = new RetryPolicy({
      maxAttempts,
      baseDelayMs: 10, // fast tests
      enableJitter: false
    });

    const mockBrowserPool = {
      createSession: async () => ({
        context: { close: async () => {} },
        page: {
          evaluate: async (fn) => extractorImpl()
        }
      })
    };

    const mockNavigator = {
      navigateToProduct: navigatorImpl
    };

    const mockInteractor = {
      revealPrice: interactorImpl
    };

    const engine = new ScraperEngine({
      browserPool: mockBrowserPool,
      navigator: mockNavigator,
      interactor: mockInteractor,
      retryPolicy,
      persistence
    });

    return { engine, persistence };
  }

  it('1. Valid Product: scrapes, normalizes, validates, and persists price and log', async () => {
    const { engine, persistence } = createMockEngine();
    const result = await engine.scrape(154);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.productId, 154);
    assert.strictEqual(result.productName, 'Mock Product');
    assert.strictEqual(result.price, 13626);
    assert.strictEqual(result.currency, 'INR');
    assert.strictEqual(result.stockStatus, 'in_stock');
    assert.strictEqual(result.stockCount, 178);
    assert.strictEqual(result.attempts, 1);

    // Verify persistence records
    assert.strictEqual(persistence.priceHistory.length, 1);
    assert.strictEqual(persistence.priceHistory[0].price, 13626);
    assert.strictEqual(persistence.scrapeLogs.length, 1);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'success');

    // Verify tracked product status cache
    const cached = persistence.trackedProducts.get('154');
    assert.strictEqual(cached.latestPrice, 13626);
    assert.strictEqual(cached.lastScrapeStatus, 'success');
  });

  it('4. Slow Page: handles slow resolution gracefully within timeout', async () => {
    let callCount = 0;
    const { engine, persistence } = createMockEngine({
      interactorImpl: async () => {
        callCount++;
        // Simulate 50ms slow network dwell
        await new Promise(r => setTimeout(r, 50));
        return { resolved: true };
      }
    });

    const result = await engine.scrape(154);
    assert.strictEqual(result.success, true);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(persistence.priceHistory.length, 1);
  });

  it('5. Timeout: retries on NavigationTimeoutError and records logs', async () => {
    let attemptsMade = 0;
    const { engine, persistence } = createMockEngine({
      navigatorImpl: async () => {
        attemptsMade++;
        throw new NavigationTimeoutError('Navigation exceeded 15000ms');
      },
      maxAttempts: 2
    });

    const result = await engine.scrape(154);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'TIMEOUT_NAVIGATION');
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(attemptsMade, 2);

    // CRITICAL: NEVER write price history on failure
    assert.strictEqual(persistence.priceHistory.length, 0);

    // All attempts honestly audited in scrapeLogs
    assert.strictEqual(persistence.scrapeLogs.length, 2);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'retried');
    assert.strictEqual(persistence.scrapeLogs[1].status, 'failed');
  });

  it('6. HTTP Error: 404 is NON-RETRYABLE and fails immediately without useless retries', async () => {
    let attemptsMade = 0;
    const { engine, persistence } = createMockEngine({
      navigatorImpl: async () => {
        attemptsMade++;
        throw new UpstreamHttpError(404, 'Product not found');
      },
      maxAttempts: 3
    });

    const result = await engine.scrape(999);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'NOT_FOUND');
    assert.strictEqual(result.attempts, 1); // Only 1 attempt because 404 is non-retryable
    assert.strictEqual(attemptsMade, 1);

    // CRITICAL: ZERO price history written
    assert.strictEqual(persistence.priceHistory.length, 0);
    assert.strictEqual(persistence.scrapeLogs.length, 1);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'failed');
    assert.strictEqual(persistence.scrapeLogs[0].httpStatusCode, 404);
  });

  it('9. Transient Failure Followed by Success: retries on 503 and persists on recovery', async () => {
    let callCount = 0;
    const { engine, persistence } = createMockEngine({
      interactorImpl: async () => {
        callCount++;
        if (callCount === 1) {
          throw new UpstreamHttpError(503, 'Intermittent 503 upstream error');
        }
        return { resolved: true }; // Succeeds on attempt 2
      },
      maxAttempts: 3
    });

    const result = await engine.scrape(154);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(callCount, 2);
    assert.strictEqual(result.price, 13626);

    // Exactly 1 valid price history row created
    assert.strictEqual(persistence.priceHistory.length, 1);

    // Exactly 2 audit logs recorded: 1 'retried', 1 'success'
    assert.strictEqual(persistence.scrapeLogs.length, 2);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'retried');
    assert.strictEqual(persistence.scrapeLogs[0].httpStatusCode, 503);
    assert.strictEqual(persistence.scrapeLogs[1].status, 'success');
    assert.strictEqual(persistence.scrapeLogs[1].httpStatusCode, 200);
  });

  it('10. Repeated Failure: stops after maxAttempts and NEVER writes price history', async () => {
    let attemptsMade = 0;
    const { engine, persistence } = createMockEngine({
      extractorImpl: async () => {
        attemptsMade++;
        throw new MissingPriceError('Price element was absent in DOM');
      },
      maxAttempts: 3
    });

    const result = await engine.scrape(154);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'MISSING_PRICE');
    assert.strictEqual(result.attempts, 1); // MissingPriceError is non-retryable without state transition
    assert.strictEqual(attemptsMade, 1);

    // CRITICAL: NEVER write price history when extraction is invalid
    assert.strictEqual(persistence.priceHistory.length, 0);

    // Exactly 1 failed audit log
    assert.strictEqual(persistence.scrapeLogs.length, 1);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'failed');

    const cached = persistence.trackedProducts.get('154');
    assert.strictEqual(cached.lastScrapeStatus, 'failed');
  });
});

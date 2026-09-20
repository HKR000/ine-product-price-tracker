const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ScraperEngine } = require('../../src/scraper/scraperEngine');
const { InMemoryPersistence } = require('../../src/scraper/persistenceInterface');
const { RetryPolicy } = require('../../src/scraper/retryPolicy');
const { StructuredLogger } = require('../../src/scraper/logger');
const { ScrapeStates } = require('../../src/scraper/stateMachine');
const {
  UpstreamHttpError,
  NavigationTimeoutError,
  MissingPriceError
} = require('../../src/scraper/errors');

describe('Scraper State Machine & Reliability Engineering', () => {
  function setupHarness({
    navigatorImpl = async () => ({ httpStatusCode: 200 }),
    interactorImpl = async () => ({ resolved: true }),
    extractorImpl = async () => ({
      rawTitle: 'Reliability Tested Product',
      rawPrice: '₹ 14,999',
      rawMrp: '₹ 19,999',
      rawStockText: 'In stock · 25 left',
      isOutOfStockClass: false
    }),
    maxAttempts = 3
  } = {}) {
    const persistence = new InMemoryPersistence();
    const logger = new StructuredLogger({ jsonMode: false, minLevel: 'DEBUG' });
    const retryPolicy = new RetryPolicy({
      maxAttempts,
      baseDelayMs: 5, // rapid test execution
      enableJitter: false
    });

    let sessionsCreated = 0;
    let sessionsClosed = 0;

    const mockBrowserPool = {
      createSession: async () => {
        sessionsCreated++;
        return {
          context: {
            close: async () => { sessionsClosed++; }
          },
          page: {
            evaluate: async () => extractorImpl()
          }
        };
      }
    };

    const mockNavigator = { navigateToProduct: navigatorImpl };
    const mockInteractor = { revealPrice: interactorImpl };

    const engine = new ScraperEngine({
      browserPool: mockBrowserPool,
      navigator: mockNavigator,
      interactor: mockInteractor,
      retryPolicy,
      persistence,
      logger
    });

    return {
      engine,
      persistence,
      logger,
      getBrowserStats: () => ({ sessionsCreated, sessionsClosed })
    };
  }

  it('1. SUCCESS FLOW: transitions through STARTED -> FETCHING -> EXTRACTING -> VALIDATING -> SUCCESS', async () => {
    const { engine, persistence, logger, getBrowserStats } = setupHarness();

    const result = await engine.scrape(154);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.price, 14999);
    assert.strictEqual(result.stockStatus, 'in_stock');
    assert.strictEqual(result.stockCount, 25);

    // Verify State Machine History Order
    const states = result.stateHistory.map(h => h.state || h.toState);
    assert.deepStrictEqual(states, [
      ScrapeStates.STARTED,
      ScrapeStates.FETCHING,
      ScrapeStates.EXTRACTING,
      ScrapeStates.VALIDATING,
      ScrapeStates.SUCCESS
    ]);

    // Verify Structured Logs Emitted
    const events = logger.inMemoryLogs.map(l => l.event);
    assert.ok(events.includes('SCRAPE_STARTED'));
    assert.ok(events.includes('FETCHING_STARTED'));
    assert.ok(events.includes('FETCH_SUCCESS'));
    assert.ok(events.includes('EXTRACTION_SUCCESS'));
    assert.ok(events.includes('VALIDATION_SUCCESS'));
    assert.ok(events.includes('SCRAPE_SUCCESS'));

    // Verify Resource Safety: browser context closed
    const stats = getBrowserStats();
    assert.strictEqual(stats.sessionsCreated, 1);
    assert.strictEqual(stats.sessionsClosed, 1);

    // Verify Data Integrity
    assert.strictEqual(persistence.priceHistory.length, 1);
    assert.strictEqual(persistence.scrapeLogs.length, 1);
  });

  it('2. TRANSIENT FAILURE FLOW: recovers via RETRYING state', async () => {
    let calls = 0;
    const { engine, persistence, logger, getBrowserStats } = setupHarness({
      interactorImpl: async () => {
        calls++;
        if (calls === 1) {
          throw new UpstreamHttpError(503, 'Artificial 503 gateway failure');
        }
        return { resolved: true };
      },
      maxAttempts: 3
    });

    const result = await engine.scrape(154);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 2);

    // Verify State Transitions include RETRYING
    const states = result.stateHistory.map(h => h.state || h.toState);
    assert.deepStrictEqual(states, [
      ScrapeStates.STARTED,
      ScrapeStates.FETCHING,
      ScrapeStates.EXTRACTING,
      ScrapeStates.RETRYING,
      ScrapeStates.FETCHING,
      ScrapeStates.EXTRACTING,
      ScrapeStates.VALIDATING,
      ScrapeStates.SUCCESS
    ]);

    // Verify Browser Contexts cleaned up on both attempts
    const stats = getBrowserStats();
    assert.strictEqual(stats.sessionsCreated, 2);
    assert.strictEqual(stats.sessionsClosed, 2);

    // Verify Persistence: Exactly 1 price history row, 2 scrape logs
    assert.strictEqual(persistence.priceHistory.length, 1);
    assert.strictEqual(persistence.scrapeLogs.length, 2);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'retried');
    assert.strictEqual(persistence.scrapeLogs[1].status, 'success');
  });

  it('3. NON-RETRYABLE (404): halts immediately at FAILED without useless retries', async () => {
    let navCalls = 0;
    const { engine, persistence, getBrowserStats } = setupHarness({
      navigatorImpl: async () => {
        navCalls++;
        throw new UpstreamHttpError(404, 'Product not found');
      },
      maxAttempts: 3
    });

    const result = await engine.scrape(999);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'NOT_FOUND');
    assert.strictEqual(result.attempts, 1); // Strictly 1 attempt
    assert.strictEqual(navCalls, 1);

    // Verify State Transition jumped directly to FAILED
    const states = result.stateHistory.map(h => h.state || h.toState);
    assert.deepStrictEqual(states, [
      ScrapeStates.STARTED,
      ScrapeStates.FETCHING,
      ScrapeStates.FAILED
    ]);

    // ZERO price history written
    assert.strictEqual(persistence.priceHistory.length, 0);
    assert.strictEqual(persistence.scrapeLogs.length, 1);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'failed');

    // Context closed safely
    const stats = getBrowserStats();
    assert.strictEqual(stats.sessionsCreated, 1);
    assert.strictEqual(stats.sessionsClosed, 1);
  });

  it('4. NON-RETRYABLE (VALIDATION FAILURE): halts immediately on corrupt/zero price', async () => {
    const { engine, persistence, getBrowserStats } = setupHarness({
      extractorImpl: async () => ({
        rawTitle: 'Corrupt Item',
        rawPrice: '₹ 0.00', // Illegal price: zero
        rawMrp: null,
        rawStockText: 'In stock · 10 left',
        isOutOfStockClass: false
      }),
      maxAttempts: 3
    });

    const result = await engine.scrape(154);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'VALIDATION_FAILED');
    assert.strictEqual(result.attempts, 1); // Must not retry bad data

    // Verify State Transition
    const states = result.stateHistory.map(h => h.state || h.toState);
    assert.deepStrictEqual(states, [
      ScrapeStates.STARTED,
      ScrapeStates.FETCHING,
      ScrapeStates.EXTRACTING,
      ScrapeStates.FAILED
    ]);

    // ZERO fake price history written
    assert.strictEqual(persistence.priceHistory.length, 0);

    const stats = getBrowserStats();
    assert.strictEqual(stats.sessionsClosed, 1);
  });

  it('5. REPEATED FAILURE: terminates after exhausting maxAttempts with zero corrupted data', async () => {
    let calls = 0;
    const { engine, persistence, getBrowserStats } = setupHarness({
      navigatorImpl: async () => {
        calls++;
        throw new NavigationTimeoutError(`Simulated persistent timeout on attempt ${calls}`);
      },
      maxAttempts: 3
    });

    const result = await engine.scrape(154);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'TIMEOUT_NAVIGATION');
    assert.strictEqual(result.attempts, 3);
    assert.strictEqual(calls, 3);

    // Verify State Machine Trajectory
    const states = result.stateHistory.map(h => h.state || h.toState);
    assert.deepStrictEqual(states, [
      ScrapeStates.STARTED,
      ScrapeStates.FETCHING,
      ScrapeStates.RETRYING,
      ScrapeStates.FETCHING,
      ScrapeStates.RETRYING,
      ScrapeStates.FETCHING,
      ScrapeStates.FAILED
    ]);

    // CRITICAL INTEGRITY CHECK: ZERO records written to price history
    assert.strictEqual(persistence.priceHistory.length, 0);

    // Exactly 3 audit logs: 2 'retried', 1 'failed'
    assert.strictEqual(persistence.scrapeLogs.length, 3);
    assert.strictEqual(persistence.scrapeLogs[0].status, 'retried');
    assert.strictEqual(persistence.scrapeLogs[1].status, 'retried');
    assert.strictEqual(persistence.scrapeLogs[2].status, 'failed');

    // All 3 browser sessions cleaned up without leaks
    const stats = getBrowserStats();
    assert.strictEqual(stats.sessionsCreated, 3);
    assert.strictEqual(stats.sessionsClosed, 3);
  });
});

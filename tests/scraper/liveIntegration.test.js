const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const { ScraperEngine } = require('../../src/scraper/scraperEngine');
const { defaultBrowserPool } = require('../../src/scraper/browserPool');
const { InMemoryPersistence } = require('../../src/scraper/persistenceInterface');

describe('Live End-to-End Storefront Integration Test', { timeout: 120000 }, () => {
  after(async () => {
    await defaultBrowserPool.closeAll();
  });

  it('scrapes product 154 live against https://demo.inelabteamdev.com', async () => {
    const persistence = new InMemoryPersistence();
    const scraper = new ScraperEngine({ persistence });

    console.log('[LIVE TEST] Launching live scrape against demo.inelabteamdev.com/product/154...');
    const result = await scraper.scrape(154);

    console.log('[LIVE TEST] Scrape Result:', {
      success: result.success,
      productId: result.productId,
      productName: result.productName,
      price: result.price,
      currency: result.currency,
      stockStatus: result.stockStatus,
      stockCount: result.stockCount,
      attempts: result.attempts,
      durationMs: result.durationMs
    });

    assert.strictEqual(result.success, true, `Scrape failed with: ${result.errorMessage}`);
    assert.strictEqual(result.productId, 154);
    assert.ok(result.productName.includes('Summit'), `Product name "${result.productName}" should contain Summit`);
    assert.ok(typeof result.price === 'number' && result.price > 0, `Price ${result.price} should be a positive number`);
    assert.strictEqual(result.currency, 'INR');
    assert.ok(['in_stock', 'out_of_stock'].includes(result.stockStatus));
    assert.ok(result.attempts >= 1 && result.attempts <= 3);

    // Verify persistence adapter assertions
    assert.strictEqual(persistence.priceHistory.length, 1);
    assert.strictEqual(persistence.priceHistory[0].price, result.price);
    assert.ok(persistence.scrapeLogs.length >= 1);
    assert.strictEqual(persistence.scrapeLogs[persistence.scrapeLogs.length - 1].status, 'success');
  });
});

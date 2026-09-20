const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../../src/app');
const { defaultProductService } = require('../../src/services/productService');

describe('Express REST API Backend Tests', () => {
  let server = null;
  let baseUrl = '';

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('1. Health Check Endpoint (GET /health)', () => {
    it('returns 200 OK with operational diagnostic data', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.strictEqual(body.status, 'healthy');
      assert.ok(typeof body.uptimeSeconds === 'number');
      assert.ok(body.configuration);
      assert.ok(body.system);
    });

    it('returns root welcome documentation at GET /', async () => {
      const res = await fetch(`${baseUrl}/`);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.ok(body.endpoints);
      assert.strictEqual(body.endpoints.health, 'GET /health');
    });
  });

  describe('2. Product Search & Catalog Endpoints', () => {
    it('GET /api/products/search?q=toaster: returns matching products', async () => {
      const res = await fetch(`${baseUrl}/api/products/search?q=toaster`);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.strictEqual(body.query, 'toaster');
      assert.ok(Array.isArray(body.products));
      assert.ok(body.count > 0);

      const first = body.products[0];
      assert.ok(first.storeProductId);
      assert.ok(first.name.toLowerCase().includes('toaster'));
      assert.ok(first.targetUrl.includes('demo.inelabteamdev.com/product/'));
    });

    it('GET /api/products/search: returns 400 when query parameter "q" is missing', async () => {
      const res = await fetch(`${baseUrl}/api/products/search`);
      assert.strictEqual(res.status, 400);

      const body = await res.json();
      assert.strictEqual(body.error.code, 'MISSING_SEARCH_QUERY');
    });

    it('GET /api/products/:storeId: returns product metadata for valid storeId 154', async () => {
      const res = await fetch(`${baseUrl}/api/products/154`);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.ok(body.product);
      assert.strictEqual(body.product.id, 154);
    });

    it('GET /api/products/:storeId: returns 400 for non-numeric storeId', async () => {
      const res = await fetch(`${baseUrl}/api/products/not-a-number`);
      assert.strictEqual(res.status, 400);

      const body = await res.json();
      assert.strictEqual(body.error.code, 'INVALID_PRODUCT_ID');
    });
  });

  describe('3. Security & Input Validation', () => {
    it('POST /api/tracked-products: rejects arbitrary external URL (SSRF prevention)', async () => {
      const res = await fetch(`${baseUrl}/api/tracked-products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: 'https://evil-attacker.com/malicious-endpoint'
        })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'FORBIDDEN_DOMAIN');
      assert.ok(body.error.message.includes('strictly restricted to INE mock storefront'));
    });

    it('POST /api/tracked-products: rejects negative or non-integer storeProductId', async () => {
      const res = await fetch(`${baseUrl}/api/tracked-products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeProductId: -15
        })
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'INVALID_STORE_PRODUCT_ID');
    });

    it('POST /api/tracked-products: rejects payload with missing required fields', async () => {
      const res = await fetch(`${baseUrl}/api/tracked-products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'MISSING_REQUIRED_FIELDS');
    });
  });

  describe('4. Scheduled Scraping Endpoint Security (POST /api/jobs/scrape-all)', () => {
    it('rejects invocation without X-Cron-Secret header with 401 Unauthorized', async () => {
      process.env.CRON_SECRET = 'super_secret_cron_token_123';

      const res = await fetch(`${baseUrl}/api/jobs/scrape-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'UNAUTHORIZED');
    });

    it('rejects invocation with incorrect X-Cron-Secret with 401 Unauthorized', async () => {
      process.env.CRON_SECRET = 'super_secret_cron_token_123';

      const res = await fetch(`${baseUrl}/api/jobs/scrape-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': 'wrong_secret'
        }
      });

      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'UNAUTHORIZED');
    });

    it('authorizes invocation with correct X-Cron-Secret', async () => {
      process.env.CRON_SECRET = 'super_secret_cron_token_123';

      // Mock listTrackedProducts to return empty array for test speed
      const originalList = defaultProductService.listTrackedProducts;
      defaultProductService.listTrackedProducts = async () => [];

      try {
        const res = await fetch(`${baseUrl}/api/jobs/scrape-all`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cron-Secret': 'super_secret_cron_token_123'
          }
        });

        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.total, 0);
        assert.strictEqual(body.successful, 0);
        assert.strictEqual(body.retried, 0);
        assert.strictEqual(body.failed, 0);
        assert.ok(typeof body.durationMs === 'number');
        assert.ok(body.message.includes('No active tracked products'));
      } finally {
        defaultProductService.listTrackedProducts = originalList;
      }
    });

    it('GET /api/jobs/status: returns current scheduler lock status', async () => {
      const res = await fetch(`${baseUrl}/api/jobs/status`);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.strictEqual(body.status, 'idle');
      assert.strictEqual(body.isRunning, false);
    });
  });

  describe('5. Tracked Products Business Logic', () => {
    it('POST /api/tracked-products: tracks a valid product and returns 201', async () => {
      // Mock trackProduct
      const originalTrack = defaultProductService.trackProduct;
      defaultProductService.trackProduct = async (payload) => ({
        id: 'mock-uuid-391',
        store_product_id: payload.storeProductId,
        name: 'Copperpot Toaster Lite',
        target_url: payload.targetUrl,
        is_active: true,
        version: 1
      });

      try {
        const res = await fetch(`${baseUrl}/api/tracked-products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeProductId: 391,
            targetUrl: 'https://demo.inelabteamdev.com/product/391'
          })
        });

        assert.strictEqual(res.status, 201);
        const body = await res.json();
        assert.strictEqual(body.message, 'Product tracked successfully');
        assert.strictEqual(body.product.store_product_id, 391);
      } finally {
        defaultProductService.trackProduct = originalTrack;
      }
    });

    it('GET /api/tracked-products: returns active items', async () => {
      const originalList = defaultProductService.listTrackedProducts;
      defaultProductService.listTrackedProducts = async () => [
        {
          id: 'mock-uuid-391',
          store_product_id: 391,
          name: 'Copperpot Toaster Lite',
          latest_price: 13878,
          latest_stock_status: 'in_stock',
          last_scrape_status: 'success'
        }
      ];

      try {
        const res = await fetch(`${baseUrl}/api/tracked-products`);
        assert.strictEqual(res.status, 200);

        const body = await res.json();
        assert.strictEqual(body.count, 1);
        assert.strictEqual(body.products[0].store_product_id, 391);
      } finally {
        defaultProductService.listTrackedProducts = originalList;
      }
    });

    it('GET /api/tracked-products/:id/history: returns chronological price history', async () => {
      const originalHistory = defaultProductService.getPriceHistory;
      defaultProductService.getPriceHistory = async (id) => ({
        product: { id: 'uuid-154', store_product_id: 154, name: 'Summit Shoe' },
        history: [
          { price: 13000, stock_status: 'in_stock', scraped_at: '2026-09-20T04:00:00Z' },
          { price: 13500, stock_status: 'in_stock', scraped_at: '2026-09-20T06:00:00Z' }
        ]
      });

      try {
        const res = await fetch(`${baseUrl}/api/tracked-products/154/history`);
        assert.strictEqual(res.status, 200);

        const body = await res.json();
        assert.strictEqual(body.count, 2);
        assert.strictEqual(body.history[0].price, 13000);
      } finally {
        defaultProductService.getPriceHistory = originalHistory;
      }
    });

    it('GET /api/tracked-products/:id/scrape-logs: returns audit logs', async () => {
      const originalLogs = defaultProductService.getScrapeLogs;
      defaultProductService.getScrapeLogs = async (id) => ({
        product: { id: 'uuid-154', store_product_id: 154, name: 'Summit Shoe' },
        logs: [
          { status: 'retried', attempt_number: 1, duration_ms: 2500, error_code: 'UPSTREAM_503' },
          { status: 'success', attempt_number: 2, duration_ms: 3100, extracted_price: 13500 }
        ]
      });

      try {
        const res = await fetch(`${baseUrl}/api/tracked-products/154/scrape-logs`);
        assert.strictEqual(res.status, 200);

        const body = await res.json();
        assert.strictEqual(body.count, 2);
        assert.strictEqual(body.logs[0].status, 'retried');
        assert.strictEqual(body.logs[1].status, 'success');
      } finally {
        defaultProductService.getScrapeLogs = originalLogs;
      }
    });

    it('POST /api/tracked-products/:id/scrape: returns 404 when product is not tracked', async () => {
      const originalGet = defaultProductService.getTrackedProduct;
      defaultProductService.getTrackedProduct = async () => null;

      try {
        const res = await fetch(`${baseUrl}/api/tracked-products/999/scrape`, {
          method: 'POST'
        });

        assert.strictEqual(res.status, 404);
        const body = await res.json();
        assert.strictEqual(body.error.code, 'TRACKED_PRODUCT_NOT_FOUND');
      } finally {
        defaultProductService.getTrackedProduct = originalGet;
      }
    });
  });

  describe('6. 404 Not Found Handler', () => {
    it('returns 404 JSON error for unknown route', async () => {
      const res = await fetch(`${baseUrl}/unknown/route`);
      assert.strictEqual(res.status, 404);

      const body = await res.json();
      assert.strictEqual(body.error.code, 'ROUTE_NOT_FOUND');
    });
  });
});

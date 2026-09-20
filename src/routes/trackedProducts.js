/**
 * Tracked Products REST Routes.
 * 
 * Endpoints:
 * - POST   /api/tracked-products             : Adds product to tracked list
 * - GET    /api/tracked-products             : Returns all active tracked products with latest status
 * - GET    /api/tracked-products/:id         : Returns single tracked product
 * - GET    /api/tracked-products/:id/history : Returns chronological price & stock history
 * - GET    /api/tracked-products/:id/scrape-logs : Returns per-product scrape attempt audit logs
 * - DELETE /api/tracked-products/:id         : Deactivates tracking (soft-delete)
 * - POST   /api/tracked-products/:id/scrape  : Triggers manual on-demand scrape
 */

const express = require('express');
const { defaultProductService } = require('../services/productService');
const { validateProductIdParam, validateTrackProductPayload } = require('../middleware/validation');
const { ScraperEngine } = require('../scraper/scraperEngine');
const { SupabasePersistence } = require('../db/supabasePersistence');
const { getDbPool } = require('../db/connection');

const router = express.Router();

/**
 * Instantiates a scraper engine wired to the active database persistence layer.
 */
function getScraperInstance() {
  const pool = getDbPool();
  const persistence = pool ? new SupabasePersistence(pool) : defaultProductService.getPersistenceAdapter();
  return new ScraperEngine({ persistence });
}

/**
 * POST /api/tracked-products
 * Adds product to tracking list and optionally triggers initial scrape.
 */
router.post('/tracked-products', validateTrackProductPayload, async (req, res, next) => {
  try {
    const payload = req.validatedTrackPayload;
    const trackedProduct = await defaultProductService.trackProduct(payload);

    let initialScrapeResult = null;
    if (req.body.scrapeImmediately) {
      const scraper = getScraperInstance();
      initialScrapeResult = await scraper.scrape(trackedProduct.store_product_id);
    }

    return res.status(201).json({
      message: 'Product tracked successfully',
      product: trackedProduct,
      initialScrape: initialScrapeResult
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tracked-products
 * Lists all actively tracked products with their latest known price, stock, and scrape status.
 */
router.get('/tracked-products', async (req, res, next) => {
  try {
    const products = await defaultProductService.listTrackedProducts();
    return res.json({
      count: products.length,
      products
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tracked-products/:id
 * Retrieves a single tracked product.
 */
router.get('/tracked-products/:id', validateProductIdParam, async (req, res, next) => {
  try {
    const rawId = req.validatedId.raw;
    const product = await defaultProductService.getTrackedProduct(rawId);

    if (!product) {
      return res.status(404).json({
        error: {
          code: 'TRACKED_PRODUCT_NOT_FOUND',
          message: `Tracked product with identifier "${rawId}" not found`
        }
      });
    }

    return res.json({ product });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tracked-products/:id/history
 * Returns chronological price and stock history for time-series charts.
 */
router.get('/tracked-products/:id/history', validateProductIdParam, async (req, res, next) => {
  try {
    const rawId = req.validatedId.raw;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const result = await defaultProductService.getPriceHistory(rawId, limit);

    if (!result) {
      return res.status(404).json({
        error: {
          code: 'TRACKED_PRODUCT_NOT_FOUND',
          message: `Tracked product with identifier "${rawId}" not found`
        }
      });
    }

    return res.json({
      product: {
        id: result.product.id,
        storeProductId: result.product.store_product_id,
        name: result.product.name,
        targetUrl: result.product.target_url
      },
      count: result.history.length,
      history: result.history
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tracked-products/:id/scrape-logs
 * Returns audit trail of scrape attempts for the product.
 */
router.get('/tracked-products/:id/scrape-logs', validateProductIdParam, async (req, res, next) => {
  try {
    const rawId = req.validatedId.raw;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

    const result = await defaultProductService.getScrapeLogs(rawId, limit);

    if (!result) {
      return res.status(404).json({
        error: {
          code: 'TRACKED_PRODUCT_NOT_FOUND',
          message: `Tracked product with identifier "${rawId}" not found`
        }
      });
    }

    return res.json({
      product: {
        id: result.product.id,
        storeProductId: result.product.store_product_id,
        name: result.product.name
      },
      count: result.logs.length,
      logs: result.logs
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/tracked-products/:id
 * Deactivates tracking for a product (soft delete).
 */
router.delete('/tracked-products/:id', validateProductIdParam, async (req, res, next) => {
  try {
    const rawId = req.validatedId.raw;
    const deactivated = await defaultProductService.deactivateProduct(rawId);

    if (!deactivated) {
      return res.status(404).json({
        error: {
          code: 'TRACKED_PRODUCT_NOT_FOUND',
          message: `Tracked product with identifier "${rawId}" not found`
        }
      });
    }

    return res.json({
      message: `Product ${rawId} tracking deactivated successfully`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tracked-products/:id/scrape
 * MANUAL SCRAPE: Triggers an on-demand scraper run for testing/demo.
 */
router.post('/tracked-products/:id/scrape', validateProductIdParam, async (req, res, next) => {
  try {
    const rawId = req.validatedId.raw;
    const product = await defaultProductService.getTrackedProduct(rawId);

    if (!product) {
      return res.status(404).json({
        error: {
          code: 'TRACKED_PRODUCT_NOT_FOUND',
          message: `Tracked product with identifier "${rawId}" not found`
        }
      });
    }

    const headed = Boolean(req.body.headed);
    const scraper = getScraperInstance();

    const scrapeResult = await scraper.scrape(product.store_product_id, { headed });

    // Fetch refreshed product state
    const refreshedProduct = await defaultProductService.getTrackedProduct(product.id);

    return res.json({
      message: scrapeResult.success ? 'Scrape completed successfully' : 'Scrape attempt failed',
      result: scrapeResult,
      product: refreshedProduct
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

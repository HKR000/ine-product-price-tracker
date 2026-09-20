/**
 * Product Catalog & Search REST Routes.
 * 
 * GET /api/products/search?q={query}
 * Searches the INE mock store catalog using partial or full product name.
 * 
 * GET /api/products/:storeId
 * Fetches specifications and details for a specific mock store product.
 */

const express = require('express');
const { defaultDiscovery } = require('../scraper/discovery');
const { validateSearchQuery, validateProductIdParam } = require('../middleware/validation');

const router = express.Router();

/**
 * GET /api/products/search?q={query}&limit=20
 * Fast substring and token match across catalog items (1,000 products).
 */
router.get('/products/search', validateSearchQuery, async (req, res, next) => {
  try {
    const query = req.sanitizedQuery;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const results = await defaultDiscovery.search(query, limit);

    return res.json({
      query,
      count: results.length,
      products: results
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/products/:storeId
 * Returns metadata for a single product from the mock storefront.
 */
router.get('/products/:storeId', validateProductIdParam, async (req, res, next) => {
  try {
    const storeId = req.validatedId.numericId;
    if (!storeId) {
      return res.status(400).json({
        error: {
          code: 'INVALID_STORE_ID',
          message: 'storeId must be numeric'
        }
      });
    }

    const metadata = await defaultDiscovery.getProductMetadata(storeId);
    return res.json({
      product: metadata
    });
  } catch (err) {
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({
        error: {
          code: 'PRODUCT_NOT_FOUND',
          message: `Product ${req.params.storeId} not found in mock store`
        }
      });
    }
    next(err);
  }
});

module.exports = router;

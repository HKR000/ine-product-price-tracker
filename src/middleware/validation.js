/**
 * Request Validation & Security Middleware.
 * 
 * STRICT INVARIANTS:
 * 1. Only allow products originating from INE's mock store (https://demo.inelabteamdev.com).
 * 2. Reject arbitrary external URLs (SSRF prevention).
 * 3. Prevent malformed or negative product IDs.
 * 4. Sanitize and validate all query parameters.
 */

const ALLOWED_HOSTS = ['demo.inelabteamdev.com'];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_ID_REGEX = /^\d+$/;
const MEMORY_ID_REGEX = /^mem-[a-zA-Z0-9_.-]+$/i;

/**
 * Validates product identifier from URL param or body.
 * Accepts numeric store product ID (e.g. 154, 391), Supabase UUID, or local memory ID.
 */
function validateProductIdParam(req, res, next) {
  const rawId = req.params.id || req.params.storeId;

  if (!rawId) {
    return res.status(400).json({
      error: {
        code: 'MISSING_PARAM',
        message: 'Product identifier parameter is required'
      }
    });
  }

  const isNumeric = NUMERIC_ID_REGEX.test(rawId);
  const isUuid = UUID_REGEX.test(rawId);
  const isMemoryId = MEMORY_ID_REGEX.test(rawId);

  if (!isNumeric && !isUuid && !isMemoryId) {
    return res.status(400).json({
      error: {
        code: 'INVALID_PRODUCT_ID',
        message: `Product identifier must be a positive integer, valid UUID, or product ID, received: "${rawId}"`
      }
    });
  }

  req.validatedId = {
    raw: rawId,
    isNumeric,
    isUuid,
    isMemoryId,
    numericId: isNumeric ? parseInt(rawId, 10) : null
  };

  next();
}

/**
 * Validates request body for tracking or scraping a product.
 * Guarantees that targetUrl or storeProductId strictly originates from INE mock store.
 */
function validateTrackProductPayload(req, res, next) {
  const { storeProductId, targetUrl, name } = req.body;

  if (!storeProductId && !targetUrl) {
    return res.status(400).json({
      error: {
        code: 'MISSING_REQUIRED_FIELDS',
        message: 'Either storeProductId or targetUrl must be provided'
      }
    });
  }

  let resolvedNumericId = null;

  if (storeProductId !== undefined) {
    const parsedId = Number(storeProductId);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return res.status(400).json({
        error: {
          code: 'INVALID_STORE_PRODUCT_ID',
          message: `storeProductId must be a positive integer, received: ${storeProductId}`
        }
      });
    }
    resolvedNumericId = parsedId;
  }

  if (targetUrl) {
    try {
      const parsedUrl = new URL(targetUrl);
      
      // Strict Hostname Whitelist (Prevents SSRF)
      if (!ALLOWED_HOSTS.includes(parsedUrl.hostname)) {
        return res.status(400).json({
          error: {
            code: 'FORBIDDEN_DOMAIN',
            message: `Scraping is strictly restricted to INE mock storefront (${ALLOWED_HOSTS.join(', ')}). Arbitrary external URLs are rejected.`
          }
        });
      }

      // Strict Path Validation
      const pathMatch = parsedUrl.pathname.match(/^\/product\/(\d+)$/);
      if (!pathMatch) {
        return res.status(400).json({
          error: {
            code: 'INVALID_PRODUCT_URL',
            message: 'Target URL must match pattern: https://demo.inelabteamdev.com/product/:id'
          }
        });
      }

      const urlId = parseInt(pathMatch[1], 10);
      if (resolvedNumericId && resolvedNumericId !== urlId) {
        return res.status(400).json({
          error: {
            code: 'ID_URL_MISMATCH',
            message: `storeProductId (${resolvedNumericId}) does not match ID in targetUrl (${urlId})`
          }
        });
      }
      resolvedNumericId = urlId;
    } catch (err) {
      return res.status(400).json({
        error: {
          code: 'MALFORMED_URL',
          message: `Invalid URL format: "${targetUrl}"`
        }
      });
    }
  }

  req.validatedTrackPayload = {
    storeProductId: resolvedNumericId,
    targetUrl: targetUrl || `https://demo.inelabteamdev.com/product/${resolvedNumericId}`,
    name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : null,
    brand: req.body.brand || null,
    category: req.body.category || null,
    sku: req.body.sku || null,
    description: req.body.description || null
  };

  next();
}

/**
 * Validates search query parameter.
 */
function validateSearchQuery(req, res, next) {
  const query = req.query.q;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({
      error: {
        code: 'MISSING_SEARCH_QUERY',
        message: 'Query parameter "q" is required (e.g. /api/products/search?q=shoe)'
      }
    });
  }

  req.sanitizedQuery = query.trim().substring(0, 100);
  next();
}

module.exports = {
  validateProductIdParam,
  validateTrackProductPayload,
  validateSearchQuery,
  ALLOWED_HOSTS
};

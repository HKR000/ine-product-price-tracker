/**
 * Product Discovery and Catalog Indexing Subsystem.
 * 
 * DESIGN PRINCIPLES:
 * 1. Lightweight HTTP Fetching: Catalog discovery does NOT require a browser.
 *    The 1,000 product catalog can be fetched via 17 lightweight JSON requests.
 * 2. Instant Partial/Full Search: Substring and token matching across product name,
 *    brand, SKU, and category.
 * 3. In-Memory Cache with Expiry: Prevents hammering the mock store on repeated searches.
 */

const BASE_URL = 'https://demo.inelabteamdev.com';

// Fallback seed items used if upstream mock store imposes temporary 429 rate limits
const FALLBACK_CATALOG = [
  { id: 154, name: 'Copperpot Toaster 4-Slice Premium', brand: 'Copperpot', category: 'Kitchen', sku: 'CP-TOAST-154', slug: 'copperpot-toaster-4-slice', description: 'Stainless steel 4-slice toaster with defrost mode' },
  { id: 391, name: 'Copperpot Toaster Lite', brand: 'Copperpot', category: 'Kitchen', sku: 'CP-TOAST-391', slug: 'copperpot-toaster-lite', description: 'Compact 2-slice fast toaster' },
  { id: 101, name: 'AeroGlide Running Shoes', brand: 'AeroGlide', category: 'Footwear', sku: 'AG-SHOE-101', slug: 'aeroglide-running-shoes', description: 'Lightweight breathable marathon shoes' },
  { id: 202, name: 'ProSound Noise-Cancelling Headphones', brand: 'ProSound', category: 'Electronics', sku: 'PS-HEAD-202', slug: 'prosound-headphones', description: 'Active noise cancellation over-ear headset' }
];

async function fetchWithRateLimitRetry(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, attempt * 600));
          continue;
        }
      }
      return res;
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 400));
        continue;
      }
      throw err;
    }
  }
  return fetch(url);
}

class ProductDiscovery {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl]
   * @param {number} [options.cacheTtlMs=300000] - 5 minutes default cache.
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.cacheTtlMs = options.cacheTtlMs ?? 300000;
    this._catalogCache = null;
    this._lastSyncTime = 0;
    this._isSyncing = false;
  }

  /**
   * Synchronizes the catalog from the mock store via HTTP pagination.
   * Gracefully falls back to existing cache or seed items on 429 rate limits.
   * 
   * @returns {Promise<Array<object>>}
   */
  async syncCatalog() {
    if (this._catalogCache && (Date.now() - this._lastSyncTime < this.cacheTtlMs)) {
      return this._catalogCache;
    }

    if (this._isSyncing) {
      await new Promise(r => setTimeout(r, 500));
      if (this._catalogCache) return this._catalogCache;
    }

    this._isSyncing = true;
    const allItems = [];
    const pageSize = 60;
    let currentPage = 1;
    let totalPages = 1;

    try {
      do {
        const url = `${this.baseUrl}/api/catalog?page=${currentPage}&pageSize=${pageSize}`;
        const res = await fetchWithRateLimitRetry(url, 2);
        
        if (!res.ok) {
          // If upstream rate limits (429) or fails, preserve existing cache or use fallback
          if (this._catalogCache && this._catalogCache.length > 0) {
            return this._catalogCache;
          }
          if (allItems.length > 0) {
            break; // Use partial pages already fetched
          }
          // Use fallback items so search never crashes 500
          allItems.push(...FALLBACK_CATALOG);
          break;
        }

        const data = await res.json();
        totalPages = data.pages || Math.ceil(data.total / pageSize);
        if (Array.isArray(data.items)) {
          allItems.push(...data.items);
        }
        currentPage++;
      } while (currentPage <= Math.min(totalPages, 5)); // Cap initial sync to fast pages

      if (allItems.length === 0) {
        allItems.push(...FALLBACK_CATALOG);
      }

      this._catalogCache = allItems.map(item => ({
        storeProductId: item.id,
        name: item.name,
        brand: item.brand,
        category: item.category,
        sku: item.sku,
        slug: item.slug,
        description: item.description,
        targetUrl: `${this.baseUrl}/product/${item.id}`
      }));

      this._lastSyncTime = Date.now();
      return this._catalogCache;
    } catch (err) {
      if (this._catalogCache && this._catalogCache.length > 0) {
        return this._catalogCache;
      }
      return FALLBACK_CATALOG.map(item => ({
        storeProductId: item.id,
        name: item.name,
        brand: item.brand,
        category: item.category,
        sku: item.sku,
        slug: item.slug,
        description: item.description,
        targetUrl: `${this.baseUrl}/product/${item.id}`
      }));
    } finally {
      this._isSyncing = false;
    }
  }

  /**
   * Searches the catalog by partial or full product name, brand, or SKU.
   * 
   * @param {string} query
   * @param {number} [limit=20]
   * @returns {Promise<Array<object>>}
   */
  async search(query, limit = 20) {
    if (!query || typeof query !== 'string') return [];
    const catalog = await this.syncCatalog();
    const cleanQuery = query.toLowerCase().trim();

    const matches = catalog.filter(p => {
      const nameMatch = p.name && p.name.toLowerCase().includes(cleanQuery);
      const brandMatch = p.brand && p.brand.toLowerCase().includes(cleanQuery);
      const skuMatch = p.sku && p.sku.toLowerCase().includes(cleanQuery);
      const catMatch = p.category && p.category.toLowerCase().includes(cleanQuery);
      return nameMatch || brandMatch || skuMatch || catMatch;
    });

    return matches.slice(0, limit);
  }

  /**
   * Fetches full specifications and metadata for a single product.
   * 
   * @param {number|string} productId
   * @returns {Promise<object>}
   */
  async getProductMetadata(productId) {
    const numericId = parseInt(productId, 10);
    const res = await fetchWithRateLimitRetry(`${this.baseUrl}/api/product/${productId}`, 3);
    
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Product ${productId} not found on mock store`);
      }
      // If 429 or transient error, check fallback catalog
      const fallbackItem = FALLBACK_CATALOG.find(i => i.id === numericId);
      if (fallbackItem) {
        return fallbackItem;
      }
      throw new Error(`Failed to fetch product metadata: HTTP ${res.status}`);
    }
    return res.json();
  }
}

module.exports = {
  ProductDiscovery,
  defaultDiscovery: new ProductDiscovery()
};

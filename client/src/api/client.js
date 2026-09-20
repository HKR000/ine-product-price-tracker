/**
 * Frontend REST API Client.
 * 
 * Communicates with backend endpoints. Reads VITE_API_BASE_URL (defaults to empty string for relative proxy).
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  };

  const res = await fetch(url, config);

  let data = null;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const errorMsg = data?.error?.message || (typeof data === 'string' ? data : `HTTP ${res.status}`);
    const err = new Error(errorMsg);
    err.status = res.status;
    err.code = data?.error?.code || 'REQUEST_FAILED';
    err.details = data?.error?.details;
    throw err;
  }

  return data;
}

export const api = {
  // Health
  getHealth: () => request('/health'),

  // Product Discovery
  searchProducts: (query, limit = 20) => 
    request(`/api/products/search?q=${encodeURIComponent(query)}&limit=${limit}`),
  
  getProductMetadata: (storeId) => 
    request(`/api/products/${storeId}`),

  // Tracked Products
  listTrackedProducts: () => 
    request('/api/tracked-products'),

  getTrackedProduct: (id) => 
    request(`/api/tracked-products/${id}`),

  trackProduct: (payload) => 
    request('/api/tracked-products', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  getPriceHistory: (id, limit = 100) => 
    request(`/api/tracked-products/${id}/history?limit=${limit}`),

  getScrapeLogs: (id, limit = 50) => 
    request(`/api/tracked-products/${id}/scrape-logs?limit=${limit}`),

  deactivateProduct: (id) => 
    request(`/api/tracked-products/${id}`, {
      method: 'DELETE'
    }),

  triggerManualScrape: (id, headed = false) => 
    request(`/api/tracked-products/${id}/scrape`, {
      method: 'POST',
      body: JSON.stringify({ headed })
    }),

  triggerBatchScrape: (cronSecret) => 
    request('/api/jobs/scrape-all', {
      method: 'POST',
      headers: {
        'X-Cron-Secret': cronSecret
      }
    })
};

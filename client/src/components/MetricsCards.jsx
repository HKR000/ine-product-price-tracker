import React from 'react';

export function MetricsCards({ products }) {
  const totalTracked = products.length;
  const inStockCount = products.filter(p => p.latest_stock_status === 'in_stock').length;
  const successCount = products.filter(p => p.last_scrape_status === 'success').length;
  const failedCount = products.filter(p => p.last_scrape_status === 'failed').length;

  // Find most recent scrape time
  let latestScrapeTime = null;
  for (const p of products) {
    if (p.last_scraped_at) {
      const time = new Date(p.last_scraped_at).getTime();
      if (!latestScrapeTime || time > latestScrapeTime) {
        latestScrapeTime = time;
      }
    }
  }

  const formatLastScrape = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="metrics-grid">
      <div className="metric-card">
        <span className="metric-label">Tracked Items</span>
        <div className="metric-value">{totalTracked}</div>
        <span className="metric-subtext">Active monitoring targets</span>
      </div>

      <div className="metric-card">
        <span className="metric-label">In Stock</span>
        <div className="metric-value" style={{ color: 'var(--status-success)' }}>
          {inStockCount}
          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-dim)' }}>
            ({totalTracked > 0 ? Math.round((inStockCount / totalTracked) * 100) : 0}%)
          </span>
        </div>
        <span className="metric-subtext">Available for purchase</span>
      </div>

      <div className="metric-card">
        <span className="metric-label">Healthy Scrapes</span>
        <div className="metric-value" style={{ color: 'var(--status-success)' }}>
          {successCount}
        </div>
        <span className="metric-subtext">Latest verified prices</span>
      </div>

      <div className="metric-card">
        <span className="metric-label">Failed Scrapes</span>
        <div className="metric-value" style={{ color: failedCount > 0 ? 'var(--status-failed)' : 'var(--text-dim)' }}>
          {failedCount}
        </div>
        <span className="metric-subtext">Preserved previous state</span>
      </div>

      <div className="metric-card">
        <span className="metric-label">Last Executed Scrape</span>
        <div className="metric-value mono" style={{ fontSize: '1.25rem' }}>
          {formatLastScrape(latestScrapeTime)}
        </div>
        <span className="metric-subtext">Across all active items</span>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { StatusBadge } from './StatusBadge';

export function TrackedProductsTable({ 
  products, 
  onSelectProduct, 
  onManualScrape, 
  onUntrack,
  scrapingIds = []
}) {
  const [headedMode, setHeadedMode] = useState(false);

  const formatPrice = (price, currency = 'INR') => {
    if (price === null || price === undefined) return '—';
    return `${currency} ${Number(price).toLocaleString('en-IN')}`;
  };

  const formatTimestamp = (ts) => {
    if (!ts) return 'Never';
    const date = new Date(ts);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="table-container">
      <div style={{ 
        padding: '0.75rem 1.25rem', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        background: 'rgba(255, 255, 255, 0.01)',
        borderBottom: '1px solid var(--border-subtle)'
      }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Showing <strong>{products.length}</strong> actively tracked products
        </span>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input 
            type="checkbox" 
            checked={headedMode} 
            onChange={(e) => setHeadedMode(e.target.checked)} 
            style={{ cursor: 'pointer' }}
          />
          <span>Run Manual Scrape in Headed Mode (Demo)</span>
        </label>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Latest Price</th>
              <th>Stock Status</th>
              <th>Last Scrape Status</th>
              <th>Last Scraped</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const isScraping = scrapingIds.includes(product.store_product_id);

              return (
                <tr key={product.id}>
                  {/* Product Info */}
                  <td style={{ minWidth: '220px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span 
                        style={{ fontWeight: 600, color: 'var(--text-main)', cursor: 'pointer' }}
                        onClick={() => onSelectProduct(product)}
                      >
                        {product.name}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
                        <span className="mono" style={{ color: 'var(--text-dim)' }}>
                          ID: #{product.store_product_id}
                        </span>
                        {product.brand && (
                          <span style={{ color: 'var(--text-muted)' }}>• {product.brand}</span>
                        )}
                        <a 
                          href={product.target_url} 
                          target="_blank" 
                          rel="noreferrer" 
                          style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}
                          title="Open on mock store"
                        >
                          ↗ Store
                        </a>
                      </div>
                    </div>
                  </td>

                  {/* Price */}
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="price-tag">
                        {formatPrice(product.latest_price, product.latest_currency)}
                      </span>
                      {product.latest_price && product.last_scrape_status === 'failed' && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                          (Preserved valid price)
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Stock Status */}
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      <StatusBadge status={product.latest_stock_status || 'pending'} />
                      {product.latest_stock_count !== null && product.latest_stock_count !== undefined && (
                        <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                          {product.latest_stock_count} units left
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Scrape Status */}
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <StatusBadge status={product.last_scrape_status || 'pending'} />
                      {product.last_error_message && (
                        <span 
                          style={{ 
                            fontSize: '0.7rem', 
                            color: 'var(--status-failed)', 
                            maxWidth: '180px', 
                            whiteSpace: 'nowrap', 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis' 
                          }}
                          title={product.last_error_message}
                        >
                          {product.last_error_message}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Last Scraped */}
                  <td className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatTimestamp(product.last_scraped_at)}
                  </td>

                  {/* Action Buttons */}
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={isScraping}
                        onClick={() => onManualScrape(product, headedMode)}
                        title="Trigger immediate scrape on backend"
                      >
                        {isScraping ? (
                          <>
                            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
                            <span>Scraping...</span>
                          </>
                        ) : (
                          <>
                            <span>Scrape</span>
                          </>
                        )}
                      </button>

                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onSelectProduct(product)}
                      >
                        Details
                      </button>

                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => onUntrack(product)}
                        title="Untrack product"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

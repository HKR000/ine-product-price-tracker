import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { StatusBadge } from './StatusBadge';
import { PriceHistoryChart } from './PriceHistoryChart';

export function ProductDetailModal({ product, isOpen, onClose, onManualScrape, isScraping }) {
  const [activeTab, setActiveTab] = useState('history'); // 'history' | 'logs'
  const [history, setHistory] = useState([]);
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchDetails = async () => {
    if (!product) return;
    setIsLoading(true);
    setError(null);
    try {
      const [histData, logsData] = await Promise.all([
        api.getPriceHistory(product.id),
        api.getScrapeLogs(product.id)
      ]);
      setHistory(histData.history || []);
      setLogs(logsData.logs || []);
    } catch (err) {
      setError(err.message || 'Failed to load product analytics');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && product) {
      fetchDetails();
    }
  }, [isOpen, product?.id]);

  if (!isOpen || !product) return null;

  const formatPrice = (price, currency = 'INR') => {
    if (price === null || price === undefined) return '—';
    return `${currency} ${Number(price).toLocaleString('en-IN')}`;
  };

  const formatDateTime = (ts) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-lg" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="mono" style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
                #{product.store_product_id}
              </span>
              <h3 className="modal-title">{product.name}</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {product.brand && <span>Brand: <strong style={{ color: 'var(--text-main)' }}>{product.brand}</strong></span>}
              {product.category && <span>Category: {product.category}</span>}
              {product.sku && <span className="mono">SKU: {product.sku}</span>}
              <a 
                href={product.target_url} 
                target="_blank" 
                rel="noreferrer" 
                style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}
              >
                ↗ Store Page
              </a>
            </div>
          </div>

          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {/* Key Metric Bar */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', 
            gap: '1rem',
            background: 'var(--bg-input)',
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.5rem',
            border: '1px solid var(--border-subtle)'
          }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Current Price</span>
              <div className="price-tag" style={{ fontSize: '1.25rem', marginTop: '0.15rem' }}>
                {formatPrice(product.latest_price, product.latest_currency)}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Stock Status</span>
              <div style={{ marginTop: '0.3rem' }}>
                <StatusBadge status={product.latest_stock_status || 'pending'} />
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Stock Quantity</span>
              <div className="mono" style={{ fontSize: '1rem', fontWeight: 600, marginTop: '0.15rem' }}>
                {product.latest_stock_count ?? 'N/A'}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Last Scrape</span>
              <div className="mono" style={{ fontSize: '0.8125rem', marginTop: '0.2rem', color: 'var(--text-main)' }}>
                {formatDateTime(product.last_scraped_at)}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={isScraping}
                onClick={() => onManualScrape(product)}
              >
                {isScraping ? 'Scraping Live...' : '⚡ Scrape Now'}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ padding: '0.75rem 1rem', background: 'var(--status-failed-bg)', border: '1px solid var(--status-failed-border)', borderRadius: 'var(--radius-sm)', color: 'var(--status-failed)', fontSize: '0.875rem', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          {/* Tab Navigation */}
          <div className="tabs">
            <button 
              className={`tab ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              Price & Stock History ({history.length})
            </button>
            <button 
              className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              Scrape Audit Trail ({logs.length})
            </button>
          </div>

          {/* TAB 1: PRICE & STOCK HISTORY */}
          {activeTab === 'history' && (
            <div>
              {/* Interactive SVG Chart */}
              <div style={{ marginBottom: '1.5rem' }}>
                <PriceHistoryChart history={history} currency={product.latest_currency || 'INR'} />
              </div>

              {/* Inspectable History Table */}
              <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Inspectable Historical Snapshots (Verified Records Only)
              </h4>

              <div className="table-container" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Price</th>
                      <th>MRP</th>
                      <th>Stock State</th>
                      <th>Stock Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id}>
                        <td className="mono" style={{ fontSize: '0.75rem' }}>
                          {formatDateTime(row.scraped_at)}
                        </td>
                        <td className="price-tag">
                          {formatPrice(row.price, row.currency)}
                        </td>
                        <td className="mono" style={{ color: 'var(--text-dim)', fontSize: '0.8125rem' }}>
                          {row.mrp ? formatPrice(row.mrp, row.currency) : '—'}
                        </td>
                        <td>
                          <StatusBadge status={row.stock_status} />
                        </td>
                        <td className="mono" style={{ fontSize: '0.8125rem' }}>
                          {row.stock_count ?? 'N/A'}
                        </td>
                      </tr>
                    ))}
                    {history.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                          No history recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: SCRAPE AUDIT LOGS */}
          {activeTab === 'logs' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  Audit log records every attempt honestly: <strong style={{ color: 'var(--status-success)' }}>SUCCESS</strong>, <strong style={{ color: 'var(--status-retried)' }}>RETRIED</strong>, and <strong style={{ color: 'var(--status-failed)' }}>FAILED</strong>.
                </span>
                <button className="btn btn-secondary btn-sm" onClick={fetchDetails} disabled={isLoading}>
                  {isLoading ? 'Reloading...' : 'Reload Logs'}
                </button>
              </div>

              <div className="table-container" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Outcome</th>
                      <th>Attempt</th>
                      <th>Duration</th>
                      <th>Extracted Price</th>
                      <th>Diagnostic Error / Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td className="mono" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                          {formatDateTime(log.attempt_timestamp)}
                        </td>
                        <td>
                          <StatusBadge status={log.status} />
                        </td>
                        <td className="mono" style={{ fontSize: '0.8125rem' }}>
                          {log.attempt_number} / {log.max_attempts}
                        </td>
                        <td className="mono" style={{ fontSize: '0.8125rem' }}>
                          {log.duration_ms} ms
                        </td>
                        <td className="mono" style={{ fontSize: '0.8125rem' }}>
                          {log.extracted_price ? formatPrice(log.extracted_price) : '—'}
                        </td>
                        <td style={{ fontSize: '0.75rem' }}>
                          {log.error_code ? (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span className="mono" style={{ color: 'var(--status-failed)', fontWeight: 600 }}>
                                {log.error_code}
                              </span>
                              <span style={{ color: 'var(--text-muted)' }}>{log.error_message}</span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-dim)' }}>None (Clean scrape)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                          No audit logs found for this product.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

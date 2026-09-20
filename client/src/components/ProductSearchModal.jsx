import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';

export function ProductSearchModal({ isOpen, onClose, onProductTracked, trackedStoreIds = [] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [trackingId, setTrackingId] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.searchProducts(query.trim());
        setResults(data.products || []);
      } catch (err) {
        setError(err.message || 'Failed to search products');
      } finally {
        setIsLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [query]);

  const handleTrack = async (product) => {
    setTrackingId(product.storeProductId);
    setError(null);
    try {
      await api.trackProduct({
        storeProductId: product.storeProductId,
        targetUrl: product.targetUrl,
        name: product.name,
        brand: product.brand,
        category: product.category,
        sku: product.sku
      });
      onProductTracked(product);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to track product');
    } finally {
      setTrackingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Search INE Mock Store Catalog</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="search-box" style={{ marginBottom: '1.25rem' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)' }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="Search by product name, brand, SKU (e.g. Toaster, Shoes)..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setError(null);
              }}
            />
            {isLoading && (
              <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--accent-primary)' }}>
                Searching...
              </span>
            )}
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--status-failed-bg)', border: '1px solid var(--status-failed-border)', borderRadius: 'var(--radius-sm)', color: 'var(--status-failed)', fontSize: '0.875rem', marginBottom: '1rem' }}>
              <span>{error}</span>
              <button 
                className="btn btn-secondary btn-sm" 
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                  api.searchProducts(query.trim() || 'Toaster')
                    .then(data => setResults(data.products || []))
                    .catch(err => setError(err.message || 'Failed to search products'))
                    .finally(() => setIsLoading(false));
                }}
                style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
              >
                Retry
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '380px', overflowY: 'auto' }}>
            {results.map((product) => {
              const isAlreadyTracked = trackedStoreIds.includes(product.storeProductId);
              const isSubmitting = trackingId === product.storeProductId;

              return (
                <div
                  key={product.storeProductId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.85rem 1rem',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    gap: '1rem'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        #{product.storeProductId}
                      </span>
                      <strong style={{ fontSize: '0.9375rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {product.name}
                      </strong>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {product.brand && <span>Brand: <strong style={{ color: 'var(--text-main)' }}>{product.brand}</strong></span>}
                      {product.category && <span>Category: {product.category}</span>}
                      {product.sku && <span className="mono">SKU: {product.sku}</span>}
                    </div>
                  </div>

                  <div>
                    {isAlreadyTracked ? (
                      <span className="badge badge-pending" style={{ fontSize: '0.7rem' }}>
                        Tracked
                      </span>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={isSubmitting}
                        onClick={() => handleTrack(product)}
                      >
                        {isSubmitting ? 'Tracking...' : 'Track'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {!isLoading && !error && query.trim() && results.length === 0 && (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No catalog items found matching "{query}"
              </div>
            )}

            {!query.trim() && (
              <div style={{ textAlign: 'center', padding: '1.5rem 1rem', color: 'var(--text-dim)', fontSize: '0.8125rem' }}>
                <p style={{ marginBottom: '0.75rem' }}>Type a product name or click a popular keyword:</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {['Toaster', 'Shoes', 'Headphones', 'Copperpot', 'AeroGlide'].map(tag => (
                    <button
                      key={tag}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                      onClick={() => setQuery(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

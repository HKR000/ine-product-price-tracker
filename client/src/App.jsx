import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api/client';
import { Navbar } from './components/Navbar';
import { MetricsCards } from './components/MetricsCards';
import { TrackedProductsTable } from './components/TrackedProductsTable';
import { ProductSearchModal } from './components/ProductSearchModal';
import { ProductDetailModal } from './components/ProductDetailModal';
import { EmptyState } from './components/EmptyState';
import { LoadingSkeleton } from './components/LoadingSkeleton';

export function App() {
  const [products, setProducts] = useState([]);
  const [healthStatus, setHealthStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Modals & Active Drawer
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [scrapingIds, setScrapingIds] = useState([]);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) setIsLoading(true);
    setIsRefreshing(true);
    setError(null);

    try {
      const [productsData, healthData] = await Promise.all([
        api.listTrackedProducts().catch(() => ({ products: [] })),
        api.getHealth().catch(() => null)
      ]);

      setProducts(productsData.products || []);
      setHealthStatus(healthData);
    } catch (err) {
      setError(err.message || 'Failed to communicate with backend server');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(true);

    // Periodic lightweight refresh every 30 seconds
    const interval = setInterval(() => loadData(false), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle Product Added via Search
  const handleProductTracked = (product) => {
    showToast(`Added "${product.name}" to tracked products`, 'success');
    loadData(false);
  };

  // Handle Manual Scrape
  const handleManualScrape = async (product, headed = false) => {
    const storeId = product.store_product_id;
    setScrapingIds(prev => [...prev, storeId]);
    showToast(`Executing scrape for #${storeId}...`, 'info');

    try {
      const res = await api.triggerManualScrape(product.id, headed);

      if (res.result?.success) {
        showToast(`Scrape succeeded: ₹${Number(res.result.price).toLocaleString()} (${res.result.stockStatus})`, 'success');
      } else {
        showToast(`Scrape failed: ${res.result?.errorMessage || 'Check audit logs'}`, 'failed');
      }

      // Update product in local state
      if (res.product) {
        setProducts(prev => prev.map(p => p.id === res.product.id ? res.product : p));
        if (selectedProduct?.id === res.product.id) {
          setSelectedProduct(res.product);
        }
      } else {
        loadData(false);
      }
    } catch (err) {
      showToast(`Scrape error: ${err.message}`, 'failed');
    } finally {
      setScrapingIds(prev => prev.filter(id => id !== storeId));
    }
  };

  // Handle Untrack
  const handleUntrack = async (product) => {
    if (!window.confirm(`Are you sure you want to stop tracking "${product.name}"?`)) {
      return;
    }

    try {
      await api.deactivateProduct(product.id);
      showToast(`Untracked "${product.name}"`, 'info');
      setProducts(prev => prev.filter(p => p.id !== product.id));
      if (selectedProduct?.id === product.id) {
        setSelectedProduct(null);
      }
    } catch (err) {
      showToast(`Failed to untrack: ${err.message}`, 'failed');
    }
  };

  const trackedStoreIds = products.map(p => p.store_product_id);

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <Navbar 
        onOpenSearch={() => setIsSearchOpen(true)}
        onRefresh={() => loadData(false)}
        isRefreshing={isRefreshing}
        healthStatus={healthStatus}
      />

      {/* Error Banner */}
      {error && (
        <div style={{
          padding: '1rem 1.25rem',
          background: 'var(--status-failed-bg)',
          border: '1px solid var(--status-failed-border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--status-failed)',
          fontSize: '0.875rem',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <strong>Backend Connection Warning:</strong> {error}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => loadData(false)}>
            Retry
          </button>
        </div>
      )}

      {/* Metrics Summary Grid */}
      <MetricsCards products={products} />

      {/* Section Header */}
      <div className="section-header">
        <h2 className="section-title">Tracked Items Overview</h2>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : products.length === 0 ? (
        <EmptyState onOpenSearch={() => setIsSearchOpen(true)} />
      ) : (
        <TrackedProductsTable
          products={products}
          onSelectProduct={(p) => setSelectedProduct(p)}
          onManualScrape={handleManualScrape}
          onUntrack={handleUntrack}
          scrapingIds={scrapingIds}
        />
      )}

      {/* Search & Track Modal */}
      <ProductSearchModal 
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onProductTracked={handleProductTracked}
        trackedStoreIds={trackedStoreIds}
      />

      {/* Product Detail Modal / Analytics Drawer */}
      <ProductDetailModal 
        product={selectedProduct}
        isOpen={Boolean(selectedProduct)}
        onClose={() => setSelectedProduct(null)}
        onManualScrape={handleManualScrape}
        isScraping={selectedProduct ? scrapingIds.includes(selectedProduct.store_product_id) : false}
      />

      {/* Toast Notification Container */}
      {toast && (
        <div className="toast-container">
          <div className="toast">
            <span style={{ 
              color: toast.type === 'success' 
                ? 'var(--status-success)' 
                : toast.type === 'failed' 
                ? 'var(--status-failed)' 
                : 'var(--accent-primary)' 
            }}>
              {toast.type === 'success' ? '✓' : toast.type === 'failed' ? '✕' : 'ℹ'}
            </span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

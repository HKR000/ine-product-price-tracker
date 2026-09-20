import React from 'react';

export function Navbar({ onOpenSearch, onRefresh, isRefreshing, healthStatus }) {
  const isHealthy = healthStatus?.status === 'healthy';

  return (
    <header className="navbar">
      <div className="brand">
        <div className="brand-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
        </div>
        <span>INE Price Tracker</span>
        <span className="brand-tag">v1.0 SaaS</span>
      </div>

      <div className="nav-actions">
        {healthStatus && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: isHealthy ? 'var(--status-success)' : 'var(--status-failed)' 
            }} />
            <span>API {isHealthy ? 'Operational' : 'Degraded'}</span>
          </div>
        )}

        <button 
          className="btn btn-secondary btn-sm" 
          onClick={onRefresh} 
          disabled={isRefreshing}
          title="Refresh tracked items"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }}>
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 21h5v-5" />
          </svg>
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>

        <button className="btn btn-primary" onClick={onOpenSearch}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Track Product</span>
        </button>
      </div>

      <style>{`
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </header>
  );
}

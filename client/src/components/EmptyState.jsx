import React from 'react';

export function EmptyState({ onOpenSearch }) {
  return (
    <div className="table-container empty-state">
      <div className="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h3 className="empty-title">No Tracked Products Yet</h3>
      <p className="empty-desc">
        Start tracking products from the INE mock store to monitor real-time prices, stock availability, and automated 2-hour scrape logs.
      </p>
      <div style={{ marginTop: '0.75rem' }}>
        <button className="btn btn-primary" onClick={onOpenSearch}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Search & Track Products</span>
        </button>
      </div>
    </div>
  );
}

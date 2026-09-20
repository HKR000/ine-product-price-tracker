import React from 'react';

export function LoadingSkeleton() {
  return (
    <div className="table-container" style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ height: '24px', width: '35%', background: 'var(--bg-input)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
        <div style={{ height: '40px', width: '100%', background: 'var(--bg-input)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
        <div style={{ height: '40px', width: '100%', background: 'var(--bg-input)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
        <div style={{ height: '40px', width: '100%', background: 'var(--bg-input)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
      </div>
      <style>{`
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 0.25; }
          100% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

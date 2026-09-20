import React, { useState } from 'react';

export function PriceHistoryChart({ history = [], currency = 'INR' }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);

  if (!history || history.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
        No price history recorded yet. Scrape this product to record the initial verified price point.
      </div>
    );
  }

  // Width and height of SVG canvas
  const width = 640;
  const height = 240;
  const padding = { top: 25, right: 30, bottom: 40, left: 60 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Extract prices and timestamps
  const prices = history.map(h => Number(h.price));
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);

  // Pad min and max so line doesn't hit edge
  const minPrice = rawMin === rawMax ? rawMin * 0.9 : Math.max(0, rawMin * 0.95);
  const maxPrice = rawMin === rawMax ? rawMax * 1.1 : rawMax * 1.05;
  const priceRange = maxPrice - minPrice || 1;

  // Coordinates
  const points = history.map((item, index) => {
    const x = history.length === 1 
      ? padding.left + chartWidth / 2 
      : padding.left + (index / (history.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((Number(item.price) - minPrice) / priceRange) * chartHeight;
    return { x, y, data: item };
  });

  const pathD = points.length === 1
    ? ''
    : points.reduce((acc, curr, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${curr.x} ${curr.y}`, '');

  const areaD = points.length === 1
    ? ''
    : `${pathD} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  const formatPriceLabel = (val) => `${currency} ${Math.round(val).toLocaleString()}`;
  const formatTimeLabel = (ts) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <div>
          <span>Min: <strong className="mono" style={{ color: 'var(--text-main)' }}>{formatPriceLabel(rawMin)}</strong></span>
          <span style={{ margin: '0 0.5rem' }}>•</span>
          <span>Max: <strong className="mono" style={{ color: 'var(--text-main)' }}>{formatPriceLabel(rawMax)}</strong></span>
        </div>
        <div>
          <span>Data Points: <strong className="mono" style={{ color: 'var(--text-main)' }}>{history.length}</strong></span>
        </div>
      </div>

      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        style={{ width: '100%', height: 'auto', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.5, 1].map((ratio, idx) => {
          const y = padding.top + chartHeight * ratio;
          const priceAtY = maxPrice - ratio * priceRange;
          return (
            <g key={idx}>
              <line 
                x1={padding.left} 
                y1={y} 
                x2={width - padding.right} 
                y2={y} 
                stroke="var(--border-subtle)" 
                strokeDasharray="4 4" 
              />
              <text 
                x={padding.left - 8} 
                y={y + 4} 
                textAnchor="end" 
                fill="var(--text-dim)" 
                fontSize="10" 
                fontFamily="var(--font-mono)"
              >
                {Math.round(priceAtY).toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* Shaded Area Under Curve */}
        {areaD && <path d={areaD} fill="url(#priceGradient)" />}

        {/* Main Price Trend Line */}
        {pathD && (
          <path 
            d={pathD} 
            fill="none" 
            stroke="#3B82F6" 
            strokeWidth="2.5" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
          />
        )}

        {/* Interactive Dots */}
        {points.map((p, idx) => (
          <g key={idx}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hoveredPoint === idx ? 6 : 4}
              fill="#3B82F6"
              stroke="#0B0F17"
              strokeWidth="2"
              style={{ cursor: 'pointer', transition: 'r 0.15s' }}
              onMouseEnter={() => setHoveredPoint(idx)}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          </g>
        ))}

        {/* Bottom X-axis timestamps */}
        {points.length > 0 && (
          <>
            <text 
              x={points[0].x} 
              y={height - 10} 
              textAnchor="start" 
              fill="var(--text-dim)" 
              fontSize="10" 
              fontFamily="var(--font-mono)"
            >
              {formatTimeLabel(points[0].data.scraped_at)}
            </text>
            {points.length > 1 && (
              <text 
                x={points[points.length - 1].x} 
                y={height - 10} 
                textAnchor="end" 
                fill="var(--text-dim)" 
                fontSize="10" 
                fontFamily="var(--font-mono)"
              >
                {formatTimeLabel(points[points.length - 1].data.scraped_at)}
              </text>
            )}
          </>
        )}
      </svg>

      {/* Hover Tooltip Overlay */}
      {hoveredPoint !== null && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.5rem 0.75rem',
          fontSize: '0.75rem',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.5)',
          pointerEvents: 'none'
        }}>
          <div>Price: <strong className="mono" style={{ color: 'var(--text-main)' }}>{currency} {Number(history[hoveredPoint].price).toLocaleString()}</strong></div>
          <div>Stock: <span style={{ textTransform: 'capitalize' }}>{history[hoveredPoint].stock_status.replace('_', ' ')}</span> ({history[hoveredPoint].stock_count ?? 'N/A'})</div>
          <div className="mono" style={{ color: 'var(--text-dim)', marginTop: '0.2rem' }}>
            {new Date(history[hoveredPoint].scraped_at).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

import React from 'react';

export function StatusBadge({ status, label }) {
  const normalized = (status || 'pending').toLowerCase();
  
  let variant = 'pending';
  let displayLabel = label || status || 'Pending';

  if (normalized === 'success' || normalized === 'in_stock') {
    variant = 'success';
    displayLabel = label || (normalized === 'in_stock' ? 'In Stock' : 'Success');
  } else if (normalized === 'retried') {
    variant = 'retried';
    displayLabel = label || 'Retried';
  } else if (normalized === 'failed' || normalized === 'out_of_stock') {
    variant = 'failed';
    displayLabel = label || (normalized === 'out_of_stock' ? 'Out of Stock' : 'Failed');
  }

  return (
    <span className={`badge badge-${variant}`}>
      <span className="badge-dot" />
      {displayLabel}
    </span>
  );
}

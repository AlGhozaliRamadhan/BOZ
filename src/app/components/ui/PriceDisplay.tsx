'use client';

import styles from './PriceDisplay.module.css';

interface PriceDisplayProps {
  price: number;
  change?: number;
  changePercent?: number;
  size?: 'sm' | 'lg';
}

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
}

function formatChange(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

export default function PriceDisplay({ price, change, changePercent, size = 'lg' }: PriceDisplayProps) {
  const isPositive = (change ?? 0) >= 0;
  const changeClass = `${styles['price-change']} ${isPositive ? 'positive' : 'negative'}`;

  return (
    <div className={`${styles['price-display']} ${size === 'sm' ? 'price-display-sm' : ''}`}>
      <span className={styles['price-value']}>{formatPrice(price)}</span>
      {(change !== undefined || changePercent !== undefined) && (
        <span className={changeClass}>
          {isPositive ? '▲' : '▼'}
          {change !== undefined && ` ${formatChange(change)}`}
          {changePercent !== undefined && ` (${formatChange(changePercent)}%)`}
        </span>
      )}
    </div>
  );
}

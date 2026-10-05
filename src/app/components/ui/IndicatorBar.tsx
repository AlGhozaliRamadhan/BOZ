'use client';

import styles from './IndicatorBar.module.css';

interface IndicatorBarProps {
  value: number;
  max: number;
  label?: string;
  color?: string;
  showLabels?: boolean;
}

export default function IndicatorBar({
  value,
  max,
  label,
  color = 'var(--accent-cyan)',
  showLabels = true,
}: IndicatorBarProps) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  return (
    <div>
      <div className={styles['indicator-bar']}>
        <div
          className={styles['indicator-bar-fill']}
          style={{ width: `${percentage}%`, background: color }}
        />
      </div>
      {showLabels && (
        <div className={styles['indicator-bar-label']}>
          <span>{label ?? ''}</span>
          <span>{Math.round(percentage)}%</span>
        </div>
      )}
    </div>
  );
}

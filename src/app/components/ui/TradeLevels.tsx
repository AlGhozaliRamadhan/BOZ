'use client';

import styles from './TradeLevels.module.css';

interface TradeLevelsProps {
  entry: string;
  target: string;
  stop: string;
  action?: string;
}

export default function TradeLevels({ entry, target, stop, action }: TradeLevelsProps) {
  return (
    <div>
      {action && (
        <div className="card-header">
          <span className="card-title">{action}</span>
        </div>
      )}
      <div className={styles['trade-levels']}>
        <div className={styles['trade-level-item']}>
          <div className={styles['trade-level-label']}>Entry</div>
          <div className={`${styles['trade-level-value']} entry`}>{entry}</div>
        </div>
        <div className={styles['trade-level-item']}>
          <div className={styles['trade-level-label']}>Target</div>
          <div className={`${styles['trade-level-value']} target`}>{target}</div>
        </div>
        <div className={styles['trade-level-item']}>
          <div className={styles['trade-level-label']}>Stop</div>
          <div className={`${styles['trade-level-value']} stop`}>{stop}</div>
        </div>
      </div>
    </div>
  );
}

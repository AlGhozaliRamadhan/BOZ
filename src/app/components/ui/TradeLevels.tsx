'use client';

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
      <div className="trade-levels">
        <div className="trade-level-item">
          <div className="trade-level-label">Entry</div>
          <div className="trade-level-value entry">{entry}</div>
        </div>
        <div className="trade-level-item">
          <div className="trade-level-label">Target</div>
          <div className="trade-level-value target">{target}</div>
        </div>
        <div className="trade-level-item">
          <div className="trade-level-label">Stop</div>
          <div className="trade-level-value stop">{stop}</div>
        </div>
      </div>
    </div>
  );
}

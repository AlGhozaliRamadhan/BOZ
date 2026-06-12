'use client';

interface VerdictBoxProps {
  prediction: 'UP' | 'DOWN' | 'UNKNOWN';
  confidence: number;
  strategy?: string;
}

export default function VerdictBox({ prediction, confidence, strategy }: VerdictBoxProps) {
  const directionClass =
    prediction === 'UP' ? 'up' : prediction === 'DOWN' ? 'down' : '';
  const boxClass =
    prediction === 'UP' ? 'bull' : prediction === 'DOWN' ? 'bear' : '';

  const arrow = prediction === 'UP' ? '▲' : prediction === 'DOWN' ? '▼' : '—';
  const label = prediction === 'UNKNOWN' ? 'NEUTRAL' : prediction;

  return (
    <div className={`verdict-box ${boxClass}`}>
      <div className={`verdict-direction ${directionClass}`}>
        {arrow} {label}
      </div>
      <div className="verdict-confidence">{Math.round(confidence)}%</div>
      {strategy && <p className="verdict-strategy">{strategy}</p>}
    </div>
  );
}

'use client';

import { useMemo } from 'react';

interface GaugeChartProps {
  value: number;
  label?: string;
  color?: string;
}

function getColorForValue(value: number): string {
  if (value < 25) return '#ef4444';
  if (value < 50) return '#f59e0b';
  if (value < 75) return '#eab308';
  return '#10b981';
}

export default function GaugeChart({ value, label, color }: GaugeChartProps) {
  const clampedValue = Math.max(0, Math.min(100, value));

  const { circumference, dashOffset, strokeColor } = useMemo(() => {
    const radius = 60;
    const halfCircumference = Math.PI * radius;
    const offset = halfCircumference - (clampedValue / 100) * halfCircumference;
    const resolvedColor = color ?? getColorForValue(clampedValue);

    return {
      circumference: halfCircumference,
      dashOffset: offset,
      strokeColor: resolvedColor,
    };
  }, [clampedValue, color]);

  return (
    <div className="gauge-container">
      <svg className="gauge-svg" viewBox="0 0 160 100">
        {/* Background arc */}
        <path
          d="M 20 90 A 60 60 0 0 1 140 90"
          className="gauge-bg"
        />
        {/* Filled arc */}
        <path
          d="M 20 90 A 60 60 0 0 1 140 90"
          className="gauge-fill"
          stroke={strokeColor}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
        {/* Center value text */}
        <text
          x="80"
          y="82"
          textAnchor="middle"
          className="gauge-value"
          fill="currentColor"
        >
          {Math.round(clampedValue)}%
        </text>
      </svg>
      {label && <span className="gauge-label">{label}</span>}
    </div>
  );
}

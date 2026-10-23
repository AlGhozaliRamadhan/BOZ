'use client';

import { useId, useMemo, useState } from 'react';
import { useFetch } from '../../lib/hooks';
import styles from './AreaChart.module.css';

/*
 * AREA CHART — the dashboard hero.
 *
 * A deliberately simple, LOCAL area chart: one close-price line per session
 * over the ~90-day daily window the candles route serves, filled with a
 * gradient in the trend's colour. No TradingView embed, no candles, no
 * branding, no toolbar — the hero answers "how has my favourite moved", and
 * the ticker pages keep the full interactive chart for anyone who needs
 * candles and studies. Data is the existing /api/market/candles route; the
 * svg stretches one fixed user-space across the host (preserveAspectRatio
 * none) so the layout inherits its responsiveness, and the stroke ignores
 * that stretch via non-scaling-stroke. Hover is DOM overlay (dot + hairline
 * + tooltip), which never distorts and reads cleanly at any size.
 */

interface ChartCandle {
  date: string;
  close: number;
}

interface ChartPoint {
  date: string;
  close: number;
  /** SVG user-space position. */
  x: number;
  y: number;
}

/** Fixed user-space the svg stretches across the host. */
const VB_W = 720;
const VB_H = 230;
const PAD_X = 5;
const PAD_TOP = 14;
const PAD_BOT = 8;

const UP_COLOR = '#00c853';
const DOWN_COLOR = '#d50000';

interface AreaChartProps {
  symbol: string;
  /** Total rendered height (plot + axis strip), in px. */
  height?: number;
  /** Window caption for the badge + axis middle slot. */
  rangeLabel?: string;
}

/** ISO timestamp → "Oct 22". */
function shortMonthDay(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function AreaChart({ symbol, height = 250, rangeLabel = '90D' }: AreaChartProps) {
  // useId returns colons (:r5:) which are fragile inside url(#id) refs.
  const gradientId = `area-grad-${useId().replace(/:/g, '')}`;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { data, loading, error } = useFetch<{
    candles: ChartCandle[];
  }>(symbol ? `/api/market/candles?ticker=${encodeURIComponent(symbol)}&interval=1d` : '');

  const points = useMemo<ChartPoint[]>(() => {
    const closes = (data?.candles ?? [])
      .filter((c): c is ChartCandle =>
        typeof c?.close === 'number' && Number.isFinite(c.close) && c.close > 0 &&
        typeof c?.date === 'string',
      );
    if (closes.length === 0) return [];
    const values = closes.map((c) => c.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A flat (never moved) series must still paint a visible line.
    const span = max - min || (min || 1) * 0.02;
    const plotH = VB_H - PAD_TOP - PAD_BOT;
    return closes.map((c, index) => {
      const t = index / Math.max(1, closes.length - 1);
      const y = PAD_TOP + (1 - (c.close - min) / span) * plotH;
      return {
        date: c.date,
        close: c.close,
        x: PAD_X + t * (VB_W - PAD_X * 2),
        y,
      };
    });
  }, [data]);

  const trendColor = useMemo(() => {
    if (points.length < 2) return UP_COLOR;
    return points[points.length - 1].close >= points[0].close ? UP_COLOR : DOWN_COLOR;
  }, [points]);

  const changePct = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0].close;
    return first ? ((points[points.length - 1].close - first) / first) * 100 : null;
  }, [points]);

  const hover = hoverIndex != null ? points[hoverIndex] ?? null : null;
  const hoveredY = hover ? (hover.y / VB_H) * 100 : 0;
  // Near the top the tooltip would clip; below the pointer it goes instead.
  const tooltipFlipped = hoveredY < 24;

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = (e.clientX - rect.left) / rect.width;
    setHoverIndex(Math.max(0, Math.min(points.length - 1, Math.round(frac * (points.length - 1)))));
  };

  const handlePointerLeave = () => setHoverIndex(null);

  const renderSvg = points.length > 0;
  const firstLabel = renderSvg ? shortMonthDay(points[0].date) : '';
  const lastLabel = renderSvg ? shortMonthDay(points[points.length - 1].date) : '';

  return (
    <div className={styles['area-root']} style={{ height }}>
      <div
        className={styles['area-plot']}
        onPointerMove={renderSvg ? handlePointerMove : undefined}
        onPointerLeave={renderSvg ? handlePointerLeave : undefined}
        aria-hidden={!renderSvg}
      >
        {loading ? (
          <div className={styles['area-skel']} />
        ) : !renderSvg ? (
          <div className={styles['area-note']}>
            {error ? 'Chart unavailable — the candles feed is unreachable.' : 'No chart data yet.'}
          </div>
        ) : (
          <>
            <svg
              className={styles['area-svg']}
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${symbol} ${rangeLabel} area chart`}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity="0.30" />
                  <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d={
                  `M ${PAD_X} ${VB_H - PAD_BOT} ` +
                  points.map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') +
                  ` L ${VB_W - PAD_X} ${VB_H - PAD_BOT} Z`
                }
                fill={`url(#${gradientId})`}
                stroke="none"
              />
              <path
                d={points
                  .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
                  .join(' ')}
                fill="none"
                stroke={trendColor}
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            <span
              className={`${styles['area-badge']} ${changePct == null ? '' : changePct >= 0 ? 'is-up' : 'is-down'}`}
            >
              {rangeLabel} {changePct == null ? '' : `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
            </span>

            {/* Always-visible last-point dot: the chart's "now" anchor. */}
            <span
              className={styles['area-dot']}
              style={{
                left: `${(points[points.length - 1].x / VB_W) * 100}%`,
                top: `${(points[points.length - 1].y / VB_H) * 100}%`,
                background: trendColor,
              }}
            />

            {hover && (
              <>
                <span
                  className={styles['area-cross']}
                  style={{ left: `${(hover.x / VB_W) * 100}%` }}
                />
                <span
                  className={styles['area-dot']}
                  style={{
                    left: `${(hover.x / VB_W) * 100}%`,
                    top: `${hoveredY}%`,
                    background: trendColor,
                    width: 11,
                    height: 11,
                  }}
                />
                <span
                  className={styles['area-tip']}
                  style={
                    tooltipFlipped
                      ? { left: `${(hover.x / VB_W) * 100}%`, top: `${hoveredY}%`, transform: 'translate(-50%, 14px)' }
                      : { left: `${(hover.x / VB_W) * 100}%`, top: `${hoveredY}%` }
                  }
                >
                  <span className={styles['area-tip-date']}>{shortMonthDay(hover.date)}</span>
                  <span className={styles['area-tip-value']}>{hover.close.toFixed(2)}</span>
                </span>
              </>
            )}
          </>
        )}
      </div>
      <div className={styles['area-axis']}>
        <span>{firstLabel}</span>
        <span aria-hidden="true">{renderSvg ? rangeLabel : ''}</span>
        <span>{lastLabel}</span>
      </div>
    </div>
  );
}

export default AreaChart;

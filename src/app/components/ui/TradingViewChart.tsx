'use client';

import { useEffect, useRef, memo } from 'react';
import { toTradingViewSymbol } from '../../lib/tradingview-symbol';

export { toTradingViewSymbol } from '../../lib/tradingview-symbol';

export type TradingViewInterval =
  | '1'
  | '3'
  | '5'
  | '15'
  | '30'
  | '60'
  | '120'
  | '180'
  | '240'
  | 'D'
  | 'W'
  | 'M';

interface TradingViewChartProps {
  /** BOZ / Yahoo ticker (e.g. AAPL, BTC-USD, BBCA.JK) */
  symbol: string;
  /** Chart height in px (widget is autosize within the box) */
  height?: number;
  /** TradingView interval code */
  interval?: TradingViewInterval;
  /** Hide the top TF / indicator toolbar for a denser panel */
  hideTopToolbar?: boolean;
  /** Chart drawing style — TradingView style codes: 1=candles, 4=line, 5=area */
  style?: '1' | '4' | '5';
  className?: string;
}

/**
 * Free TradingView Advanced Chart embed — no API key, no login.
 * Data + chart UI come from TradingView; branding/copyright must stay visible.
 * @see https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/
 */
function TradingViewChart({
  symbol,
  height = 520,
  interval = 'D',
  hideTopToolbar = false,
  style = '1',
  className,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSymbol = toTradingViewSymbol(symbol);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !tvSymbol) return;

    // Full remount on symbol/interval change — the embed script only inits once.
    container.replaceChildren();

    const widgetHost = document.createElement('div');
    widgetHost.className = 'tradingview-widget-container__widget';
    widgetHost.style.height = '100%';
    widgetHost.style.width = '100%';
    container.appendChild(widgetHost);

    /* TradingView TOS requires attribution. Render it visibly but compactly
       (single line, smaller text, neutral colors) so it doesn't dominate. */
    const credit = document.createElement('div');
    credit.className = 'tradingview-widget-copyright tv-credit';
    const href = `https://www.tradingview.com/symbols/${encodeURIComponent(tvSymbol)}/`;
    const link = document.createElement('a');
    link.href = href;
    link.rel = 'noopener nofollow';
    link.target = '_blank';
    link.style.color = '#555';
    link.style.textDecoration = 'none';

    const symbolLabel = document.createElement('span');
    symbolLabel.style.color = '#888';
    symbolLabel.textContent = tvSymbol.replace(':', ' · ');
    link.appendChild(symbolLabel);

    const attribution = document.createElement('span');
    attribution.style.color = '#444';
    attribution.style.marginLeft = '6px';
    attribution.textContent = 'chart by TradingView';
    credit.append(link, attribution);
    container.appendChild(credit);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval,
      timezone: 'exchange',
      theme: 'dark',
      style,
      locale: 'en',
      backgroundColor: '#000000',
      gridColor: '#1a1a1a',
      hide_top_toolbar: false,
      hide_legend: false,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      save_image: true,
      calendar: false,
      details: false,
      hotlist: false,
      withdateranges: true,
      support_host: 'https://www.tradingview.com',

      // Custom candle colors (BOZ palette)
      up_color: '#00c853',
      down_color: '#d50000',
      border_up_color: '#00c853',
      border_down_color: '#d50000',
      wick_up_color: '#00c853',
      wick_down_color: '#d50000',

      // Technical studies — overlays rendered on the chart
      studies: [
        'MASimple@tv-basicstudies',
        'MAExp@tv-basicstudies',
        'Volume@tv-basicstudies',
        'RSI@tv-basicstudies',
      ],

      // Comparison symbols rendered as thin overlay lines
      compare_symbols: ['NASDAQ:QQQ', 'AMEX:SPY'],

      // Timeframes available in the chart toolbar
      time_frames: [
        { text: '1D', resolution: 'D', description: '1 Day' },
        { text: '5D', resolution: '5D', description: '5 Days' },
        { text: '1W', resolution: 'W', description: '1 Week' },
        { text: '1M', resolution: 'M', description: '1 Month' },
        { text: '3M', resolution: '3M', description: '3 Months' },
        { text: '6M', resolution: '6M', description: '6 Months' },
        { text: '1Y', resolution: '12M', description: '1 Year' },
      ],
    });
    container.appendChild(script);

    return () => {
      container.replaceChildren();
    };
  }, [tvSymbol, interval, hideTopToolbar, style]);

  return (
    <div
      className={`tradingview-widget-container tv-chart-host${className ? ` ${className}` : ''}`}
      ref={containerRef}
      style={{ height, width: '100%', position: 'relative' }}
      data-tv-symbol={tvSymbol}
      aria-label={`TradingView chart for ${tvSymbol}`}
    />
  );
}

export default memo(TradingViewChart);

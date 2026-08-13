'use client';

import { useEffect, useRef, memo } from 'react';

/**
 * Map Yahoo/BOZ tickers → TradingView EXCHANGE:SYMBOL form when we can.
 * Bare symbols still work for many US equities (TV auto-resolves).
 */
export function toTradingViewSymbol(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  if (!raw) return 'NASDAQ:AAPL';

  // Already prefixed (NASDAQ:AAPL, BINANCE:BTCUSDT, …)
  if (raw.includes(':')) return raw;

  // Crypto — Yahoo style BTC-USD / ETH-USDT
  const cryptoDash = raw.match(/^([A-Z0-9]{2,10})-(USD|USDT|EUR|BTC)$/);
  if (cryptoDash) {
    const [, base, quote] = cryptoDash;
    if (quote === 'USDT') return `BINANCE:${base}USDT`;
    if (quote === 'USD') return `BINANCE:${base}USDT`;
    if (quote === 'EUR') return `BINANCE:${base}EUR`;
    if (quote === 'BTC') return `BINANCE:${base}BTC`;
  }

  // Compact crypto (BTCUSD)
  if (/^(BTC|ETH|SOL|XRP|DOGE|ADA|AVAX|DOT|LINK|MATIC|BNB)USD$/.test(raw)) {
    return `BINANCE:${raw.replace(/USD$/, 'USDT')}`;
  }

  // Indonesia (Yahoo: BBCA.JK)
  if (raw.endsWith('.JK')) {
    return `IDX:${raw.slice(0, -3)}`;
  }

  // Common index aliases
  const indices: Record<string, string> = {
    SPX: 'SP:SPX',
    '^GSPC': 'SP:SPX',
    NDX: 'NASDAQ:NDX',
    '^IXIC': 'NASDAQ:IXIC',
    DJI: 'DJ:DJI',
    '^DJI': 'DJ:DJI',
    VIX: 'CBOE:VIX',
    '^VIX': 'CBOE:VIX',
    DXY: 'TVC:DXY',
    GOLD: 'TVC:GOLD',
    WTI: 'TVC:USOIL',
  };
  if (indices[raw]) return indices[raw];

  // ETFs / futures-ish aliases used on the tape
  if (raw === 'BRK.B') return 'NYSE:BRK.B';

  return raw;
}

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
    container.innerHTML = '';

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
    credit.innerHTML =
      `<a href="${href}" rel="noopener nofollow" target="_blank" style="color:#555;text-decoration:none;">` +
      `<span style="color:#888">${tvSymbol.replace(':', ' · ')}</span></a>` +
      `<span style="color:#444;margin-left:6px;">chart by TradingView</span>`;
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
        'MAExp@tv-basicstudies',
        'MAExp@tv-basicstudies',
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
      container.innerHTML = '';
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

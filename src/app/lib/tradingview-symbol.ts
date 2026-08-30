const DEFAULT_TRADINGVIEW_SYMBOL = 'NASDAQ:AAPL';
const PREFIXED_SYMBOL = /^[A-Z0-9._^-]{1,24}:[A-Z0-9._^-]{1,40}$/;
const BARE_SYMBOL = /^[A-Z0-9._^-]{1,40}$/;

/**
 * Map a BOZ/Yahoo ticker into TradingView's EXCHANGE:SYMBOL form.
 * The returned value is restricted to TradingView symbol characters so it is
 * safe to use in DOM text and URL path construction.
 */
export function toTradingViewSymbol(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  if (!raw) return DEFAULT_TRADINGVIEW_SYMBOL;

  if (PREFIXED_SYMBOL.test(raw)) return raw;
  if (raw.includes(':') || !BARE_SYMBOL.test(raw)) return DEFAULT_TRADINGVIEW_SYMBOL;

  const cryptoDash = raw.match(/^([A-Z0-9]{2,10})-(USD|USDT|EUR|BTC)$/);
  if (cryptoDash) {
    const [, base, quote] = cryptoDash;
    if (quote === 'USDT' || quote === 'USD') return `BINANCE:${base}USDT`;
    if (quote === 'EUR') return `BINANCE:${base}EUR`;
    if (quote === 'BTC') return `BINANCE:${base}BTC`;
  }

  if (/^(BTC|ETH|SOL|XRP|DOGE|ADA|AVAX|DOT|LINK|MATIC|BNB)USD$/.test(raw)) {
    return `BINANCE:${raw.replace(/USD$/, 'USDT')}`;
  }

  if (raw.endsWith('.JK')) return `IDX:${raw.slice(0, -3)}`;

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

  if (raw === 'BRK.B') return 'NYSE:BRK.B';
  return raw;
}

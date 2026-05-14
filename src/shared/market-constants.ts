// ─── shared/market-constants.ts ───────────────────────────────────────────────
// Single source of truth for asset → ticker resolution and late-entry keywords.
// Import from here in any analyzer, agent, or service that needs these.

export const SYMBOL_MAP: Record<string, string> = {
  // Indices
  'SP500': '^GSPC', 'S&P500': '^GSPC', 'S&P 500': '^GSPC', 'SPX': '^GSPC', 'SPY': 'SPY',
  'NASDAQ': '^IXIC', 'QQQ': 'QQQ', 'DOW': '^DJI', 'DJI': '^DJI',
  // Forex / macro
  'DXY': 'DX-Y.NYB', 'DOLLAR': 'DX-Y.NYB',
  'EURUSD': 'EURUSD=X', 'USDJPY': 'JPY=X', 'GBPUSD': 'GBPUSD=X',
  'AUDUSD': 'AUDUSD=X', 'USDCAD': 'CAD=X', 'USDCHF': 'CHF=X',
  // Bonds
  'TLT': 'TLT', 'TNX': '^TNX', '10Y': '^TNX', 'US10Y': '^TNX',
  // Commodities
  'GOLD': 'GC=F', 'XAU': 'GC=F', 'XAUUSD': 'GC=F',
  'SILVER': 'SI=F', 'XAG': 'SI=F',
  'OIL': 'CL=F', 'WTI': 'CL=F', 'USOIL': 'CL=F', 'CRUDE': 'CL=F',
  'BRENT': 'BZ=F', 'NATGAS': 'NG=F',
  'COPPER': 'HG=F', 'WHEAT': 'ZW=F', 'CORN': 'ZC=F',
  // Crypto
  'BTC': 'BTC-USD', 'BITCOIN': 'BTC-USD',
  'ETH': 'ETH-USD', 'ETHEREUM': 'ETH-USD',
  'SOL': 'SOL-USD', 'SOLANA': 'SOL-USD',
  'XRP': 'XRP-USD', 'RIPPLE': 'XRP-USD',
  'BNB': 'BNB-USD', 'ADA': 'ADA-USD',
  'DOGE': 'DOGE-USD', 'DOGECOIN': 'DOGE-USD',
  'AVAX': 'AVAX-USD', 'DOT': 'DOT-USD',
  'MATIC': 'MATIC-USD', 'LINK': 'LINK-USD',
  'UNI': 'UNI-USD', 'ATOM': 'ATOM-USD',
  // Mega-cap stocks
  'NVDA': 'NVDA', 'NVIDIA': 'NVDA',
  'AAPL': 'AAPL', 'APPLE': 'AAPL',
  'MSFT': 'MSFT', 'MICROSOFT': 'MSFT',
  'GOOGL': 'GOOGL', 'GOOGLE': 'GOOGL', 'ALPHABET': 'GOOGL',
  'META': 'META', 'AMZN': 'AMZN', 'AMAZON': 'AMZN',
  'TSLA': 'TSLA', 'TESLA': 'TSLA',
  'AMD': 'AMD', 'INTC': 'INTC', 'INTEL': 'INTC',
  'NFLX': 'NFLX', 'NETFLIX': 'NFLX',
  'JPM': 'JPM', 'BAC': 'BAC', 'GS': 'GS',
};

const SOCIAL_SEARCH_ALIASES: Record<string, string[]> = {
  'BTC-USD': ['BTC', 'Bitcoin', '$BTC'],
  'ETH-USD': ['ETH', 'Ethereum', '$ETH'],
  'SOL-USD': ['SOL', 'Solana', '$SOL'],
  'XRP-USD': ['XRP', 'Ripple', '$XRP'],
  'BNB-USD': ['BNB', '$BNB'],
  'ADA-USD': ['ADA', '$ADA'],
  'DOGE-USD': ['DOGE', 'Dogecoin', '$DOGE'],
  'AVAX-USD': ['AVAX', '$AVAX'],
  'DOT-USD': ['DOT', '$DOT'],
  'MATIC-USD': ['MATIC', '$MATIC'],
  'LINK-USD': ['LINK', 'Chainlink', '$LINK'],
  'UNI-USD': ['UNI', 'Uniswap', '$UNI'],
  'ATOM-USD': ['ATOM', 'Cosmos', '$ATOM'],
};

export const LATE_KEYWORDS: string[] = [
  'already surged', 'soared', 'spiked', 'record high', 'all-time high',
  'all time high', 'ath', 'parabolic', 'overbought', 'extended move',
  'blew past', 'blew through', 'broke out', 'exploded higher',
];

/** Resolve a free-text asset name / ticker to a Yahoo Finance symbol.
 *  Returns null if the input cannot be mapped to anything usable. */
export function resolveSymbol(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  if (SYMBOL_MAP[upper]) return SYMBOL_MAP[upper];
  if (/^[A-Z]{1,5}$/.test(upper)) return upper; // common stock / ETF ticker
  if (/^\^[A-Z0-9]{1,10}$/.test(upper)) return upper; // Yahoo index symbol
  if (/^[A-Z0-9]{1,10}(?:[.\-=][A-Z0-9]{1,8})+$/.test(upper)) return upper; // Yahoo symbol with suffix/pair
  return null;
}

/** Convert a Yahoo Finance symbol into the symbol format used by StockTwits.
 *  Returns null for Yahoo-only instruments that do not have a reliable stream. */
export function resolveStockTwitsSymbol(raw: string): string | null {
  const symbol = resolveSymbol(raw) ?? raw.trim().toUpperCase();
  const cryptoBase = symbol.match(/^([A-Z0-9]{2,10})-USD$/)?.[1];
  if (cryptoBase) return `${cryptoBase}.X`;
  if (/^[A-Z]{1,5}$/.test(symbol)) return symbol;
  return null;
}

/** Build a compact Reddit search query from a Yahoo Finance symbol. */
export function buildSocialSearchQuery(raw: string): string {
  const symbol = resolveSymbol(raw) ?? raw.trim().toUpperCase();
  const aliases = SOCIAL_SEARCH_ALIASES[symbol];
  if (aliases) return aliases.join(' OR ');

  const stockTwitsSymbol = resolveStockTwitsSymbol(symbol);
  if (stockTwitsSymbol) {
    const cashtag = stockTwitsSymbol.replace(/\.X$/, '');
    return `${cashtag} OR $${cashtag}`;
  }

  return symbol;
}

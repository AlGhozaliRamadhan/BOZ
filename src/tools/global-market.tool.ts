import { newsFetchService } from '../services/news/news.fetch.service.js';
import { SentimentService } from '../services/market/sentiment.service.js';
import { executeFetchPrice } from './ticker.tool.js';

export const GLOBAL_MARKET_SNAPSHOT_BUCKETS = [
  {
    label: 'Equities',
    symbols: ['SPY', 'QQQ', 'ACWI', 'EFA', 'EEM'],
  },
  {
    label: 'Rates and credit',
    symbols: ['IEF', 'TLT', 'BNDX', 'HYG', 'EMB'],
  },
  {
    label: 'Macro risk signals',
    symbols: ['^VIX', '^TNX', 'UUP', 'GC=F', 'CL=F'],
  },
] as const;

export const fetchGlobalMarketSnapshotDefinition = {
  type: 'function' as const,
  function: {
    name: 'fetch_global_market_snapshot',
    description: [
      'Fetch a broad, current global-market snapshot for global outlook questions.',
      'Covers US, developed ex-US, and emerging-market equities; US, international, and emerging-market bonds and credit;',
      'plus volatility, the US 10-year yield, a US-dollar proxy, gold, oil, global crowd sentiment, and macro headlines.',
      'Use this before answering a question about global equities, bonds, or macro regimes.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

export function isGlobalMarketOutlookRequest(message: string): boolean {
  const text = message.toLowerCase();
  return (
    /\bglobal\s+(market|macro|outlook)\b/.test(text) ||
    (/\b(equities|stocks)\b/.test(text) &&
      /\b(bonds|rates|treasur)/.test(text) &&
      /\b(macro|regime)\b/.test(text))
  );
}

export async function executeFetchGlobalMarketSnapshot(): Promise<string> {
  const symbols = GLOBAL_MARKET_SNAPSHOT_BUCKETS.flatMap(bucket => bucket.symbols);
  const [prices, sentiment, macroNews, broadNews] = await Promise.all([
    Promise.all(symbols.map(symbol => executeFetchPrice(symbol))),
    new SentimentService().fetchCrowdSentiment().catch(() => null),
    newsFetchService.fetchMacroNews().catch(() => []),
    newsFetchService.fetchBroadMarketNews().catch(() => []),
  ]);

  let priceOffset = 0;
  const marketSections = GLOBAL_MARKET_SNAPSHOT_BUCKETS.map(bucket => {
    const rows = prices.slice(priceOffset, priceOffset + bucket.symbols.length);
    priceOffset += bucket.symbols.length;
    return `=== ${bucket.label.toUpperCase()} ===\n${rows.join('\n\n')}`;
  });

  const headlines = [...macroNews, ...broadNews]
    .slice(0, 6)
    .map(item => `- ${item.title ?? 'Untitled market headline'}${item.source ? ` [${item.source}]` : ''}`);
  const fearGreed = sentiment?.fear_greed;
  const overallSignals = sentiment?.summary?.overall_signals ?? [];

  return [
    '=== GLOBAL MARKET SNAPSHOT ===',
    'Coverage: US / developed ex-US / emerging equities; US, international, and emerging-market bonds and credit; volatility, rates, USD, gold, and oil.',
    ...marketSections,
    '=== GLOBAL RISK SENTIMENT ===',
    `CNN Fear & Greed: ${fearGreed?.value ?? 'unavailable'} (${fearGreed?.label ?? 'unavailable'})`,
    `Signals: ${overallSignals.length ? overallSignals.join('; ') : 'unavailable'}`,
    '=== MACRO HEADLINES ===',
    headlines.length ? headlines.join('\n') : 'No macro headlines returned.',
  ].join('\n\n');
}

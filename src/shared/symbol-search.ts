// ─── shared/symbol-search.ts ───────────────────────────────────────────────────
// Market classification, exact-symbol probing, ranking and paging for the
// symbol search. Pure — no DOM, no I/O — so the search API, the search service
// and all three picker UIs share one definition of "which market is this".
//
// Why this module exists: Yahoo's /v1/finance/search is relevance ranked and
// knows very little about IDX small caps or crypto pairs, so the old UI path
// (fetch → `slice(0, 6)`) regularly dropped the symbol the user actually wanted
// and the dropdown simply stopped. Search now merges Yahoo with BOZ's own
// universes and verifies exact-symbol guesses against the quote endpoint, so
// results are both wider and proven to exist.

import { SYMBOL_MAP } from './market-constants.js';

export type SymbolMarket = 'us' | 'idx' | 'crypto' | 'index' | 'macro' | 'other';

export type SymbolMarketFilter = 'all' | Exclude<SymbolMarket, 'other'>;

export const SYMBOL_MARKET_FILTERS: readonly SymbolMarketFilter[] = ['all', 'us', 'idx', 'crypto', 'index', 'macro'];

export const SYMBOL_MARKET_LABEL: Record<SymbolMarket, string> = {
  us: 'US',
  idx: 'IDX',
  crypto: 'CRYPTO',
  index: 'INDEX',
  macro: 'MACRO',
  other: '—',
};

/** Where a hit came from. `probe` ranks highest: it is quote-verified. */
export type SymbolSource = 'yahoo' | 'boz' | 'probe';

export interface SymbolSearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  market: SymbolMarket;
  source: SymbolSource;
}

export interface SymbolSearchPage {
  query: string;
  results: SymbolSearchHit[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const SYMBOL_SEARCH_DEFAULT_LIMIT = 8;
export const SYMBOL_SEARCH_MAX_LIMIT = 25;
export const SYMBOL_SEARCH_MAX_QUERY_LENGTH = 64;
export const MAX_SYMBOL_PROBES = 4;

const SOURCE_RANK: Record<SymbolSource, number> = { boz: 1, yahoo: 2, probe: 3 };

/** Quote suffixes that mean "priced in a currency", i.e. a crypto pair.
 *  Deliberately explicit rather than a loose `-XXX` regex: US tickers like
 *  `BRK-B` and `RDS-PD` also contain a dash. */
const CURRENCY_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'HKD', 'NZD', 'SGD',
  'SEK', 'NOK', 'DKK', 'INR', 'KRW', 'BRL', 'MXN', 'ZAR', 'TRY', 'RUB', 'IDR',
  'PHP', 'THB', 'VND', 'PLN', 'CZK', 'HUF', 'ILS', 'AED', 'SAR', 'NGN', 'ARS',
  'CLP', 'COP', 'PEN', 'TWD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'DAI',
]);

const INDONESIA_HINTS = ['JAKARTA', 'INDONESIA', 'INDONESIAN', 'IDX'];

function isCryptoPair(symbol: string): boolean {
  const match = /^([A-Z0-9]{1,10})-([A-Z]{3,6})$/.exec(symbol);
  return !!match && CURRENCY_CODES.has(match[2]);
}

function isIndonesianExchange(exchange?: string | null): boolean {
  const value = (exchange ?? '').toUpperCase();
  return value !== '' && INDONESIA_HINTS.some(hint => value.includes(hint));
}

/**
 * Decide which market a symbol belongs to.
 *
 * Yahoo's own `quoteType` wins when present; otherwise the symbol shape decides,
 * so classification still works for the rows that omit it. Equities fall back to
 * the exchange, which is the only thing separating IDX from US listings.
 */
export function classifySymbolMarket(
  symbol: string,
  quoteType?: string | null,
  exchange?: string | null,
): SymbolMarket {
  const sym = (symbol ?? '').trim().toUpperCase();
  const type = (quoteType ?? '').trim().toUpperCase();

  if (type === 'CRYPTOCURRENCY') return 'crypto';
  if (type === 'INDEX') return 'index';
  if (type === 'CURRENCY' || type === 'FUTURE' || type === 'FUTUREOPTION') return 'macro';

  if (sym.endsWith('.JK')) return 'idx';
  if (sym.startsWith('^')) return 'index';
  if (isCryptoPair(sym)) return 'crypto';
  // Futures end in a contract month (GC=F, CL=F); FX pairs are bare (EURUSD=X).
  if (/=[A-Z]$/.test(sym)) return 'macro';

  if (isIndonesianExchange(exchange)) return 'idx';
  if (type === 'EQUITY' || type === 'ETF' || type === 'MUTUALFUND' || type === 'OPTION') return 'us';

  // A bare, suffix-less, untyped symbol: BOZ resolves those as US tickers.
  return type ? 'other' : 'us';
}

/**
 * Exact-symbol guesses worth verifying against the quote endpoint.
 *
 * A curated alias comes first (BTC → BTC-USD, IHSG → ^JKSE), then the literal
 * symbol, then the IDX and crypto spellings of a bare code. Probing is what
 * turns "probably exists" into "confirmed to exist", which is the whole point —
 * Yahoo's search often omits the one symbol the user typed.
 */
export function buildSymbolProbes(rawQuery: string): string[] {
  const upper = (rawQuery ?? '').trim().toUpperCase();
  if (!upper) return [];

  const probes: string[] = [];
  const push = (candidate: string): void => {
    if (candidate && !probes.includes(candidate) && probes.length < MAX_SYMBOL_PROBES) probes.push(candidate);
  };

  const mapped = SYMBOL_MAP[upper];
  if (mapped) push(mapped);

  if (/^[A-Z0-9]{1,10}$/.test(upper)) {
    push(upper);
    push(`${upper}.JK`);
    push(`${upper}-USD`);
  } else if (/^[A-Z]{1,10}\.[A-Z]{2,4}$/.test(upper)) {
    push(upper);
  } else if (/^\^[A-Z0-9]{1,10}$/.test(upper)) {
    push(upper);
  } else if (/^[A-Z0-9]{1,10}(?:[=-][A-Z0-9]{1,6})+$/.test(upper)) {
    push(upper);
  }

  return probes;
}

function hitScore(hit: SymbolSearchHit, query: string): number {
  const symbol = hit.symbol;
  const base = symbol.split(/[.=^]/)[0].split('-')[0] ?? symbol;
  let score = SOURCE_RANK[hit.source] ?? 0;

  if (symbol === query) score += 1000;
  else if (SYMBOL_MAP[query] === symbol) score += 900;
  else if (base === query) score += 600;
  else if (symbol.startsWith(query)) score += 400;
  else if (base.startsWith(query)) score += 300;

  const name = hit.name.toUpperCase();
  if (name === query) score += 200;
  else if (name.startsWith(query)) score += 120;
  else if (name.includes(query)) score += 40;

  // Shorter symbols are nearly always the primary listing.
  return score + Math.max(0, 12 - symbol.length);
}

/**
 * Collapse duplicate symbols and order by how likely each hit is to be the one
 * the user meant. Later hits only fill in blanks — they never overwrite a
 * resolved name, so a bare universe row cannot downgrade a quote-verified hit.
 */
export function rankSymbolHits(hits: SymbolSearchHit[], rawQuery: string): SymbolSearchHit[] {
  const query = (rawQuery ?? '').trim().toUpperCase();
  const merged = new Map<string, SymbolSearchHit>();

  for (const candidate of hits) {
    const symbol = (candidate?.symbol ?? '').trim().toUpperCase();
    if (!symbol) continue;

    const next: SymbolSearchHit = {
      symbol,
      name: (candidate.name ?? '').trim() || symbol,
      exchange: (candidate.exchange ?? '').trim(),
      type: (candidate.type ?? '').trim(),
      market: candidate.market ?? 'other',
      source: candidate.source ?? 'yahoo',
    };

    const previous = merged.get(symbol);
    if (!previous) {
      merged.set(symbol, next);
      continue;
    }

    merged.set(symbol, {
      ...previous,
      name: previous.name === previous.symbol && next.name !== next.symbol ? next.name : previous.name,
      exchange: previous.exchange || next.exchange,
      type: previous.type || next.type,
      market: previous.market === 'other' ? next.market : previous.market,
      source: (SOURCE_RANK[next.source] ?? 0) > (SOURCE_RANK[previous.source] ?? 0) ? next.source : previous.source,
    });
  }

  return [...merged.values()]
    .map(hit => ({ hit, score: hitScore(hit, query) }))
    .sort((a, b) => (b.score - a.score) || a.hit.symbol.localeCompare(b.hit.symbol))
    .map(entry => entry.hit);
}

export function filterHitsByMarket(hits: SymbolSearchHit[], market: SymbolMarketFilter): SymbolSearchHit[] {
  if (!market || market === 'all') return hits;
  return hits.filter(hit => hit.market === market);
}

export function paginateHits(hits: SymbolSearchHit[], limit: number, offset: number): Omit<SymbolSearchPage, 'query'> {
  const total = hits.length;
  const size = clampSearchLimit(limit);
  const start = Math.max(0, Math.floor(offset) || 0);
  const results = hits.slice(start, start + size);
  return { results, total, limit: size, offset: start, hasMore: start + results.length < total };
}

export function clampSearchLimit(raw: unknown): number {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value < 1) return SYMBOL_SEARCH_DEFAULT_LIMIT;
  return Math.min(value, SYMBOL_SEARCH_MAX_LIMIT);
}

export function clampSearchOffset(raw: unknown): number {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

export function normalizeSymbolQuery(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').trim().slice(0, SYMBOL_SEARCH_MAX_QUERY_LENGTH);
}

export function parseSymbolMarketFilter(raw: unknown): SymbolMarketFilter {
  const value = (typeof raw === 'string' ? raw : '').trim().toLowerCase();
  return (SYMBOL_MARKET_FILTERS as readonly string[]).includes(value) ? (value as SymbolMarketFilter) : 'all';
}
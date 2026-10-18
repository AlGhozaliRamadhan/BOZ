// ─── services/market/symbol-search.service.ts ─────────────────────────────────
// Server-side symbol search.
//
// Yahoo's relevance-ranked search is the only source that knows company names
// at arbitrary depth, but it is weak exactly where BOZ's users look: IDX small
// caps and crypto pairs. So we merge three sources and rank the union —
//
//   1. Yahoo `/v1/finance/search` — names and aliases, relevance ordered.
//   2. BOZ's own universes        — curated crypto/US lists plus SYMBOL_MAP.
//   3. Exact-symbol probes        — the literal symbol is verified against the
//                                   quote endpoint, so a bare `BBCA` or `BTC`
//                                   is confirmed to exist before it is shown.
//
// Results are cached per query because a picker fires one request per keystroke.

import { yahooFinance } from './yahoo.service.js';
import { idxUniverseService } from './idx.universe.service.js';
import { globalUniverseService } from './global.universe.service.js';
import { SYMBOL_MAP } from '../../shared/market-constants.js';
import {
  buildSymbolProbes,
  classifySymbolMarket,
  clampSearchLimit,
  clampSearchOffset,
  filterHitsByMarket,
  normalizeSymbolQuery,
  paginateHits,
  rankSymbolHits,
  type SymbolMarketFilter,
  type SymbolSearchHit,
  type SymbolSearchPage,
  type SymbolSource,
} from '../../shared/symbol-search.js';
import { log } from '../../utils/logger.js';

const SEARCH_CACHE_TTL_MS = 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 64;
const YAHOO_SEARCH_HIT_CAP = 25;
/** The IDX universe can hit GitHub on a cold cache; never let it hold up search. */
const IDX_UNIVERSE_BUDGET_MS = 1_500;

const QUOTE_FIELDS = [
  'symbol', 'shortName', 'longName', 'regularMarketPrice',
  'fullExchangeName', 'exchange', 'quoteType',
] as unknown as string[];

interface CacheEntry {
  hits: SymbolSearchHit[];
  fetchedAt: number;
}

/** Structural shape shared by the IDX and global universe rows. */
interface UniverseEntry {
  ticker: string;
  name: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export interface SymbolSearchOptions {
  limit?: unknown;
  offset?: unknown;
  market?: SymbolMarketFilter;
}

/** Race `work` against a deadline without leaking the timer or an unhandled rejection. */
async function withBudget<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class SymbolSearchService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<SymbolSearchHit[]>>();
  private idxStocks: UniverseEntry[] | null = null;
  private idxPending: Promise<UniverseEntry[]> | null = null;

  async search(rawQuery: string, options: SymbolSearchOptions = {}): Promise<SymbolSearchPage> {
    const query = normalizeSymbolQuery(rawQuery);
    const limit = clampSearchLimit(options.limit);
    const offset = clampSearchOffset(options.offset);

    if (!query) {
      return { query: '', results: [], total: 0, limit, offset: 0, hasMore: false };
    }

    const ranked = rankSymbolHits(await this.collect(query), query);
    const filtered = filterHitsByMarket(ranked, options.market ?? 'all');
    return { query, ...paginateHits(filtered, limit, offset) };
  }

  // ── Cache + request coalescing ─────────────────────────────────────────────

  private readCache(query: string): SymbolSearchHit[] | null {
    const entry = this.cache.get(query);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > SEARCH_CACHE_TTL_MS) {
      this.cache.delete(query);
      return null;
    }
    return entry.hits;
  }

  private writeCache(query: string, hits: SymbolSearchHit[]): void {
    // Re-insert so Map iteration order doubles as recency for FIFO eviction.
    this.cache.delete(query);
    while (this.cache.size >= SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.cache.set(query, { hits, fetchedAt: Date.now() });
  }

  private collect(query: string): Promise<SymbolSearchHit[]> {
    const cached = this.readCache(query);
    if (cached) return Promise.resolve(cached);

    const pending = this.inflight.get(query);
    if (pending) return pending;

    const work = this.gather(query)
      .then(hits => {
        this.writeCache(query, hits);
        return hits;
      })
      .finally(() => {
        this.inflight.delete(query);
      });

    this.inflight.set(query, work);
    return work;
  }

  private async gather(query: string): Promise<SymbolSearchHit[]> {
    const [yahoo, probes, curated] = await Promise.all([
      this.fromYahooSearch(query),
      this.fromExactSymbolProbes(query),
      this.fromBozUniverses(query),
    ]);
    return [...yahoo, ...probes, ...curated];
  }

  // ── Sources ────────────────────────────────────────────────────────────────

  private toHit(
    symbol: unknown,
    name: unknown,
    exchange: unknown,
    quoteType: unknown,
    source: SymbolSource,
  ): SymbolSearchHit {
    const sym = String(symbol ?? '').trim().toUpperCase();
    const cleanExchange = String(exchange ?? '').trim();
    const cleanType = String(quoteType ?? '').trim().toUpperCase();
    return {
      symbol: sym,
      name: String(name ?? '').trim() || sym,
      exchange: cleanExchange,
      type: cleanType,
      market: classifySymbolMarket(sym, cleanType, cleanExchange),
      source,
    };
  }

  private async fromYahooSearch(query: string): Promise<SymbolSearchHit[]> {
    try {
      // Schema validation stays off: Yahoo's payload drifts and a crash here
      // costs the user every result they typed a character for.
      const response = await yahooFinance.search(query, {}, { validateResult: false } as never) as unknown;
      const quotes = asRecord(response)?.quotes;

      if (!Array.isArray(quotes)) return [];

      const hits: SymbolSearchHit[] = [];
      for (const raw of quotes) {
        if (hits.length >= YAHOO_SEARCH_HIT_CAP) break;
        const quote = asRecord(raw);
        if (typeof quote?.symbol !== 'string') continue;
        hits.push(this.toHit(
          quote.symbol,
          quote.shortname ?? quote.longname,
          quote.exchDisp ?? quote.exchange,
          quote.quoteType,
          'yahoo',
        ));
      }
      return hits;
    } catch (error) {
      log.warn('symbol-search', `Yahoo search failed for "${query}": ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Verify the literal symbol. This is what rescues the IDX small caps and
   * crypto pairs that Yahoo's relevance ranking leaves out — and what stops a
   * guessed-but-nonexistent symbol from being offered.
   */
  private async fromExactSymbolProbes(query: string): Promise<SymbolSearchHit[]> {
    const probes = buildSymbolProbes(query);
    if (probes.length === 0) return [];

    try {
      // Validation is a module option (the `return: 'array'` query schema
      // rejects unknown keys). Without it, probing a commodity or FX symbol
      // fails the whole batch and every probe is lost.
      const response = await yahooFinance.quote(
        probes,
        { return: 'array', fields: QUOTE_FIELDS } as never,
        { validateResult: false },
      ) as unknown;

      if (!Array.isArray(response)) return [];

      const hits: SymbolSearchHit[] = [];
      for (const raw of response) {
        const quote = asRecord(raw);
        if (typeof quote?.symbol !== 'string') continue;
        // Yahoo omits unknown symbols from the array, but a bare echo with no
        // price and no name is not a usable row either.
        const priced = quote.regularMarketPrice != null;
        if (!priced && !quote.shortName && !quote.longName) continue;
        hits.push(this.toHit(
          quote.symbol,
          quote.longName ?? quote.shortName,
          quote.fullExchangeName ?? quote.exchange,
          quote.quoteType,
          'probe',
        ));
      }
      return hits;
    } catch (error) {
      log.warn('symbol-search', `Symbol probe failed for "${query}": ${(error as Error).message}`);
      return [];
    }
  }

  private async fromBozUniverses(query: string): Promise<SymbolSearchHit[]> {
    const upper = query.toUpperCase();
    const terms = upper.split(/[\s.]+/).filter(Boolean);
    const seen = new Set<string>();
    const hits: SymbolSearchHit[] = [];

    const add = (ticker: string, name: string, exchange: string): void => {
      const symbol = ticker.trim().toUpperCase();
      if (!symbol || seen.has(symbol)) return;
      const label = name.trim().toUpperCase();
      const matches =
        symbol === upper ||
        label === upper ||
        symbol.startsWith(upper) ||
        label.startsWith(upper) ||
        (terms.length > 1 && terms.every(term => symbol.includes(term) || label.includes(term)));
      if (!matches) return;
      seen.add(symbol);
      hits.push(this.toHit(symbol, name, exchange, undefined, 'boz'));
    };

    // Curated aliases — always resident, so these never cost a fetch.
    for (const [alias, symbol] of Object.entries(SYMBOL_MAP)) {
      const aliasUpper = alias.toUpperCase();
      if (aliasUpper.startsWith(upper) || symbol.toUpperCase().startsWith(upper)) {
        add(symbol, aliasUpper, '');
      }
    }

    for (const stock of [...await globalUniverseService.getUsUniverse(), ...await globalUniverseService.getCryptoUniverse()]) {
      add(stock.ticker, stock.name, '');
    }

    for (const stock of await this.idxUniverse()) {
      add(stock.ticker, stock.name, 'IDX');
    }

    return hits;
  }

  /**
   * The 24h-cached IDX universe, behind a deadline. A cold cache fetches from
   * GitHub, which must not stall a keystroke-driven search — the probe path
   * already covers common IDX codes, so skipping it here costs nothing visible.
   */
  private idxUniverse(): Promise<UniverseEntry[]> {
    if (this.idxStocks) return Promise.resolve(this.idxStocks);

    const pending = this.idxPending ?? (this.idxPending = idxUniverseService.getUniverse()
      .then(stocks => {
        this.idxStocks = stocks;
        return stocks;
      })
      .catch((error: unknown) => {
        log.warn('symbol-search', `IDX universe unavailable for search: ${(error as Error).message}`);
        return [] as UniverseEntry[];
      })
      .finally(() => {
        this.idxPending = null;
      }));

    return withBudget(pending, IDX_UNIVERSE_BUDGET_MS, [] as UniverseEntry[]);
  }
}

export const symbolSearchService = new SymbolSearchService();
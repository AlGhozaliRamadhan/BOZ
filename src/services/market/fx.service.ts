// ─── services/market/fx.service.ts ────────────────────────────────────────────
// FX data layer. Yahoo Finance is the default provider: delayed and indicative,
// but it covers majors, crosses and the Asian units in one batched call and it
// is the same source the rest of BOZ already trusts.
//
// Two provider quirks are handled here rather than in every caller:
//   · FX quotes carry no volume, so `volume` is normalised to null instead of 0
//     (0 makes downstream volume indicators fire on a fabricated reading).
//   · Yahoo's daily FX series often opens with a partial Sunday bar. It is
//     dropped before indicators so the first real Monday session is not
//     compared against a two-hour stub.

import { YahooService, yahooFinance } from './yahoo.service.js';
import type { Candle } from '../../types/types.js';
import {
  FX_PAIRS,
  fxMarketStatus,
  parseFxSymbol,
  type FxMarketStatus,
  type FxPair,
  type FxPairClass,
} from '../../shared/fx.js';
import { log } from '../../utils/logger.js';

const QUOTE_CHUNK = 20;
const BOARD_TTL_MS = 60_000;
/** Yahoo's own dollar index proxy. Not a tradeable pair, so it stays separate. */
const DXY_SYMBOL = 'DX-Y.NYB';

export interface FxBoardRow {
  /** Canonical Yahoo symbol, e.g. `EURUSD=X`. */
  ticker: string;
  code: string;
  pair: string;
  name: string;
  class: FxPairClass;
  precision: number;
  pipSize: number;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  changePips: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  bid: number | null;
  ask: number | null;
  spreadPips: number | null;
  marketState: string | null;
  updatedAt: number | null;
}

export interface FxContext {
  pair: FxPair;
  sessions: FxMarketStatus;
  /** Pair code → rate, usable by fxRiskCalc for account-currency conversion. */
  rates: Record<string, number>;
  dxy: { price: number | null; changePercent: number | null } | null;
  /** Pairs sharing a leg with the current one, for the cross-rate panel. */
  crosses: FxBoardRow[];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * Yahoo stamps FX daily bars at the session open, so the partial Sunday bar
 * lands on weekday 0 in UTC. Intraday bars are left untouched — they are real
 * ticks, and the session clock already explains the gap.
 */
export function dropFxSundayBars(candles: Candle[], interval: string): Candle[] {
  if (interval !== '1d' && interval !== '1wk') return candles;
  return candles.filter(candle => candle.date.getUTCDay() !== 0);
}

/** Remove holiday placeholder bars that come back as zeros or nulls. */
export function sanitizeFxCandles(candles: Candle[], interval: string): Candle[] {
  return dropFxSundayBars(
    candles.filter(candle =>
      Number.isFinite(candle.close) &&
      candle.close > 0 &&
      Number.isFinite(candle.open) &&
      candle.open > 0 &&
      Number.isFinite(candle.high) &&
      candle.high > 0 &&
      Number.isFinite(candle.low) &&
      candle.low > 0,
    ),
    interval,
  );
}

function mapQuote(raw: any, pair: FxPair): FxBoardRow {
  const price = positive(raw?.regularMarketPrice);
  const previousClose = positive(raw?.regularMarketPreviousClose);
  const change = num(raw?.regularMarketChange) ?? (price !== null && previousClose !== null ? price - previousClose : null);
  const changePercent =
    num(raw?.regularMarketChangePercent) ??
    (change !== null && previousClose !== null && previousClose !== 0 ? (change / previousClose) * 100 : null);
  const bid = positive(raw?.bid);
  const ask = positive(raw?.ask);

  return {
    ticker: pair.yahoo,
    code: pair.code,
    pair: pair.pair,
    name: raw?.shortName || raw?.longName || pair.pair,
    class: pair.class,
    precision: pair.precision,
    pipSize: pair.pipSize,
    price,
    change,
    changePercent,
    changePips: change === null ? null : change / pair.pipSize,
    previousClose,
    dayHigh: positive(raw?.regularMarketDayHigh),
    dayLow: positive(raw?.regularMarketDayLow),
    fiftyTwoWeekHigh: positive(raw?.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: positive(raw?.fiftyTwoWeekLow),
    bid,
    ask,
    spreadPips: bid !== null && ask !== null && ask >= bid ? (ask - bid) / pair.pipSize : null,
    marketState: raw?.marketState ?? null,
    updatedAt: num(raw?.regularMarketTime),
  };
}

export class FxService {
  private boardCache: { at: number; rows: FxBoardRow[] } | null = null;

  /** Batched quotes for the whole registry. Cached for a minute. */
  async getBoard(force = false): Promise<FxBoardRow[]> {
    if (!force && this.boardCache && Date.now() - this.boardCache.at < BOARD_TTL_MS) {
      return this.boardCache.rows;
    }

    const rows: FxBoardRow[] = [];
    for (let index = 0; index < FX_PAIRS.length; index += QUOTE_CHUNK) {
      const chunk = FX_PAIRS.slice(index, index + QUOTE_CHUNK);
      try {
        const quotes = await yahooFinance.quote(
          chunk.map(pair => pair.yahoo),
          {},
          { validateResult: false },
        ) as any[];
        const bySymbol = new Map<string, any>();
        for (const quote of Array.isArray(quotes) ? quotes : []) {
          if (quote?.symbol) bySymbol.set(String(quote.symbol).toUpperCase(), quote);
        }
        for (const pair of chunk) {
          const raw = bySymbol.get(pair.yahoo.toUpperCase());
          if (raw) rows.push(mapQuote(raw, pair));
        }
      } catch (error) {
        log.warn('fx', `Quote batch failed: ${(error as Error).message}`);
      }
    }

    if (rows.length > 0) {
      // Preserve registry order so the board never reshuffles between refreshes.
      const order = new Map(FX_PAIRS.map((pair, index) => [pair.code, index]));
      rows.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
      this.boardCache = { at: Date.now(), rows };
    }
    return rows;
  }

  async getQuote(rawSymbol: string): Promise<FxBoardRow | null> {
    const pair = parseFxSymbol(rawSymbol);
    if (!pair) return null;
    try {
      const quote = await yahooFinance.quote(pair.yahoo, {}, { validateResult: false }) as any;
      return quote ? mapQuote(quote, pair) : null;
    } catch (error) {
      log.warn('fx', `Quote failed for ${pair.code}: ${(error as Error).message}`);
      return null;
    }
  }

  async getCandles(rawSymbol: string, interval: string, lookbackDays: number): Promise<Candle[]> {
    const pair = parseFxSymbol(rawSymbol);
    if (!pair) return [];

    const period1 = new Date();
    period1.setDate(period1.getDate() - Math.max(1, lookbackDays));
    const yahoo = new YahooService();
    const candles = await yahoo.getHistoricalData(
      pair.yahoo,
      period1,
      interval as any,
      false,
      { includePrePost: false },
    );
    return sanitizeFxCandles(candles, interval);
  }

  /**
   * Everything the ticker page needs beyond the price: session clock, a rate
   * book for pip/notional conversion, the dollar index and the crosses that
   * share a leg with the active pair.
   */
  async getContext(rawSymbol: string): Promise<FxContext | null> {
    const pair = parseFxSymbol(rawSymbol);
    if (!pair) return null;

    const board = await this.getBoard();
    const rates: Record<string, number> = {};
    for (const row of board) {
      if (row.price !== null && row.price > 0) rates[row.code] = row.price;
    }
    // The active pair may have fallen out of the cached board; make sure its
    // rate is present before the cross/notional math runs.
    if (!rates[pair.code]) {
      const own = await this.getQuote(pair.yahoo);
      if (own?.price) rates[pair.code] = own.price;
    }

    let dxy: FxContext['dxy'] = null;
    try {
      const raw = await yahooFinance.quote(DXY_SYMBOL, {}, { validateResult: false }) as any;
      if (raw) {
        dxy = {
          price: positive(raw.regularMarketPrice),
          changePercent: num(raw.regularMarketChangePercent),
        };
      }
    } catch {
      // Dollar index is a nice-to-have; the page renders without it.
    }

    const crosses = board
      .filter(row => row.code !== pair.code && (row.code.startsWith(pair.base) || row.code.endsWith(pair.quote)))
      .slice(0, 10);

    return {
      pair,
      sessions: fxMarketStatus(),
      rates,
      dxy,
      crosses,
    };
  }
}

export const fxService = new FxService();

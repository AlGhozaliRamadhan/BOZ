import YahooFinance from 'yahoo-finance2';
export const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
import { Candle } from '../types/types.js';
import { log, clr } from '../utils/logger.js';

export class YahooService {
  async getHistoricalData(
    symbol: string,
    period1: Date,
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '1h',
    logRealtime: boolean = true,
  ): Promise<Candle[]> {
    try {
      const periodStr =
        interval === '1h' ? '5d' :
        interval === '1d' ? '90d' : '30d';

      // NOTE: Yahoo Finance does not support a native 4h interval.
      // When interval '4h' is requested we silently fetch 1h bars instead.
      // The caller is responsible for labelling these correctly in the UI.
      const resolvedInterval = interval === '4h' ? '1h' : interval;

      log.data('fetch', `${clr.white(symbol)}  interval ${clr.cyan(interval === '4h' ? '1h (4h synthetic)' : interval)}  window ${clr.dim(periodStr)}`);

      const result = await yahooFinance.chart(symbol, {
        period1,
        interval: resolvedInterval as any,
        includePrePost: true,
      });

      if (!result?.quotes?.length) throw new Error('No data retrieved from Yahoo Finance');

      const validQuotes = result.quotes.filter((q: any) => q.close != null);
      if (validQuotes.length === 0) throw new Error('All quotes had null close prices');

      // ── Real-time price ───────────────────────────────────────────────────
      if (logRealtime) {
        log.data('realtime', `Fetching current ${clr.white(symbol)} price...`);
        let realtimePrice: number | null = null;
        try {
          const quote = await yahooFinance.quote(symbol);
          realtimePrice = quote.regularMarketPrice ?? null;
          if (realtimePrice) {
            log.ok('yahoo', `Real-time price  ${clr.green('$' + realtimePrice.toFixed(2))}`);
          }
        } catch (e) {
          log.warn('yahoo', `Could not fetch real-time price: ${(e as Error).message}`);
        }

        // ── Price comparison ──────────────────────────────────────────────────
        const historicalPrice = validQuotes[validQuotes.length - 1].close as number;
        const rtPrice         = realtimePrice ?? historicalPrice;
        const diff            = Math.abs(rtPrice - historicalPrice);
        const diffPct         = (diff / historicalPrice) * 100;
        const diffColor       = diffPct < 0.5 ? clr.green : diffPct < 1.5 ? clr.yellow : clr.red;

        log.info('compare', `Historical  ${clr.dim('$' + historicalPrice.toFixed(2))}  ·  Real-time  ${clr.dim('$' + rtPrice.toFixed(2))}  ·  Δ ${diffColor(diffPct.toFixed(2) + '%')}`);
      }

      // ── Freshness ─────────────────────────────────────────────────────────
      const lastDate    = validQuotes[validQuotes.length - 1].date;
      const dataAgeMins = (Date.now() - new Date(lastDate).getTime()) / 60_000;
      const ageColor    = dataAgeMins > 120 ? clr.yellow : clr.dim;

      log.info('freshness', `Latest candle  ${clr.dim(new Date(lastDate).toISOString().replace('T', ' ').slice(0, 19) + ' UTC')}  ·  ${ageColor(dataAgeMins.toFixed(1) + ' min old')}`);

      if (dataAgeMins > 120) {
        log.warn('data', `Stale data — latest bar is ${Math.round(dataAgeMins)} min old`);
      }

      return validQuotes.map((q: any) => ({
        date:   new Date(q.date),
        open:   q.open   ?? 0,
        high:   q.high   ?? 0,
        low:    q.low    ?? 0,
        close:  q.close  ?? 0,
        volume: q.volume ?? 0,
      }));

    } catch (error) {
      log.error('yahoo', `Data fetch failed: ${(error as Error).message}`);
      return [];
    }
  }

  async getRealtimePrice(symbol: string): Promise<number | null> {
    try {
      const quote = await yahooFinance.quote(symbol);
      return quote.regularMarketPrice ?? null;
    } catch (error) {
      log.error('yahoo', `Real-time price error: ${(error as Error).message}`);
      return null;
    }
  }
}

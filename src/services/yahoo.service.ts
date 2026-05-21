import YahooFinance from 'yahoo-finance2';
export const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
import { Candle } from '../types/types.js';
import { log, clr } from '../utils/logger.js';

type HistoricalOptions = {
  includePrePost?: boolean;
  regularHours?: boolean;
  resampleIntervalMinutes?: number;
  adjustPrices?: boolean;
};

const NY_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const REGULAR_START_MINUTES = 9 * 60 + 30;
const REGULAR_END_MINUTES = 16 * 60;

function getNyParts(date: Date): { dayKey: string; minutes: number } {
  const parts = NY_TIME.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const hour = Number(map.hour ?? '0');
  const minute = Number(map.minute ?? '0');
  const minutes = (hour * 60) + minute;
  const dayKey = `${map.year ?? '0000'}-${map.month ?? '00'}-${map.day ?? '00'}`;
  return { dayKey, minutes };
}

function isRegularHoursCandle(candle: Candle): boolean {
  const { minutes } = getNyParts(candle.date);
  return minutes >= REGULAR_START_MINUTES && minutes < REGULAR_END_MINUTES;
}

function resampleCandles(
  candles: Candle[],
  intervalMinutes: number,
  useNyAnchor: boolean,
): Candle[] {
  if (intervalMinutes <= 0 || candles.length === 0) return candles;
  const intervalMs = intervalMinutes * 60 * 1000;
  const result: Candle[] = [];
  let currentKey: string | null = null;
  let bucket: Candle | null = null;

  for (const candle of candles) {
    let key: string;
    if (useNyAnchor) {
      const { dayKey, minutes } = getNyParts(candle.date);
      const bucketIndex = Math.floor((minutes - REGULAR_START_MINUTES) / intervalMinutes);
      if (bucketIndex < 0) continue;
      key = `${dayKey}:${bucketIndex}`;
    } else {
      key = String(Math.floor(candle.date.getTime() / intervalMs));
    }

    if (key !== currentKey) {
      if (bucket) result.push(bucket);
      bucket = {
        date: candle.date,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
      currentKey = key;
    } else if (bucket) {
      bucket.high = Math.max(bucket.high, candle.high);
      bucket.low = Math.min(bucket.low, candle.low);
      bucket.close = candle.close;
      bucket.volume += candle.volume;
    }
  }

  if (bucket) result.push(bucket);
  return result;
}

export class YahooService {
  async getHistoricalData(
    symbol: string,
    period1: Date,
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '1h',
    logRealtime: boolean = true,
    options?: HistoricalOptions,
  ): Promise<Candle[]> {
    try {
      const periodStr =
        interval === '1h' ? '5d' :
        interval === '1d' ? '90d' : '30d';

      // NOTE: Yahoo Finance does not support a native 4h interval.
      // When interval '4h' is requested we fetch 1h and resample.
      const useSynthetic4h = interval === '4h';
      const resolvedInterval = useSynthetic4h ? '1h' : interval;
      const resampleMinutes = useSynthetic4h ? 240 : options?.resampleIntervalMinutes;
      const includePrePost = options?.includePrePost ?? true;

      log.data(
        'fetch',
        `${clr.white(symbol)}  interval ${clr.cyan(useSynthetic4h ? '1h -> 4h' : interval)}  window ${clr.dim(periodStr)}`,
      );

      const result = await yahooFinance.chart(symbol, {
        period1,
        interval: resolvedInterval as any,
        includePrePost,
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

      // Only warn about stale data when the market is currently open.
      // Outside regular hours (pre/post/weekend) old candles are expected and not stale.
      const nowNy       = getNyParts(new Date());
      const nowDow      = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
      const isWeekend   = nowDow === 'Sat' || nowDow === 'Sun';
      const marketOpen  = !isWeekend && nowNy.minutes >= REGULAR_START_MINUTES && nowNy.minutes < REGULAR_END_MINUTES;
      const staleThresh = marketOpen ? 30 : 24 * 60; // 30 min during session, 24h outside
      const ageColor    = dataAgeMins > staleThresh ? clr.yellow : clr.dim;

      log.info('freshness', `Latest candle  ${clr.dim(new Date(lastDate).toISOString().replace('T', ' ').slice(0, 19) + ' UTC')}  ·  ${ageColor(dataAgeMins.toFixed(1) + ' min old')}`);

      if (dataAgeMins > staleThresh) {
        log.warn('data', `Stale data — latest bar is ${Math.round(dataAgeMins)} min old`);
      }

      const adjSeriesRaw = (result as any)?.indicators?.adjclose;
      const adjSeries = Array.isArray(adjSeriesRaw)
        ? (adjSeriesRaw[0]?.adjclose ?? adjSeriesRaw)
        : adjSeriesRaw?.adjclose;

      const quotesWithIndex = result.quotes
        .map((q: any, i: number) => ({ q, i }))
        .filter(({ q }: { q: any }) => q.close != null);

      let candles: Candle[] = quotesWithIndex.map(({ q, i }: { q: any; i: number }) => {
        const close = q.close ?? 0;
        const adjClose = Array.isArray(adjSeries) ? adjSeries[i] : undefined;
        const useAdjust = options?.adjustPrices === true && typeof adjClose === 'number' && close > 0;
        const ratio = useAdjust ? adjClose / close : 1;

        return {
          date:   new Date(q.date),
          open:   (q.open   ?? 0) * ratio,
          high:   (q.high   ?? 0) * ratio,
          low:    (q.low    ?? 0) * ratio,
          close:  useAdjust ? adjClose : close,
          volume: q.volume ?? 0,
        };
      });

      // adjclose is no longer reliably returned by Yahoo Finance's chart() endpoint.
      // Fall back silently to raw close; only log if DEBUG_YAHOO is set.
      if (options?.adjustPrices && (!adjSeries || adjSeries.length === 0)) {
        if (process.env.DEBUG_YAHOO) log.warn('yahoo', 'Adjusted prices requested but adjclose series was unavailable');
      }

      if (options?.regularHours) {
        candles = candles.filter(isRegularHoursCandle);
        log.info('filter', 'Regular hours only (09:30-16:00 ET)');
      }

      if (resampleMinutes) {
        candles = resampleCandles(candles, resampleMinutes, options?.regularHours === true);
        log.info('resample', `Resampled to ${resampleMinutes}m bars`);
      }

      return candles;

    } catch (error) {
      log.error('yahoo', `Data fetch failed: ${(error as Error).message}`);
      return [];
    }
  }
}

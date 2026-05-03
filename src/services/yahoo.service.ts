import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import { Candle } from '../types/types.js';

export class YahooService {
  async getHistoricalData(symbol: string, period1: Date, interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '1h'): Promise<Candle[]> {
    try {
      const periodStr = interval === '1h' ? '5d' : interval === '1d' ? '90d' : '30d'; // rough approx for logs
      console.log(`[DATA] Fetching ${symbol} data (period: ${periodStr}, interval: ${interval}, prepost: True)...`);
      
      const result = await yahooFinance.chart(symbol, {
        period1: period1,
        interval: (interval === '4h' ? '1h' : interval) as any,
        includePrePost: true,
      });

      if (!result || !result.quotes || result.quotes.length === 0) {
        throw new Error("No data retrieved from Yahoo Finance");
      }

      // Filter out any quotes with null/undefined close (can happen at market open)
      const validQuotes = result.quotes.filter((q: any) => q.close != null);
      if (validQuotes.length === 0) throw new Error("All quotes had null close prices");

      console.log(`[REALTIME] Fetching current ${symbol} price from Yahoo Finance...`);
      let realtimePrice: number | null = null;
      try {
        const quote = await yahooFinance.quote(symbol);
        realtimePrice = quote.regularMarketPrice ?? null;
        if (realtimePrice) {
          console.log(`[YAHOO] ✅ Real-time price: ${realtimePrice.toFixed(2)}`);
        }
      } catch (e) {
        console.warn(`[YAHOO] Could not fetch realtime price: ${(e as Error).message}`);
      }

      const historicalPrice = validQuotes[validQuotes.length - 1].close as number;
      console.log(`[COMPARE] Historical Yahoo: ${historicalPrice.toFixed(2)}`);
      console.log(`[COMPARE] Real-time Yahoo: ${(realtimePrice ?? historicalPrice).toFixed(2)}`);
      const diff = Math.abs((realtimePrice ?? historicalPrice) - historicalPrice);
      const diffPct = (diff / historicalPrice) * 100;
      console.log(`[COMPARE] Difference: ${diff.toFixed(2)} (${diffPct.toFixed(2)}%)`);
      
      const lastDate = validQuotes[validQuotes.length - 1].date;
      const dataAgeMins = (new Date().getTime() - new Date(lastDate).getTime()) / 60000;
      if (dataAgeMins > 120) {
        console.log(`[WARNING] Data may be stale - latest candle is ${Math.round(dataAgeMins)} minutes old`);
      }
      console.log(`[DATA] Latest candle timestamp: ${new Date(lastDate).toISOString().replace('T', ' ').replace('Z', '')} EDT`);
      console.log(`[DATA] Data freshness: ${dataAgeMins.toFixed(1)} minutes old`);

      return validQuotes.map((q: any) => ({
        date: new Date(q.date),
        open:   q.open   ?? 0,
        high:   q.high   ?? 0,
        low:    q.low    ?? 0,
        close:  q.close  ?? 0,
        volume: q.volume ?? 0,
      }));
    } catch (error) {
      console.error(`[YAHOO] Error fetching data: ${(error as Error).message}`);
      return [];
    }
  }

  async getRealtimePrice(symbol: string): Promise<number | null> {
    try {
      const quote = await yahooFinance.quote(symbol);
      return quote.regularMarketPrice || null;
    } catch (error) {
      console.error(`[YAHOO] Error fetching realtime price: ${(error as Error).message}`);
      return null;
    }
  }
}

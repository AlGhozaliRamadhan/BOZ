import { SMA, EMA, RSI, MACD, BollingerBands, ATR, OBV } from 'technicalindicators';
import { Candle } from '../types/types.js';

export class IndicatorsService {
  calculateAll(candles: Candle[]): Candle[] {
    if (candles.length === 0) return [];

    const closes  = candles.map(c => c.close);
    const highs   = candles.map(c => c.high);
    const lows    = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);
    const n       = candles.length;

    // Each indicator returns an array shorter than `closes` by (period-1).
    // The i-th element of the result corresponds to candles[i + offset].
    const sma20  = SMA.calculate({ period: 20,  values: closes });
    const sma50  = SMA.calculate({ period: 50,  values: closes });
    const sma200 = SMA.calculate({ period: 200, values: closes });
    const rsi    = RSI.calculate({ period: 14,  values: closes });

    const macdResult = MACD.calculate({
      fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false,
      values: closes,
    });

    const bb  = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
    const obv = OBV.calculate({ close: closes, volume: volumes });

    // Helper: map a shorter result array back to candle indices.
    // result[j] corresponds to candles[j + (n - result.length)]
    const align = <T>(result: T[], i: number): T | undefined => {
      const offset = n - result.length;
      const j = i - offset;
      return j >= 0 ? result[j] : undefined;
    };

    for (let i = 0; i < n; i++) {
      const c = candles[i];

      c.SMA_20  = align(sma20,  i) ?? null;
      c.SMA_50  = align(sma50,  i) ?? null;
      c.SMA_200 = align(sma200, i) ?? null;
      c.RSI     = align(rsi,    i) ?? null;

      const m = align(macdResult, i);
      c.MACD        = m?.MACD        ?? null;
      c.MACD_Signal = m?.signal      ?? null;
      c.MACD_Hist   = m?.histogram   ?? null;

      const b = align(bb, i);
      if (b) {
        c.BB_High = b.upper;
        c.BB_Low  = b.lower;
        c.BB_Mid  = b.middle;
        c.BB_Width = b.middle > 0 ? ((b.upper - b.lower) / b.middle) * 100 : 0;
      }

      const a = align(atr, i);
      if (a !== undefined) {
        c.ATR         = a;
        c.ATR_Percent = c.close > 0 ? (a / c.close) * 100 : 0;
      }

      // OBV is same length as input
      c.OBV = obv[i] ?? 0;

      // Volume SMA (20-period rolling)
      if (i >= 19) {
        let sum = 0;
        for (let j = i - 19; j <= i; j++) sum += candles[j].volume;
        c.Volume_SMA   = sum / 20;
        c.Volume_Ratio = c.Volume_SMA > 0 ? c.volume / c.Volume_SMA : 1;
      } else {
        c.Volume_SMA   = c.volume;
        c.Volume_Ratio = 1;
      }
    }

    // OBV SMA (needs OBV to be filled first)
    const obvValues = candles.map(c => c.OBV as number);
    const obvSma    = SMA.calculate({ period: 20, values: obvValues });
    for (let i = 0; i < n; i++) {
      const os = align(obvSma, i);
      if (os !== undefined) {
        candles[i].OBV_SMA   = os;
        candles[i].OBV_Trend = (candles[i].OBV as number) > os;
      }
    }

    return candles;
  }
}

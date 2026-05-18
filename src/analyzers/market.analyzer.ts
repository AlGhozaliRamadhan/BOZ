import { Candle, MarketData } from '../types/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.map((x) => (x - mean) ** 2).reduce((a, b) => a + b, 0) / arr.length);
}

function classifyVolume(ratio: number): string {
  if (ratio > 2.0) return 'EXTREME';
  if (ratio > 1.5) return 'VERY_HIGH';
  if (ratio > 1.2) return 'HIGH';
  return 'NORMAL';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function inferIntervalMinutes(candles: Candle[], fallback = 60): number {
  if (candles.length < 2) return fallback;
  const diffs: number[] = [];
  const start = Math.max(1, candles.length - 10);
  for (let i = start; i < candles.length; i++) {
    const diffMs = candles[i].date.getTime() - candles[i - 1].date.getTime();
    if (diffMs > 0) diffs.push(diffMs / 60000);
  }
  if (diffs.length === 0) return fallback;
  return Math.max(1, Math.round(median(diffs)));
}

function isLikelyIncomplete(latest: Candle, intervalMinutes: number, now: Date): boolean {
  if (intervalMinutes >= 360) return false;
  const ageMinutes = (now.getTime() - latest.date.getTime()) / 60000;
  return ageMinutes >= 0 && ageMinutes < intervalMinutes;
}

function getCloseAtOrBefore(candles: Candle[], cutoffMs: number): number {
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].date.getTime() <= cutoffMs) return candles[i].close;
  }
  return candles[0].close;
}

// ─── MarketAnalyzer ───────────────────────────────────────────────────────────

export class MarketAnalyzer {
  getMarketSummary(
    candles: Candle[],
    options?: {
      intervalMinutes?: number;
      dropIncomplete?: boolean;
      now?: Date;
    },
  ): MarketData {
    if (candles.length < 2) throw new Error('Need at least 2 candles for market summary');
    const intervalMinutes = options?.intervalMinutes ?? inferIntervalMinutes(candles, 60);
    const now = options?.now ?? new Date();

    const rawLatest = candles[candles.length - 1];
    const isIncomplete = isLikelyIncomplete(rawLatest, intervalMinutes, now);
    const dataAgeMinutes = Math.max(0, (now.getTime() - rawLatest.date.getTime()) / 60000);
    const shouldDrop = options?.dropIncomplete === true && isIncomplete && candles.length > 2;
    const analysisCandles = shouldDrop ? candles.slice(0, -1) : candles;

    const latest = analysisCandles[analysisCandles.length - 1];
    const latestTime = latest.date.getTime();

    // ── 24h rolling metrics ───────────────────────────────────────────────────
    const cutoff1h  = latestTime - 60 * 60 * 1000;
    const cutoff4h  = latestTime - 4 * 60 * 60 * 1000;
    const cutoff24h = latestTime - 24 * 60 * 60 * 1000;
    const window24Raw = analysisCandles.filter((c) => c.date.getTime() >= cutoff24h);
    const window24 = window24Raw.length > 1 ? window24Raw : analysisCandles;
    const high24     = Math.max(...window24.map((c) => c.high));
    const low24      = Math.min(...window24.map((c) => c.low));
    const close1ago  = getCloseAtOrBefore(analysisCandles, cutoff1h);
    const close4ago  = getCloseAtOrBefore(analysisCandles, cutoff4h);
    const close24ago = getCloseAtOrBefore(analysisCandles, cutoff24h);

    const change1h    = close1ago > 0  ? ((latest.close - close1ago)  / close1ago)  * 100 : 0;
    const change4h    = close4ago > 0  ? ((latest.close - close4ago)  / close4ago)  * 100 : 0;
    const change24h   = close24ago > 0 ? ((latest.close - close24ago) / close24ago) * 100 : 0;
    const range24hPct = low24 > 0 ? ((high24 - low24) / low24) * 100 : 0;

    // ── Volatility (std-dev of returns) ──────────────────────────────────────
    // returns[i] = % change from candles[i] to candles[i+1]
    const returns = analysisCandles.slice(1).map((c, i) => ({
      time: c.date.getTime(),
      value: (c.close - analysisCandles[i].close) / analysisCandles[i].close * 100,
    }));
    const returnsWithin = (cutoffMs: number): number[] =>
      returns.filter((r) => r.time >= cutoffMs).map((r) => r.value);

    const vol1h  = stdDev(returnsWithin(cutoff1h));
    const vol4h  = stdDev(returnsWithin(cutoff4h));
    const vol24h = stdDev(returnsWithin(cutoff24h));

    // ── Volatility regime ─────────────────────────────────────────────────────
    let volRegime  = 'NORMAL';
    let volWarning = 'Normal volatility conditions';
    if      (vol1h < 0.3 && vol24h < 0.5) { volRegime = 'EXTREMELY_LOW'; volWarning = '⚠️ COMPRESSION — Explosive move likely imminent'; }
    else if (vol1h < 0.5)                  { volRegime = 'LOW';           volWarning = 'Low volatility — watch for breakout'; }
    else if (vol1h > 2.5)                  { volRegime = 'EXTREME';       volWarning = '🚨 EXTREME VOLATILITY — High risk environment'; }
    else if (vol1h > 1.5)                  { volRegime = 'HIGH';          volWarning = '⚠️ HIGH VOLATILITY — Increased whipsaw risk'; }

    // ── Bollinger Band metrics ────────────────────────────────────────────────
    const bbWidth       = latest.BB_Width ?? 0;
    let squeezeStatus   = 'NORMAL';
    if      (bbWidth < 2.0) squeezeStatus = 'TIGHT_SQUEEZE';
    else if (bbWidth < 3.5) squeezeStatus = 'SQUEEZING';
    else if (bbWidth > 7.0) squeezeStatus = 'EXPANDING';

    let bbPosition = 'UNKNOWN';
    if      (latest.BB_High && latest.close > latest.BB_High) bbPosition = 'ABOVE_UPPER';
    else if (latest.BB_Mid  && latest.close > latest.BB_Mid)  bbPosition = 'UPPER_HALF';
    else if (latest.BB_Low  && latest.close > latest.BB_Low)  bbPosition = 'LOWER_HALF';
    else if (latest.BB_Low)                                   bbPosition = 'BELOW_LOWER';

    // ── Volume metrics ────────────────────────────────────────────────────────
    const volumeRatio = latest.Volume_Ratio ?? 1;

    return {
      current_price:         latest.close,
      change_1h:             change1h,
      change_4h:             change4h,
      change_24h:            change24h,
      low_24h:               low24,
      high_24h:              high24,
      range_24h_pct:         range24hPct,
      volume:                latest.volume,
      volume_ratio:          volumeRatio,
      volume_classification: classifyVolume(volumeRatio),
      volume_trend:          'NORMAL',
      obv_signal:            latest.OBV_Trend ? 'ACCUMULATION' : 'DISTRIBUTION',
      obv_trend:             latest.OBV_Trend ? 'BULLISH'      : 'BEARISH',
      obv_divergence:        'NONE',
      rsi:                   latest.RSI         ?? 50,
      macd:                  latest.MACD        ?? 0,
      macd_signal:           latest.MACD_Signal ?? 0,
      price_vs_sma20:        latest.SMA_20  ? ((latest.close - latest.SMA_20)  / latest.SMA_20)  * 100 : 0,
      price_vs_sma50:        latest.SMA_50  ? ((latest.close - latest.SMA_50)  / latest.SMA_50)  * 100 : null,
      price_vs_sma200:       latest.SMA_200 ? ((latest.close - latest.SMA_200) / latest.SMA_200) * 100 : null,
      volatility_1h:         vol1h,
      volatility_4h:         vol4h,
      volatility_24h:        vol24h,
      volatility_regime:     volRegime,
      volatility_warning:    volWarning,
      atr:                   latest.ATR        ?? 0,
      atr_percent:           latest.ATR_Percent ?? 0,
      bb_width:              bbWidth,
      bb_squeeze_status:     squeezeStatus,
      bb_position:           bbPosition,
      is_incomplete_candle:  isIncomplete,
      data_age_minutes:      dataAgeMinutes,
    };
  }

  getRecentPatterns(candles: Candle[], lookback = 24): string {
    if (candles.length < lookback) return 'Insufficient data';

    const recent = candles.slice(-lookback);
    const first  = recent[0].close;
    const last   = recent[recent.length - 1].close;

    const trend  = last > first ? 'UPTREND' : 'DOWNTREND';
    const change = ((last - first) / first) * 100;

    let support    = recent[0].low;
    let resistance = recent[0].high;
    for (const c of recent) {
      if (c.low  < support)    support    = c.low;
      if (c.high > resistance) resistance = c.high;
    }

    return `${trend} (${change.toFixed(2)}% over last ${lookback} bars) | Support: $${support.toFixed(2)}, Resistance: $${resistance.toFixed(2)}`;
  }
}

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

// ─── MarketAnalyzer ───────────────────────────────────────────────────────────

export class MarketAnalyzer {
  getMarketSummary(candles: Candle[]): MarketData {
    if (candles.length < 2) throw new Error('Need at least 2 candles for market summary');
    const latest = candles[candles.length - 1];
    const prev   = candles[candles.length - 2];

    // ── 24h rolling metrics ───────────────────────────────────────────────────
    const window24   = candles.slice(-24);
    const high24     = Math.max(...window24.map((c) => c.high));
    const low24      = Math.min(...window24.map((c) => c.low));
    const close24ago = candles.length >= 24 ? candles[candles.length - 24].close : candles[0].close;
    const close4ago  = candles.length >= 4  ? candles[candles.length - 4].close  : candles[0].close;

    const change1h    = ((latest.close - prev.close)  / prev.close)   * 100;
    const change4h    = ((latest.close - close4ago)   / close4ago)    * 100;
    const change24h   = ((latest.close - close24ago)  / close24ago)   * 100;
    const range24hPct = ((high24 - low24) / low24) * 100;

    // ── Volatility (std-dev of returns) ──────────────────────────────────────
    // returns[i] = % change from candles[i] to candles[i+1]
    const returns = candles.slice(1).map((c, i) => (c.close - candles[i].close) / candles[i].close * 100);
    //   vol1h  — minimum 4-bar window so stdDev is meaningful (was slice(-1) = always 0)
    const vol1h  = stdDev(returns.slice(-4));
    const vol4h  = stdDev(returns.slice(-16));
    const vol24h = stdDev(returns.slice(-24));

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

    // ── Incomplete candle detection ───────────────────────────────────────────
    const now = new Date();
    const isIncomplete =
      latest.date.getUTCFullYear() === now.getUTCFullYear() &&
      latest.date.getUTCMonth()    === now.getUTCMonth()    &&
      latest.date.getUTCDate()     === now.getUTCDate()     &&
      latest.date.getUTCHours()    === now.getUTCHours();

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

import type { ScreenerMetrics, ScreenerPreset } from './screener-contract.js';

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function finite(value: number | null, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Measures how closely a ticker matches a selected screen, not trade direction. */
export function scoreScreenerPreset(preset: ScreenerPreset, metrics: ScreenerMetrics): number {
  const volume = finite(metrics.volumeRatio, 1);
  const rsi = finite(metrics.rsi, 50);
  const fromHigh = Math.abs(finite(metrics.from52wHigh, -50));
  const fromLow = finite(metrics.from52wLow, 50);
  const macd = finite(metrics.macdHistogram);

  switch (preset) {
    case 'breakout':
      return clamp(
        (fromHigh <= 5 ? 35 : Math.max(0, 25 - fromHigh)) +
        (metrics.chg1d > 0 ? Math.min(20, metrics.chg1d * 5) : 0) +
        (volume >= 1.2 ? Math.min(30, volume * 12) : 0) +
        (macd > 0 ? 15 : 0),
      );
    case 'rebound':
      return clamp(
        (fromLow >= 3 && fromLow <= 20 ? 35 : Math.max(0, 25 - Math.abs(fromLow - 10))) +
        (metrics.chg1d > 0 ? Math.min(20, metrics.chg1d * 6) : 0) +
        (metrics.chg5d > -3 && metrics.chg5d < 8 ? 15 : 0) +
        (volume >= 1.1 ? Math.min(20, volume * 9) : 0) +
        (rsi >= 35 && rsi <= 60 ? 10 : 0),
      );
    case 'oversold':
      return clamp(
        (rsi <= 30 ? 40 : rsi <= 40 ? 25 : 0) +
        (metrics.chg20d <= -10 ? Math.min(25, Math.abs(metrics.chg20d)) : 0) +
        (fromLow <= 20 ? 20 : 0) +
        (volume >= 1.2 ? 15 : 0),
      );
    case 'downtrend':
      return clamp(
        (metrics.chg20d < 0 ? Math.min(35, Math.abs(metrics.chg20d) * 1.5) : 0) +
        (metrics.chg5d < 0 ? Math.min(20, Math.abs(metrics.chg5d) * 3) : 0) +
        (macd < 0 ? 20 : 0) +
        (rsi < 45 ? 15 : 0) +
        (volume >= 1.2 && metrics.chg1d < 0 ? 10 : 0),
      );
    case 'near_52w_low':
      return clamp(
        (fromLow <= 5 ? 50 : fromLow <= 12 ? 35 : fromLow <= 20 ? 20 : 0) +
        (fromHigh >= 40 ? 20 : 0) +
        (rsi <= 40 ? 20 : 0) +
        (metrics.chg20d <= 0 ? 10 : 0),
      );
    case 'momentum':
    default:
      const bullish =
        (metrics.chg5d > 0 ? Math.min(25, metrics.chg5d * 3) : 0) +
        (metrics.chg20d > 0 ? Math.min(20, metrics.chg20d) : 0) +
        (volume >= 1.2 ? Math.min(20, volume * 8) : 0) +
        (rsi >= 50 && rsi <= 68 ? 20 : rsi > 68 && rsi <= 75 ? 10 : 0) +
        (macd > 0 ? 15 : 0);
      const bearish =
        (metrics.chg5d < 0 ? Math.min(25, Math.abs(metrics.chg5d) * 3) : 0) +
        (metrics.chg20d < 0 ? Math.min(20, Math.abs(metrics.chg20d)) : 0) +
        (volume >= 1.2 ? Math.min(20, volume * 8) : 0) +
        (rsi <= 50 && rsi >= 32 ? 20 : rsi < 32 && rsi >= 25 ? 10 : 0) +
        (macd < 0 ? 15 : 0);
      return clamp(Math.max(bullish, bearish));
  }
}

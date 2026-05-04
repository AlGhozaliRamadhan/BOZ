import { Candle } from '../types/types.js';

export interface ChartPatternResult {
  patterns:            string[];
  pattern_confidence:  string[];
  nearest_support:     number;
  nearest_resistance:  number;
  fibonacci_levels:    Record<string, number>;
  fibonacci_position:  string;
}

export class ChartAnalyzer {
  analyzeChartPatterns(candles: Candle[]): ChartPatternResult {
    const recent = candles.slice(-24);
    if (recent.length < 2) return {
      patterns:           ['Insufficient data'],
      pattern_confidence: ['LOW'],
      nearest_support:    0,
      nearest_resistance: 0,
      fibonacci_levels:   {},
      fibonacci_position: 'UNKNOWN',
    };

    const patterns_found:    string[] = [];
    const pattern_confidence: string[] = [];

    const currentPrice = recent[recent.length - 1].close;
    const highs  = recent.map((c) => c.high);
    const lows   = recent.map((c) => c.low);

    // ── Peak / trough detection (uses threshold to filter noise) ──────────────
    const peaks   = this.findPeaks(highs);
    const troughs = this.findPeaks(lows.map((l) => -l));

    if (peaks.length >= 2) {
      patterns_found.push('Potential DOUBLE TOP detected');
      pattern_confidence.push('MEDIUM');
    }

    if (troughs.length >= 2) {
      patterns_found.push('Potential DOUBLE BOTTOM detected');
      pattern_confidence.push('MEDIUM');
    }

    if (patterns_found.length === 0) {
      patterns_found.push('No significant patterns detected');
      pattern_confidence.push('LOW');
    }

    const fib_levels = this.calculateFibonacciLevels(recent);

    return {
      patterns: patterns_found,
      pattern_confidence,
      nearest_support:    Math.min(...lows),
      nearest_resistance: Math.max(...highs),
      fibonacci_levels:   fib_levels,
      fibonacci_position: this.getFibPosition(currentPrice, fib_levels),
    };
  }

  /**
   * Finds local peaks in `data`. A point qualifies only if it exceeds its
   * neighbours by at least `threshold` (relative), preventing noise spikes
   * from triggering false double-top/bottom signals.
   */
  private findPeaks(data: number[], threshold = 0.012): number[] {
    const peaks: number[] = [];
    for (let i = 1; i < data.length - 1; i++) {
      const prev = data[i - 1];
      const curr = data[i];
      const next = data[i + 1];
      const exceedsPrev = prev !== 0 && (curr - prev) / Math.abs(prev) >= threshold;
      const exceedsNext = next !== 0 && (curr - next) / Math.abs(next) >= threshold;
      if (curr > prev && curr > next && exceedsPrev && exceedsNext) {
        peaks.push(i);
      }
    }
    return peaks;
  }

  private calculateFibonacciLevels(recent: Candle[]): Record<string, number> {
    const high = Math.max(...recent.map((c) => c.high));
    const low  = Math.min(...recent.map((c) => c.low));
    const diff = high - low;

    return {
      '0.0':   high,
      '0.236': high - 0.236 * diff,
      '0.382': high - 0.382 * diff,
      '0.5':   high - 0.5   * diff,
      '0.618': high - 0.618 * diff,
      '0.786': high - 0.786 * diff,
      '1.0':   low,
    };
  }

  private getFibPosition(currentPrice: number, levels: Record<string, number>): string {
    const sorted = Object.entries(levels)
      .sort((a, b) => Math.abs(currentPrice - a[1]) - Math.abs(currentPrice - b[1]));
    const [closestName, closestPrice] = sorted[0];
    const pctDiff = Math.abs((currentPrice - closestPrice) / currentPrice);
    if (pctDiff < 0.001) return `AT_FIB_${closestName}`;
    if (pctDiff < 0.003) return `NEAR_FIB_${closestName}`;
    return 'BETWEEN_LEVELS';
  }
}

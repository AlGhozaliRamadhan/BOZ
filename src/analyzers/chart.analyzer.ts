import { Candle } from '../types/types.js';

// ─── Candle Pattern Types ─────────────────────────────────────────────────────

export interface CandlePatternSignal {
  name:       string;
  bias:       'BULL' | 'BEAR' | 'NEUTRAL';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  meaning:    string;
}

export interface CandlePatternSummary {
  signals:       CandlePatternSignal[];
  overall_bias:  'BULL' | 'BEAR' | 'NEUTRAL';
  bias_strength: 'STRONG' | 'MODERATE' | 'WEAK';
  summary_text:  string;
}

// ─── Chart Pattern Types ──────────────────────────────────────────────────────

export interface ChartPatternResult {
  patterns:            string[];
  pattern_confidence:  string[];
  nearest_support:     number;
  nearest_resistance:  number;
  fibonacci_levels:    Record<string, number>;
  fibonacci_position:  string;
  candle_patterns:     CandlePatternSummary;
}

// ─── ChartAnalyzer ────────────────────────────────────────────────────────────

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
      candle_patterns:    { signals: [], overall_bias: 'NEUTRAL', bias_strength: 'WEAK', summary_text: 'Insufficient data' },
    };

    const patterns_found:     string[] = [];
    const pattern_confidence: string[] = [];

    const currentPrice = recent[recent.length - 1].close;
    const highs  = recent.map((c) => c.high);
    const lows   = recent.map((c) => c.low);

    // ── Peak / trough detection ───────────────────────────────────────────────
    const peaks   = this.findPeaks(highs);
    const troughs = this.findPeaks(lows.map((l) => -l));

    if (peaks.length >= 2) {
      const lastPeak  = peaks[peaks.length - 1];
      const prevPeak  = peaks[peaks.length - 2];
      const separation = lastPeak - prevPeak;
      const prevPrice  = highs[prevPeak];
      const lastPrice  = highs[lastPeak];
      const priceDiff  = prevPrice !== 0
        ? Math.abs(lastPrice - prevPrice) / Math.abs(prevPrice)
        : Number.POSITIVE_INFINITY;

      if (separation >= 6 && priceDiff < 0.01) {
        patterns_found.push('Potential DOUBLE TOP detected');
        pattern_confidence.push(separation === 6 ? 'LOW' : 'HIGH');
      }
    }

    if (troughs.length >= 2) {
      const lastTrough = troughs[troughs.length - 1];
      const prevTrough = troughs[troughs.length - 2];
      const separation = lastTrough - prevTrough;
      const prevPrice  = lows[prevTrough];
      const lastPrice  = lows[lastTrough];
      const priceDiff  = prevPrice !== 0
        ? Math.abs(lastPrice - prevPrice) / Math.abs(prevPrice)
        : Number.POSITIVE_INFINITY;

      if (separation >= 6 && priceDiff < 0.01) {
        patterns_found.push('Potential DOUBLE BOTTOM detected');
        pattern_confidence.push(separation === 6 ? 'LOW' : 'HIGH');
      }
    }

    if (patterns_found.length === 0) {
      patterns_found.push('No significant patterns detected');
      pattern_confidence.push('LOW');
    }

    const fib_levels      = this.calculateFibonacciLevels(recent);
    const candle_patterns = this.analyzeCandlePatterns(recent);

    return {
      patterns: patterns_found,
      pattern_confidence,
      nearest_support:    Math.min(...lows),
      nearest_resistance: Math.max(...highs),
      fibonacci_levels:   fib_levels,
      fibonacci_position: this.getFibPosition(currentPrice, fib_levels),
      candle_patterns,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // CANDLE PATTERN ENGINE
  // ══════════════════════════════════════════════════════════════════════════════

  analyzeCandlePatterns(candles: Candle[]): CandlePatternSummary {
    if (candles.length < 2) {
      return { signals: [], overall_bias: 'NEUTRAL', bias_strength: 'WEAK', summary_text: 'Insufficient candles' };
    }

    const signals: CandlePatternSignal[] = [];
    const c0 = candles[candles.length - 1];
    const c1 = candles[candles.length - 2];
    const c2 = candles.length >= 3 ? candles[candles.length - 3] : null;

    const body0        = Math.abs(c0.close - c0.open);
    const range0       = c0.high - c0.low;
    const body1        = Math.abs(c1.close - c1.open);
    const range1       = c1.high - c1.low;
    const isBull0      = c0.close > c0.open;
    const isBull1      = c1.close > c1.open;
    const lowerWick0   = Math.min(c0.open, c0.close) - c0.low;
    const upperWick0   = c0.high - Math.max(c0.open, c0.close);
    const bodyRatio0   = range0 > 0 ? body0 / range0 : 0;

    // ── Doji ─────────────────────────────────────────────────────────────────
    if (range0 > 0 && bodyRatio0 < 0.10) {
      signals.push({
        name: 'Doji',
        bias: 'NEUTRAL',
        confidence: 'MEDIUM',
        meaning: 'Market indecision — buyers and sellers in equilibrium. Watch for the next candle direction to confirm a breakout or reversal.',
      });
    }

    // ── Spinning Top (body 10–30% of range, wicks both sides) ────────────────
    else if (range0 > 0 && bodyRatio0 < 0.30 && lowerWick0 > 0.2 * range0 && upperWick0 > 0.2 * range0) {
      signals.push({
        name: isBull0 ? 'Bullish Spinning Top' : 'Bearish Spinning Top',
        bias: 'NEUTRAL',
        confidence: 'LOW',
        meaning: 'Small body with wicks on both sides — neither buyers nor sellers fully in control. Indecision; context determines the next move.',
      });
    }

    // ── Bullish Hammer ────────────────────────────────────────────────────────
    if (range0 > 0 && lowerWick0 >= 2 * body0 && upperWick0 <= 0.3 * range0) {
      signals.push({
        name: isBull0 ? 'Bullish Hammer' : 'Hammer',
        bias: 'BULL',
        confidence: isBull0 ? 'HIGH' : 'MEDIUM',
        meaning: `${isBull0 ? 'Green' : 'Red'} hammer — buyers aggressively rejected lower prices and ${isBull0 ? 'closed near the top' : 'fought back'}. ${isBull0 ? 'High-probability' : 'Moderate'} bullish reversal signal.`,
      });
    }

    // ── Shooting Star ─────────────────────────────────────────────────────────
    if (range0 > 0 && upperWick0 >= 2 * body0 && lowerWick0 <= 0.3 * range0) {
      signals.push({
        name: !isBull0 ? 'Shooting Star' : 'Bearish Gravestone',
        bias: 'BEAR',
        confidence: !isBull0 ? 'HIGH' : 'MEDIUM',
        meaning: `Long upper wick — price was rejected hard at the highs and sellers pushed it back down. ${!isBull0 ? 'Strong' : 'Moderate'} bearish reversal signal, especially after an uptrend.`,
      });
    }

    // ── Marubozu ──────────────────────────────────────────────────────────────
    if (range0 > 0 && bodyRatio0 > 0.85) {
      signals.push({
        name: isBull0 ? 'Bullish Marubozu' : 'Bearish Marubozu',
        bias: isBull0 ? 'BULL' : 'BEAR',
        confidence: 'HIGH',
        meaning: isBull0
          ? 'Near-full-body green candle with almost no wicks — pure buying pressure, sellers offered no resistance. Strong bullish momentum continuation.'
          : 'Near-full-body red candle with almost no wicks — pure selling pressure, buyers offered no defense. Strong bearish momentum continuation.',
      });
    }

    // ── Bullish Engulfing ─────────────────────────────────────────────────────
    if (!isBull1 && isBull0 && c0.open < c1.close && c0.close > c1.open && body0 > body1) {
      signals.push({
        name: 'Bullish Engulfing',
        bias: 'BULL',
        confidence: 'HIGH',
        meaning: 'Green candle fully engulfs the previous red candle — bulls overwhelmed bears. Strong reversal or bullish continuation signal.',
      });
    }

    // ── Bearish Engulfing ─────────────────────────────────────────────────────
    if (isBull1 && !isBull0 && c0.open > c1.close && c0.close < c1.open && body0 > body1) {
      signals.push({
        name: 'Bearish Engulfing',
        bias: 'BEAR',
        confidence: 'HIGH',
        meaning: 'Red candle fully engulfs the previous green candle — sellers overwhelmed buyers. Strong reversal to the downside.',
      });
    }

    // ── Inside Bar ────────────────────────────────────────────────────────────
    if (c0.high < c1.high && c0.low > c1.low) {
      signals.push({
        name: 'Inside Bar',
        bias: 'NEUTRAL',
        confidence: 'MEDIUM',
        meaning: "Price consolidating inside the prior candle's range. Energy coiling for a breakout — direction determined by which side breaks first.",
      });
    }

    // ── Piercing Line ─────────────────────────────────────────────────────────
    if (c2 && !isBull1 && isBull0 && c0.open < c1.low && c0.close > (c1.open + c1.close) / 2 && c0.close < c1.open) {
      signals.push({
        name: 'Piercing Line',
        bias: 'BULL',
        confidence: 'MEDIUM',
        meaning: "Green candle opened below prior red candle's low but closed above its midpoint — buyers staged a strong recovery. Bullish reversal setup.",
      });
    }

    // ── Dark Cloud Cover ──────────────────────────────────────────────────────
    if (c2 && isBull1 && !isBull0 && c0.open > c1.high && c0.close < (c1.open + c1.close) / 2 && c0.close > c1.open) {
      signals.push({
        name: 'Dark Cloud Cover',
        bias: 'BEAR',
        confidence: 'MEDIUM',
        meaning: "Red candle opened above prior green candle's high but closed below its midpoint — sellers took control after a gap up. Bearish reversal signal.",
      });
    }

    // ── Morning Star ──────────────────────────────────────────────────────────
    if (c2 && !isBull1 && isBull0 && body1 < body0 * 0.5 && c0.close > (c2.open + c2.close) / 2) {
      signals.push({
        name: 'Morning Star',
        bias: 'BULL',
        confidence: 'HIGH',
        meaning: '3-candle bullish reversal: big red → small indecision → big green recovery. Bears are exhausted, bulls are taking control.',
      });
    }

    // ── Evening Star ──────────────────────────────────────────────────────────
    if (c2 && isBull1 && !isBull0 && body1 < body0 * 0.5 && c0.close < (c2.open + c2.close) / 2) {
      signals.push({
        name: 'Evening Star',
        bias: 'BEAR',
        confidence: 'HIGH',
        meaning: '3-candle bearish reversal: big green → small indecision at top → big red decline. Bulls are exhausted, sellers are taking over.',
      });
    }

    // ── Tweezer Bottom ────────────────────────────────────────────────────────
    if (!isBull1 && isBull0 && Math.abs(c0.low - c1.low) / (range0 || 1) < 0.005) {
      signals.push({
        name: 'Tweezer Bottom',
        bias: 'BULL',
        confidence: 'MEDIUM',
        meaning: 'Two candles sharing nearly identical lows — a support level where sellers failed twice. Bullish reversal potential.',
      });
    }

    // ── Tweezer Top ───────────────────────────────────────────────────────────
    if (isBull1 && !isBull0 && Math.abs(c0.high - c1.high) / (range0 || 1) < 0.005) {
      signals.push({
        name: 'Tweezer Top',
        bias: 'BEAR',
        confidence: 'MEDIUM',
        meaning: 'Two candles sharing nearly identical highs — a resistance level where buyers failed twice. Bearish reversal potential.',
      });
    }

    // ── Bullish Harami ────────────────────────────────────────────────────────
    if (
      !isBull1 && isBull0 &&
      c0.high < Math.max(c1.open, c1.close) &&
      c0.low  > Math.min(c1.open, c1.close) &&
      body0   < body1 * 0.5
    ) {
      signals.push({
        name: 'Bullish Harami',
        bias: 'BULL',
        confidence: 'MEDIUM',
        meaning: 'Small green candle inside prior red candle — selling momentum is slowing. Potential reversal if confirmed by the next candle.',
      });
    }

    // ── Bearish Harami ────────────────────────────────────────────────────────
    if (
      isBull1 && !isBull0 &&
      c0.high < Math.max(c1.open, c1.close) &&
      c0.low  > Math.min(c1.open, c1.close) &&
      body0   < body1 * 0.5
    ) {
      signals.push({
        name: 'Bearish Harami',
        bias: 'BEAR',
        confidence: 'MEDIUM',
        meaning: 'Small red candle inside prior green candle — buying momentum is slowing. Potential reversal if confirmed by the next candle.',
      });
    }

    // ── Fallback ──────────────────────────────────────────────────────────────
    if (signals.length === 0) {
      signals.push({
        name: 'No clear candle pattern',
        bias: 'NEUTRAL',
        confidence: 'LOW',
        meaning: 'Current candle does not match any high-probability reversal or continuation pattern.',
      });
    }

    // ── Aggregate bias ────────────────────────────────────────────────────────
    const bullCount = signals.filter((s) => s.bias === 'BULL').length;
    const bearCount = signals.filter((s) => s.bias === 'BEAR').length;
    const highCount = signals.filter((s) => s.confidence === 'HIGH').length;

    let overall_bias: 'BULL' | 'BEAR' | 'NEUTRAL' = 'NEUTRAL';
    if (bullCount > bearCount) overall_bias = 'BULL';
    else if (bearCount > bullCount) overall_bias = 'BEAR';

    const margin = Math.abs(bullCount - bearCount);
    const bias_strength: 'STRONG' | 'MODERATE' | 'WEAK' =
      (margin >= 2 || (margin >= 1 && highCount >= 1)) ? 'STRONG' :
      margin === 1 ? 'MODERATE' : 'WEAK';

    const patternNames = signals.map((s) => s.name).join(', ');
    const summary_text = overall_bias === 'NEUTRAL'
      ? `Indecision — ${patternNames}. No clear directional edge from candle structure alone.`
      : `${overall_bias === 'BULL' ? 'Bullish' : 'Bearish'} candle signal (${bias_strength.toLowerCase()} conviction) — ${patternNames}. ${signals.find((s) => s.confidence === 'HIGH' || s.confidence === 'MEDIUM')?.meaning ?? ''}`;

    return { signals, overall_bias, bias_strength, summary_text };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Finds local peaks. A point qualifies only if it exceeds its neighbours
   * by at least `threshold` (relative) to filter out noise.
   */
  private findPeaks(data: number[], threshold = 0.012): number[] {
    const peaks: number[] = [];
    for (let i = 1; i < data.length - 1; i++) {
      const prev = data[i - 1];
      const curr = data[i];
      const next = data[i + 1];
      const exceedsPrev = prev !== 0 && (curr - prev) / Math.abs(prev) >= threshold;
      const exceedsNext = next !== 0 && (curr - next) / Math.abs(next) >= threshold;
      if (curr > prev && curr > next && exceedsPrev && exceedsNext) peaks.push(i);
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

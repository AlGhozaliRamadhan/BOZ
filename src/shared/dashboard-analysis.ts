import type { Candle } from '../types/types.js';
import type { ChartPatternResult } from '../analyzers/chart.analyzer.js';

export type Bias = 'BULL' | 'BEAR' | 'NEUTRAL';
export type Conviction = 'HIGH' | 'MEDIUM' | 'LOW';
export type PlanAction = 'BUY' | 'SELL' | 'WATCH';
export type PlanStatus = 'SETUP' | 'WATCH' | 'NO_TRADE';

export interface QuoteSnapshot {
  name?: string | null;
  marketCap?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
  previousClose?: number | null;
  marketState?: string | null;
  quoteType?: string | null;
  exchange?: string | null;
  currency?: string | null;
  averageVolume?: number | null;
}

export interface ConfluenceSignal {
  key: string;
  label: string;
  bias: Bias;
  weight: number;
  detail: string;
}

export interface StructureSnapshot {
  price: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  atr: number | null;
  atrPercent: number | null;
  volumeRatio: number | null;
  obvTrend: boolean | null;
  bbPosition: string;
  high52w: number | null;
  low52w: number | null;
  from52wHighPct: number | null;
  from52wLowPct: number | null;
  range52wPos: number | null;
  smaStack: 'BULL' | 'BEAR' | 'MIXED' | 'INCOMPLETE';
  weeklyLikeTrend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
}

export interface TradingPlan {
  action: PlanAction;
  status: PlanStatus;
  setup: string;
  entry: number | null;
  entryLabel: string;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
  atr: number | null;
  notes: string;
  extended: boolean;
}

export interface DashboardAnalysis {
  ticker: string;
  assetClass: string;
  exchangeLabel: string;
  currency: string;
  bias: Bias;
  conviction: Conviction;
  score: number;
  scoreLabel: string;
  signals: ConfluenceSignal[];
  structure: StructureSnapshot;
  plan: TradingPlan;
  insights: string[];
  patterns: string[];
  candleBias: Bias;
  support: number | null;
  resistance: number | null;
}

export interface DashboardAnalysisInput {
  ticker: string;
  candles: Candle[];
  quote?: QuoteSnapshot;
  patterns?: ChartPatternResult | null;
}

const BULL_WORDS = /\b(surge|rally|beat|upgrade|record|breakout|bull|soar|ath|all-time|buyback|beat estimates)\b/i;
const BEAR_WORDS = /\b(crash|plunge|miss|downgrade|lawsuit|bear|dump|selloff|layoff|fraud|ban|recall)\b/i;

export function classifyAsset(ticker: string, quote?: QuoteSnapshot): { assetClass: string; exchangeLabel: string; currency: string } {
  const symbol = ticker.toUpperCase();
  const type = (quote?.quoteType || '').toUpperCase();
  const exchange = (quote?.exchange || '').toUpperCase();
  const currency = quote?.currency || (symbol.endsWith('-USD') ? 'USD' : 'USD');

  if (type === 'CRYPTOCURRENCY' || /-[A-Z]{3,4}$/.test(symbol)) {
    return { assetClass: 'CRYPTO', exchangeLabel: 'CRYPTO', currency: currency || 'USD' };
  }
  if (type === 'INDEX' || symbol.startsWith('^')) {
    return { assetClass: 'INDEX', exchangeLabel: exchange || 'INDEX', currency };
  }
  if (type === 'CURRENCY' || /=(X)$/.test(symbol)) {
    return { assetClass: 'FX', exchangeLabel: 'FOREX', currency };
  }
  if (type === 'FUTURE' || symbol.endsWith('=F')) {
    return { assetClass: 'FUTURES', exchangeLabel: exchange || 'FUTURES', currency };
  }
  if (type === 'ETF') {
    return { assetClass: 'ETF', exchangeLabel: exchange || 'US ETF', currency };
  }
  if (symbol.endsWith('.JK')) {
    return { assetClass: 'ID EQUITY', exchangeLabel: 'IDX', currency: quote?.currency || 'IDR' };
  }
  if (exchange.includes('NASDAQ') || exchange.includes('NYSE') || exchange.includes('AMEX') || type === 'EQUITY') {
    return { assetClass: 'US EQUITY', exchangeLabel: exchange || 'US EQUITY', currency };
  }
  return { assetClass: type || 'EQUITY', exchangeLabel: exchange || 'MARKET', currency };
}

export function formatMarketState(state?: string | null): { label: string; live: boolean } {
  switch ((state || '').toUpperCase()) {
    case 'REGULAR': return { label: 'REGULAR SESSION', live: true };
    case 'PRE':
    case 'PREPRE': return { label: 'PRE-MARKET', live: false };
    case 'POST':
    case 'POSTPOST': return { label: 'AFTER-HOURS', live: false };
    case 'CLOSED': return { label: 'CLOSED', live: false };
    default: return { label: state ? state.toUpperCase() : 'UNKNOWN', live: false };
  }
}

export function scoreHeadlines(titles: string[]): { sentiment: 'Bullish' | 'Bearish' | 'Neutral'; hits: number } {
  let bull = 0;
  let bear = 0;
  for (const title of titles) {
    if (BULL_WORDS.test(title)) bull++;
    if (BEAR_WORDS.test(title)) bear++;
  }
  if (bull === 0 && bear === 0) return { sentiment: 'Neutral', hits: 0 };
  if (bull > bear) return { sentiment: 'Bullish', hits: bull };
  if (bear > bull) return { sentiment: 'Bearish', hits: bear };
  return { sentiment: 'Neutral', hits: bull + bear };
}

export function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(2);
  if (a >= 1) return n.toFixed(2);
  if (a >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function lastDefined<T>(values: Array<T | null | undefined>): T | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null) return v as T;
  }
  return null;
}

function bbPositionOf(c: Candle): string {
  if (c.BB_High != null && c.close > c.BB_High) return 'ABOVE_UPPER';
  if (c.BB_Mid != null && c.close > c.BB_Mid) return 'UPPER_HALF';
  if (c.BB_Low != null && c.close > c.BB_Low) return 'LOWER_HALF';
  if (c.BB_Low != null) return 'BELOW_LOWER';
  return 'UNKNOWN';
}

function smaStackOf(price: number, sma20: number | null, sma50: number | null, sma200: number | null): StructureSnapshot['smaStack'] {
  if (sma20 == null || sma50 == null) return 'INCOMPLETE';
  const bullShort = price > sma20 && sma20 > sma50;
  const bearShort = price < sma20 && sma20 < sma50;
  if (sma200 == null) {
    if (bullShort) return 'BULL';
    if (bearShort) return 'BEAR';
    return 'MIXED';
  }
  if (price > sma20 && sma20 > sma50 && sma50 > sma200) return 'BULL';
  if (price < sma20 && sma20 < sma50 && sma50 < sma200) return 'BEAR';
  return 'MIXED';
}

function trendFromCloses(closes: number[]): StructureSnapshot['weeklyLikeTrend'] {
  if (closes.length < 10) return 'SIDEWAYS';
  const last = closes[closes.length - 1];
  const window = closes.slice(-20);
  const sma = window.reduce((a, b) => a + b, 0) / window.length;
  if (last > sma * 1.02) return 'UPTREND';
  if (last < sma * 0.98) return 'DOWNTREND';
  return 'SIDEWAYS';
}

function patternBias(patterns?: ChartPatternResult | null): { bias: Bias; weight: number; detail: string } {
  if (!patterns) return { bias: 'NEUTRAL', weight: 0, detail: 'No pattern scan' };
  const names = (patterns.patterns || []).join(' ').toUpperCase();
  const candle = patterns.candle_patterns?.overall_bias ?? 'NEUTRAL';
  let score = 0;
  if (names.includes('DOUBLE BOTTOM') || names.includes('TRIPLE BOTTOM') || names.includes('INVERSE HEAD') || names.includes('ASCENDING')) score += 2;
  if (names.includes('DOUBLE TOP') || names.includes('TRIPLE TOP') || names.includes('HEAD & SHOULDERS') || names.includes('DESCENDING')) score -= 2;
  if (candle === 'BULL') score += patterns.candle_patterns?.bias_strength === 'STRONG' ? 2 : 1;
  if (candle === 'BEAR') score -= patterns.candle_patterns?.bias_strength === 'STRONG' ? 2 : 1;
  const bias: Bias = score > 0 ? 'BULL' : score < 0 ? 'BEAR' : 'NEUTRAL';
  const detail = patterns.patterns?.[0] || 'No significant patterns detected';
  return { bias, weight: Math.min(3, Math.abs(score)), detail };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function roundPrice(price: number, ref: number): number {
  const a = Math.abs(ref);
  if (a >= 1000) return Math.round(price * 100) / 100;
  if (a >= 1) return Math.round(price * 100) / 100;
  if (a >= 0.01) return Math.round(price * 10000) / 10000;
  return Math.round(price * 1e6) / 1e6;
}

export function buildDashboardAnalysis(input: DashboardAnalysisInput): DashboardAnalysis {
  const { ticker, candles, quote, patterns } = input;
  const identity = classifyAsset(ticker, quote);
  const emptyStructure: StructureSnapshot = {
    price: 0, sma20: null, sma50: null, sma200: null, rsi: null,
    macd: null, macdSignal: null, macdHist: null, atr: null, atrPercent: null,
    volumeRatio: null, obvTrend: null, bbPosition: 'UNKNOWN',
    high52w: null, low52w: null, from52wHighPct: null, from52wLowPct: null,
    range52wPos: null, smaStack: 'INCOMPLETE', weeklyLikeTrend: 'SIDEWAYS',
  };

  if (!candles.length) {
    return {
      ticker: ticker.toUpperCase(),
      ...identity,
      bias: 'NEUTRAL',
      conviction: 'LOW',
      score: 0,
      scoreLabel: 'NO DATA',
      signals: [],
      structure: emptyStructure,
      plan: {
        action: 'WATCH', status: 'NO_TRADE', setup: 'Insufficient price history',
        entry: null, entryLabel: '—', stop: null, target1: null, target2: null,
        riskReward: null, atr: null, notes: 'Need more candles before a plan is valid.',
        extended: false,
      },
      insights: ['No market data was available for this ticker.'],
      patterns: [],
      candleBias: 'NEUTRAL',
      support: null,
      resistance: null,
    };
  }

  const last = candles[candles.length - 1];
  const price = last.close;
  const sma20 = last.SMA_20 ?? null;
  const sma50 = last.SMA_50 ?? null;
  const sma200 = last.SMA_200 ?? lastDefined(candles.map(c => c.SMA_200));
  const rsi = last.RSI ?? null;
  const macd = last.MACD ?? null;
  const macdSignal = last.MACD_Signal ?? null;
  const macdHist = last.MACD_Hist ?? null;
  const atr = last.ATR ?? null;
  const atrPercent = last.ATR_Percent ?? (atr && price ? (atr / price) * 100 : null);
  const volumeRatio = last.Volume_Ratio ?? null;
  const obvTrend = last.OBV_Trend ?? null;

  const window252 = candles.slice(-252);
  const computedHigh = Math.max(...window252.map(c => c.high));
  const computedLow = Math.min(...window252.map(c => c.low));
  const high52w = quote?.fiftyTwoWeekHigh && quote.fiftyTwoWeekHigh > 0 ? quote.fiftyTwoWeekHigh : computedHigh;
  const low52w = quote?.fiftyTwoWeekLow && quote.fiftyTwoWeekLow > 0 ? quote.fiftyTwoWeekLow : computedLow;
  const from52wHighPct = high52w > 0 ? ((price - high52w) / high52w) * 100 : null;
  const from52wLowPct = low52w > 0 ? ((price - low52w) / low52w) * 100 : null;
  const range52wPos = high52w > low52w ? ((price - low52w) / (high52w - low52w)) * 100 : null;

  const structure: StructureSnapshot = {
    price, sma20, sma50, sma200, rsi, macd, macdSignal, macdHist,
    atr, atrPercent, volumeRatio, obvTrend, bbPosition: bbPositionOf(last),
    high52w, low52w, from52wHighPct, from52wLowPct, range52wPos,
    smaStack: smaStackOf(price, sma20, sma50, sma200),
    weeklyLikeTrend: trendFromCloses(candles.map(c => c.close)),
  };

  const signals: ConfluenceSignal[] = [];

  if (sma20 != null) {
    const above = price >= sma20;
    signals.push({
      key: 'sma20',
      label: 'SMA 20',
      bias: above ? 'BULL' : 'BEAR',
      weight: 1,
      detail: `${above ? 'Above' : 'Below'} SMA-20 (${formatPrice(sma20)})`,
    });
  }
  if (sma50 != null) {
    const above = price >= sma50;
    signals.push({
      key: 'sma50',
      label: 'SMA 50',
      bias: above ? 'BULL' : 'BEAR',
      weight: 1.5,
      detail: `${above ? 'Above' : 'Below'} SMA-50 (${formatPrice(sma50)})`,
    });
  }
  if (sma200 != null) {
    const above = price >= sma200;
    signals.push({
      key: 'sma200',
      label: 'SMA 200',
      bias: above ? 'BULL' : 'BEAR',
      weight: 2,
      detail: `${above ? 'Above' : 'Below'} SMA-200 (${formatPrice(sma200)}) — ${above ? 'long-term uptrend intact' : 'long-term trend broken'}`,
    });
  }
  if (sma50 != null && sma200 != null) {
    const golden = sma50 > sma200;
    signals.push({
      key: 'cross',
      label: '50/200 CROSS',
      bias: golden ? 'BULL' : 'BEAR',
      weight: 2,
      detail: golden ? 'Golden-cross regime (SMA-50 > SMA-200)' : 'Death-cross regime (SMA-50 < SMA-200)',
    });
  }

  if (rsi != null) {
    let bias: Bias = 'NEUTRAL';
    let weight = 0.5;
    let detail = `RSI ${rsi.toFixed(1)} — balanced`;
    if (rsi >= 70) {
      bias = 'BULL';
      weight = 0.5;
      detail = `RSI ${rsi.toFixed(1)} — overbought; trend is strong but chase risk is high`;
    } else if (rsi >= 55) {
      bias = 'BULL';
      weight = 1;
      detail = `RSI ${rsi.toFixed(1)} — bullish momentum`;
    } else if (rsi <= 30) {
      bias = 'BEAR';
      weight = 0.5;
      detail = `RSI ${rsi.toFixed(1)} — oversold; selling is stretched, bounce risk exists`;
    } else if (rsi <= 45) {
      bias = 'BEAR';
      weight = 1;
      detail = `RSI ${rsi.toFixed(1)} — bearish momentum`;
    }
    signals.push({ key: 'rsi', label: 'RSI 14', bias, weight, detail });
  }

  if (macd != null && macdSignal != null) {
    const hist = macdHist ?? (macd - macdSignal);
    const above = macd >= macdSignal;
    signals.push({
      key: 'macd',
      label: 'MACD',
      bias: above ? 'BULL' : 'BEAR',
      weight: 1.5,
      detail: `${above ? 'MACD above signal' : 'MACD below signal'} · hist ${hist >= 0 ? '+' : ''}${hist.toFixed(3)}`,
    });
  }

  if (volumeRatio != null) {
    const upDay = last.close >= last.open;
    if (volumeRatio >= 1.3) {
      signals.push({
        key: 'volume',
        label: 'VOLUME',
        bias: upDay ? 'BULL' : 'BEAR',
        weight: 1,
        detail: `${volumeRatio.toFixed(2)}x average on a ${upDay ? 'green' : 'red'} day — move is being confirmed`,
      });
    } else if (volumeRatio <= 0.7) {
      signals.push({
        key: 'volume',
        label: 'VOLUME',
        bias: 'NEUTRAL',
        weight: 0.5,
        detail: `${volumeRatio.toFixed(2)}x average — participation is light, signal quality is weaker`,
      });
    }
  }

  if (obvTrend != null) {
    signals.push({
      key: 'obv',
      label: 'OBV',
      bias: obvTrend ? 'BULL' : 'BEAR',
      weight: 1,
      detail: obvTrend ? 'OBV above its SMA — accumulation' : 'OBV below its SMA — distribution',
    });
  }

  const bb = bbPositionOf(last);
  if (bb === 'ABOVE_UPPER') {
    signals.push({ key: 'bb', label: 'BOLLINGER', bias: 'BULL', weight: 0.5, detail: 'Close above upper band — extended, not a fresh entry' });
  } else if (bb === 'BELOW_LOWER') {
    signals.push({ key: 'bb', label: 'BOLLINGER', bias: 'BEAR', weight: 0.5, detail: 'Close below lower band — washed out, bounce risk' });
  }

  if (range52wPos != null) {
    if (range52wPos >= 90 && (rsi ?? 50) >= 68) {
      signals.push({
        key: 'range',
        label: '52W POSITION',
        bias: 'NEUTRAL',
        weight: 1,
        detail: `${range52wPos.toFixed(0)}th percentile of 52w range and RSI elevated — late-stage / extended`,
      });
    } else if (range52wPos <= 15 && (rsi ?? 50) <= 35) {
      signals.push({
        key: 'range',
        label: '52W POSITION',
        bias: 'NEUTRAL',
        weight: 1,
        detail: `${range52wPos.toFixed(0)}th percentile of 52w range — washed out, not the same as a confirmed downtrend`,
      });
    } else if (range52wPos >= 70) {
      signals.push({
        key: 'range',
        label: '52W POSITION',
        bias: 'BULL',
        weight: 0.5,
        detail: `Trading in the upper ${Math.round(100 - range52wPos)}% of the 52-week range`,
      });
    } else if (range52wPos <= 30) {
      signals.push({
        key: 'range',
        label: '52W POSITION',
        bias: 'BEAR',
        weight: 0.5,
        detail: `Trading in the lower ${Math.round(range52wPos)}% of the 52-week range`,
      });
    }
  }

  const scanned = patternBias(patterns);
  if (scanned.weight > 0) {
    signals.push({
      key: 'pattern',
      label: 'STRUCTURE',
      bias: scanned.bias,
      weight: scanned.weight,
      detail: scanned.detail,
    });
  }

  let raw = 0;
  let denom = 0;
  for (const s of signals) {
    denom += s.weight;
    if (s.bias === 'BULL') raw += s.weight;
    else if (s.bias === 'BEAR') raw -= s.weight;
  }
  const score = denom > 0 ? Math.round(clamp((raw / denom) * 100, -100, 100)) : 0;
  const bias: Bias = score >= 18 ? 'BULL' : score <= -18 ? 'BEAR' : 'NEUTRAL';
  const conviction: Conviction = Math.abs(score) >= 55 ? 'HIGH' : Math.abs(score) >= 30 ? 'MEDIUM' : 'LOW';
  const scoreLabel =
    bias === 'NEUTRAL' ? 'MIXED / NO EDGE' :
    conviction === 'HIGH' ? (bias === 'BULL' ? 'BULLISH ALIGNED' : 'BEARISH ALIGNED') :
    conviction === 'MEDIUM' ? (bias === 'BULL' ? 'LEAN BULLISH' : 'LEAN BEARISH') :
    (bias === 'BULL' ? 'SOFT BULLISH' : 'SOFT BEARISH');

  const support = patterns?.nearest_support && patterns.nearest_support > 0 ? patterns.nearest_support : Math.min(...candles.slice(-20).map(c => c.low));
  const resistance = patterns?.nearest_resistance && patterns.nearest_resistance > 0 ? patterns.nearest_resistance : Math.max(...candles.slice(-20).map(c => c.high));

  const plan = buildPlan({
    price, atr, rsi, bias, conviction, support, resistance, sma20, sma50,
    range52wPos, bb, from52wHighPct,
  });

  const insights = buildInsights({
    ticker: ticker.toUpperCase(),
    structure,
    bias,
    conviction,
    score,
    plan,
    patterns,
    quote,
    last,
  });

  return {
    ticker: ticker.toUpperCase(),
    ...identity,
    bias,
    conviction,
    score,
    scoreLabel,
    signals,
    structure,
    plan,
    insights,
    patterns: patterns?.patterns ?? [],
    candleBias: patterns?.candle_patterns?.overall_bias ?? 'NEUTRAL',
    support,
    resistance,
  };
}

function buildPlan(args: {
  price: number;
  atr: number | null;
  rsi: number | null;
  bias: Bias;
  conviction: Conviction;
  support: number;
  resistance: number;
  sma20: number | null;
  sma50: number | null;
  range52wPos: number | null;
  bb: string;
  from52wHighPct: number | null;
}): TradingPlan {
  const { price, atr, rsi, bias, conviction, support, resistance, sma20, sma50, range52wPos, bb, from52wHighPct } = args;
  const vol = atr && atr > 0 ? atr : price * 0.015;
  const extended = (rsi != null && rsi >= 72) || bb === 'ABOVE_UPPER' || (range52wPos != null && range52wPos >= 92 && (rsi ?? 50) >= 65);
  const washed = (rsi != null && rsi <= 28) || bb === 'BELOW_LOWER';

  if (bias === 'NEUTRAL' || conviction === 'LOW') {
    return {
      action: 'WATCH',
      status: 'WATCH',
      setup: bias === 'NEUTRAL' ? 'Signals conflict — no directional edge' : 'Conviction too low for a defined trade',
      entry: null,
      entryLabel: `Watch ${formatPrice(support)} / ${formatPrice(resistance)}`,
      stop: null,
      target1: resistance || null,
      target2: null,
      riskReward: null,
      atr: atr,
      notes: 'Wait for a close that reclaims a moving average or breaks the nearby level with volume.',
      extended,
    };
  }

  if (bias === 'BULL' && extended) {
    return {
      action: 'WATCH',
      status: 'WATCH',
      setup: 'Uptrend intact but extended',
      entry: roundPrice(price - vol, price),
      entryLabel: `Pullback toward ${formatPrice(sma20 ?? price - vol)}`,
      stop: roundPrice((sma50 ?? support) - 0.3 * vol, price),
      target1: roundPrice(price + 1.2 * vol, price),
      target2: roundPrice(price + 2.2 * vol, price),
      riskReward: null,
      atr: atr,
      notes: from52wHighPct != null
        ? `Price is ${from52wHighPct.toFixed(1)}% from the 52w high. Chasing here has poor R/R — wait for a pullback.`
        : 'Trend is fine; timing is not. Wait for a pullback rather than buying the extension.',
      extended: true,
    };
  }

  if (bias === 'BEAR' && washed) {
    return {
      action: 'WATCH',
      status: 'WATCH',
      setup: 'Downtrend intact but stretched',
      entry: roundPrice(price + vol, price),
      entryLabel: `Rally into ${formatPrice(sma20 ?? price + vol)}`,
      stop: roundPrice((sma50 ?? resistance) + 0.3 * vol, price),
      target1: roundPrice(price - 1.2 * vol, price),
      target2: roundPrice(price - 2.2 * vol, price),
      riskReward: null,
      atr: atr,
      notes: 'Selling the washout is late. Prefer a bounce into resistance.',
      extended: true,
    };
  }

  if (bias === 'BULL') {
    const entry = roundPrice(price, price);
    const stopRaw = Math.min(price - 1.4 * vol, (support || price - 1.6 * vol) - 0.15 * vol);
    const stop = roundPrice(Math.min(stopRaw, entry - 0.4 * vol), price);
    const t1 = roundPrice(Math.max(resistance || 0, entry + 1.4 * vol), price);
    const t2 = roundPrice(entry + 2.4 * vol, price);
    const risk = entry - stop;
    const reward = t1 - entry;
    const rr = risk > 0 ? reward / risk : null;
    if (rr != null && rr < 1.15) {
      return {
        action: 'WATCH',
        status: 'WATCH',
        setup: 'Bullish bias, but R/R to next resistance is poor',
        entry, entryLabel: `Break/hold ${formatPrice(entry)}`,
        stop, target1: t1, target2: t2, riskReward: rr, atr,
        notes: `Reward to next level is only ${rr.toFixed(2)}R. Wait for a deeper pullback or a cleaner breakout.`,
        extended,
      };
    }
    return {
      action: 'BUY',
      status: 'SETUP',
      setup: structureSetup('BULL', sma20, sma50),
      entry,
      entryLabel: conviction === 'HIGH' ? `${formatPrice(entry)} continuation` : `${formatPrice(entry)} on hold`,
      stop, target1: t1, target2: t2, riskReward: rr, atr,
      notes: `Stop sits ${formatPrice(entry - stop)} under entry (~${((entry - stop) / entry * 100).toFixed(1)}%). Size off that distance, not a flat 1%.`,
      extended,
    };
  }

  const entry = roundPrice(price, price);
  const stopRaw = Math.max(price + 1.4 * vol, (resistance || price + 1.6 * vol) + 0.15 * vol);
  const stop = roundPrice(Math.max(stopRaw, entry + 0.4 * vol), price);
  const t1 = roundPrice(Math.min(support || Infinity, entry - 1.4 * vol), price);
  const t2 = roundPrice(entry - 2.4 * vol, price);
  const risk = stop - entry;
  const reward = entry - t1;
  const rr = risk > 0 ? reward / risk : null;
  if (rr != null && rr < 1.15) {
    return {
      action: 'WATCH',
      status: 'WATCH',
      setup: 'Bearish bias, but R/R to next support is poor',
      entry, entryLabel: `Reject ${formatPrice(entry)}`,
      stop, target1: t1, target2: t2, riskReward: rr, atr,
      notes: `Downside to support is only ${rr.toFixed(2)}R. Wait for a bounce into resistance.`,
      extended,
    };
  }
  return {
    action: 'SELL',
    status: 'SETUP',
    setup: structureSetup('BEAR', sma20, sma50),
    entry,
    entryLabel: conviction === 'HIGH' ? `${formatPrice(entry)} continuation` : `${formatPrice(entry)} on fail`,
    stop, target1: t1, target2: t2, riskReward: rr, atr,
    notes: `Stop sits ${formatPrice(stop - entry)} above entry (~${((stop - entry) / entry * 100).toFixed(1)}%).`,
    extended,
  };
}

function structureSetup(bias: 'BULL' | 'BEAR', sma20: number | null, sma50: number | null): string {
  if (bias === 'BULL') {
    if (sma20 != null && sma50 != null) return 'Trend continuation above SMA-20 / SMA-50';
    return 'Bullish continuation';
  }
  if (sma20 != null && sma50 != null) return 'Trend continuation below SMA-20 / SMA-50';
  return 'Bearish continuation';
}

function buildInsights(args: {
  ticker: string;
  structure: StructureSnapshot;
  bias: Bias;
  conviction: Conviction;
  score: number;
  plan: TradingPlan;
  patterns?: ChartPatternResult | null;
  quote?: QuoteSnapshot;
  last: Candle;
}): string[] {
  const { ticker, structure, bias, conviction, score, plan, patterns, quote, last } = args;
  const out: string[] = [];
  const s = structure;

  const stackText =
    s.smaStack === 'BULL' ? 'moving averages are stacked bullishly (price > 20 > 50 > 200)' :
    s.smaStack === 'BEAR' ? 'moving averages are stacked bearishly (price < 20 < 50 < 200)' :
    s.smaStack === 'INCOMPLETE' ? 'the longer moving averages are not fully formed yet' :
    'the moving-average stack is mixed — this is a pullback or a transition, not a clean trend';
  out.push(`${ticker} scores ${score >= 0 ? '+' : ''}${score} (${scoreLabelish(bias, conviction)}). ${stackText[0].toUpperCase()}${stackText.slice(1)}.`);

  if (s.from52wHighPct != null && s.high52w != null && s.low52w != null) {
    out.push(
      `It is ${Math.abs(s.from52wHighPct).toFixed(1)}% ${s.from52wHighPct >= 0 ? 'above' : 'below'} the 52-week high (${formatPrice(s.high52w)}) and ${s.from52wLowPct != null ? Math.abs(s.from52wLowPct).toFixed(1) + '% off the 52-week low' : 'n/a'} (${formatPrice(s.low52w)}).`,
    );
  }

  if (s.rsi != null) {
    if (s.rsi >= 70) out.push(`RSI at ${s.rsi.toFixed(1)} is overbought. That confirms strength; it does not confirm a safe entry.`);
    else if (s.rsi <= 30) out.push(`RSI at ${s.rsi.toFixed(1)} is oversold. Forced selling can continue, but shorts here are late.`);
    else out.push(`RSI at ${s.rsi.toFixed(1)} is ${s.rsi >= 55 ? 'in bullish territory' : s.rsi <= 45 ? 'in bearish territory' : 'neutral'} — no extreme to fade.`);
  }

  if (s.volumeRatio != null) {
    out.push(
      last.close >= last.open
        ? `Today is a green session with ${s.volumeRatio.toFixed(2)}x average volume${s.volumeRatio >= 1.3 ? ' — buyers are participating' : ' — the move lacks strong confirmation'}.`
        : `Today is a red session with ${s.volumeRatio.toFixed(2)}x average volume${s.volumeRatio >= 1.3 ? ' — sellers are in control' : ' — the decline is not heavily confirmed'}.`,
    );
  }

  if (s.atrPercent != null) {
    out.push(`ATR is ${s.atrPercent.toFixed(2)}% of price. Stops tighter than that will get shaken out in normal noise.`);
  }

  if (patterns?.candle_patterns?.summary_text) {
    out.push(patterns.candle_patterns.summary_text);
  } else if (patterns?.patterns?.length) {
    out.push(`Chart structure: ${patterns.patterns[0]}.`);
  }

  if (plan.action === 'WATCH') {
    out.push(`No live trade: ${plan.setup}. ${plan.notes}`);
  } else {
    out.push(`${plan.action} setup (${plan.riskReward != null ? plan.riskReward.toFixed(2) + 'R to T1' : 'R/R n/a'}). ${plan.notes}`);
  }

  out.push('Fear & Greed and VIX are market-wide gauges, not a thesis on this ticker. Use them for regime, not for the entry.');

  if (quote?.marketCap) {
    const cap = quote.marketCap;
    const capText = cap >= 1e12 ? `${(cap / 1e12).toFixed(2)}T` : cap >= 1e9 ? `${(cap / 1e9).toFixed(1)}B` : `${(cap / 1e6).toFixed(0)}M`;
    out.push(`Market cap ≈ ${capText} ${quote.currency || ''}`.trim() + '. Size the narrative to the vehicle — mega-caps trend, small-caps whip.');
  }

  return out.slice(0, 8);
}

function scoreLabelish(bias: Bias, conviction: Conviction): string {
  if (bias === 'NEUTRAL') return 'mixed';
  const dir = bias === 'BULL' ? 'bullish' : 'bearish';
  return `${conviction.toLowerCase()} ${dir}`;
}

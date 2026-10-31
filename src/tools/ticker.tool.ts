import { YahooService, yahooFinance } from '../services/market/yahoo.service.js';
import { IndicatorsService } from '../services/market/indicators.service.js';
import { MacroService } from '../services/market/macro.service.js';
import { ChartAnalyzer } from '../analyzers/chart.analyzer.js';
import { buildDashboardAnalysis, scoreHeadlines, type QuoteSnapshot } from '../shared/dashboard-analysis.js';
import { SentimentService } from '../services/market/sentiment.service.js';
import { NewsService } from '../services/news/news.service.js';
import { resolveSymbol } from '../shared/market-constants.js';
import { parseFxSymbol } from '../shared/fx.js';
import { sanitizeFxCandles } from '../services/market/fx.service.js';
import { formatCrowdSignalEvidence } from '../shared/evidence-attribution.js';

// ─── Tool Definitions (JSON Schemas) ──────────────────────────────────────────

export const fetchTickerDashboardDefinition = {
  type: 'function' as const,
  function: {
    name: 'fetch_ticker_dashboard',
    description: [
      'Fetch the complete quantitative and macro dashboard analysis for any ticker.',
      'Returns technical structure across Daily (1D) and Weekly (1W) timeframes (SMA 20/50/200 stack, RSI, MACD, ATR volatility, Bollinger Bands, OBV volume flow),',
      '50-day price range & positioning, weighted bias score & conviction, actionable trade plan (entry, targets, ATR stop buffer),',
      'candlestick & chart patterns with structural meaning, support/resistance levels, macro regime (VIX, 10Y Yield, SPY/QQQ Beta), and crowd sentiment (StockTwits, Reddit, News).',
      'Use this whenever the user asks for in-depth analysis, outlook, or trade setups on any stock/crypto/index/forex ticker.'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Ticker symbol (e.g. NVDA, AAPL, BBCA, BTC-USD, ^GSPC, EURUSD)',
        },
      },
      required: ['symbol'],
    },
  },
};

export const fetchPriceDefinition = {
  type: 'function' as const,
  function: {
    name: 'fetch_price',
    description: 'Fetch the latest real-time market price, daily change, day range, and previous close for any asset ticker.',
    parameters: {
      type: 'object',
      properties: {
        symbol_or_name: {
          type: 'string',
          description: 'Ticker symbol or company name (e.g. NVDA, AAPL, BBCA, BTC-USD, EURUSD)',
        },
      },
      required: ['symbol_or_name'],
    },
  },
};

// ─── Ticker resolution ────────────────────────────────────────────────────────

/**
 * The listings one raw ticker may map to, tried IN ORDER.
 *
 * A bare ticker means its primary listing — `VOO` the US ETF, `BBCA` the IDX
 * company the symbol map names. The `.JK` guess is an ALTERNATE tried only
 * after the primary yields nothing: `resolveSymbolIDX` used to append `.JK`
 * by default, which is how a US ETF arrived as a non-existent Indonesian
 * entry and the dashboard stayed silent about the substitutions it made.
 */
function staticTickerCandidates(raw: string): string[] {
  const upper = raw.trim().toUpperCase();
  const candidates: string[] = [];
  const push = (symbol?: string | null) => {
    const next = symbol?.trim().toUpperCase() ?? '';
    if (next && !candidates.includes(next)) candidates.push(next);
  };
  push(resolveSymbol(upper) ?? upper);
  // A bare 2–6 letter code picks up the IDX listing as a SECOND candidate,
  // never the first lookup.
  if (/^[A-Z]{2,6}$/.test(upper) && !upper.includes('.')) push(`${upper}.JK`);
  return candidates;
}

/**
 * Listings Yahoo itself matches to the name — run ONCE, after the static
 * candidates miss. This is what turns "S&P 500" into ^GSPC without the
 * engine ever guessing a suffix at the instrument.
 */
async function searchTickerSymbols(raw: string, exclude: Set<string>): Promise<string[]> {
  try {
    const results = await yahooFinance.search(raw, {}, { validateResult: false }).catch(() => null) as any;
    const quotes: any[] = results?.quotes ?? [];
    return quotes
      .filter((q) => typeof q.symbol === 'string' && (
        q.quoteType === 'EQUITY'
        || q.quoteType === 'ETF'
        || q.quoteType === 'INDEX'
        || q.quoteType === 'CRYPTOCURRENCY'
        || q.quoteType === 'CURRENCY'
      ))
      .map((q) => String(q.symbol).toUpperCase())
      .filter((symbol) => !exclude.has(symbol))
      .slice(0, 3);
  } catch {
    return [];
  }
}

// ─── Tool Executors ───────────────────────────────────────────────────────────

export async function executeFetchTickerDashboard(raw: string): Promise<string> {
  const upper = raw.trim().toUpperCase();
  const tried: string[] = [];
  const failures: string[] = [];

  // Primary listing first, format alternates after a miss, Yahoo discovery last.
  const statics = staticTickerCandidates(upper);
  for (const symbol of statics) {
    tried.push(symbol);
    const outcome = await tryDashboardFetch(symbol);
    if (outcome.kind === 'ok') return outcome.content;
    if (outcome.kind === 'error') failures.push(outcome.message);
  }

  const discovered = await searchTickerSymbols(upper, new Set(statics));
  for (const symbol of discovered) {
    tried.push(symbol);
    const outcome = await tryDashboardFetch(symbol);
    if (outcome.kind === 'ok') return outcome.content;
    if (outcome.kind === 'error') failures.push(outcome.message);
  }

  // One friendly sentence up front — it is the line the thinking panel quotes
  // — with the technical specifics parked behind a Details line. "returned no
  // results" doubles as the engine's marker that this call FAILED, so the
  // panel shows the failure instead of a silent success.
  const attempts = tried.join(', ') || upper;
  const details = failures.length > 0 ? `\n\nDetails: ${failures[0].slice(0, 300)}` : '';
  return `BOZ could not load a ${upper} dashboard — the market data service returned no results for the listings tried (${attempts}). Ask the user to check the symbol, or work from another source.${details}`;
}

type DashboardOutcome =
  | { kind: 'ok'; content: string }
  | { kind: 'no-data' }
  | { kind: 'error'; message: string };

/**
 * Runs the full dashboard build for ONE resolved symbol.
 *
 * `no-data` means the listing answered but carries no tape (the instrument is
 * probably not real), so the caller can try the next candidate format.
 * `error` preserves the transport message for the friendly tail.
 */
async function tryDashboardFetch(symbol: string): Promise<DashboardOutcome> {
  try {
    const yahoo = new YahooService();
    const indicators = new IndicatorsService();
    const chartAnalyzer = new ChartAnalyzer();
    const macroService = new MacroService();
    const sentimentService = new SentimentService();
    const newsService = new NewsService();
    const pair = parseFxSymbol(symbol);

    const fromHourly = new Date();
    fromHourly.setDate(fromHourly.getDate() - 7);

    const fromDaily = new Date();
    fromDaily.setDate(fromDaily.getDate() - 420);

    const fromWeekly = new Date();
    fromWeekly.setDate(fromWeekly.getDate() - 730);

    const [candlesRawIn, hourlyCandlesRawIn, weeklyCandlesRawIn, quoteRaw, macro, sentiment, rawHeadlines] = await Promise.all([
      yahoo.getHistoricalData(symbol, fromDaily, '1d', false, { adjustPrices: !pair }),
      yahoo.getHistoricalData(symbol, fromHourly, '1h', false, { adjustPrices: !pair }).catch(() => []),
      yahoo.getHistoricalData(symbol, fromWeekly, '1wk', false, { adjustPrices: !pair }).catch(() => []),
      // Validation off so commodities/FX/indices still populate the snapshot.
      yahooFinance.quote(symbol, {}, { validateResult: false }).catch(() => null),
      macroService.getMacroContext(symbol).catch(() => null),
      sentimentService.fetchCrowdSentiment(symbol).catch(() => null),
      // A pair reads as "EUR/USD" in a news query, not as "EURUSD=X".
      newsService.getStockNews(pair ? pair.pair : symbol).catch(() => [] as string[]),
    ]);

    const candlesRaw = pair ? sanitizeFxCandles(candlesRawIn, '1d') : candlesRawIn;
    const hourlyCandlesRaw = pair ? sanitizeFxCandles(hourlyCandlesRawIn, '1h') : hourlyCandlesRawIn;
    const weeklyCandlesRaw = pair ? sanitizeFxCandles(weeklyCandlesRawIn, '1wk') : weeklyCandlesRawIn;

    if (!candlesRaw.length) {
      // This listing answered but has no tape — another candidate may carry it.
      return { kind: 'no-data' };
    }

    // 1D Daily Indicators & Analysis
    const candles = indicators.calculateAll(candlesRaw);
    const weeklyCandles = weeklyCandlesRaw.length ? indicators.calculateAll(weeklyCandlesRaw) : [];
    const hourlyCandles = hourlyCandlesRaw.length ? indicators.calculateAll(hourlyCandlesRaw) : [];
    if (pair) {
      // FX has no tape. Clearing both fields is what stops the dashboard from
      // emitting volume and OBV signals on a fabricated zero-volume series.
      for (const series of [candles, weeklyCandles, hourlyCandles]) {
        const last = series.at(-1);
        if (!last) continue;
        last.Volume_Ratio = undefined;
        last.OBV_Trend = undefined;
      }
    }
    const patterns = chartAnalyzer.analyzeChartPatterns(candles);
    const q = quoteRaw as any;
    const quote: QuoteSnapshot = {
      name: pair ? pair.pair : q?.longName ?? q?.shortName ?? symbol,
      // Volume and market cap do not exist for a currency pair.
      marketCap: pair ? null : q?.marketCap ?? null,
      fiftyTwoWeekHigh: q?.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: q?.fiftyTwoWeekLow ?? null,
      previousClose: q?.regularMarketPreviousClose ?? null,
      marketState: q?.marketState ?? null,
      quoteType: pair ? 'CURRENCY' : q?.quoteType ?? q?.typeDisp ?? null,
      exchange: pair ? 'FX' : q?.fullExchangeName ?? q?.exchange ?? null,
      currency: q?.currency ?? null,
      averageVolume: pair ? null : q?.averageDailyVolume3Month ?? q?.averageDailyVolume10Day ?? null,
    };

    // An index is quoted in points, not dollars, and its "volume" is index-level
    // volume — counting it as though it were share volume is the exact mixup
    // the dashboard must never print.
    const isIndexQuote = !pair && (
      String(q?.quoteType ?? q?.typeDisp ?? '').toUpperCase() === 'INDEX'
      || symbol.startsWith('^')
    );

    const analysis = buildDashboardAnalysis({ ticker: symbol, candles, quote, patterns });
    const lastCandle = candles[candles.length - 1];
    const lastWeekly = weeklyCandles.length ? weeklyCandles[weeklyCandles.length - 1] : null;

    // 50-Day High / Low / Range
    const last50 = candles.slice(-50);
    const high50d = last50.length ? Math.max(...last50.map(c => c.high)) : null;
    const low50d = last50.length ? Math.min(...last50.map(c => c.low)) : null;
    const range50dPct = (high50d && low50d && low50d > 0) ? (((high50d - low50d) / low50d) * 100) : null;
    const from50dHighPct = (high50d && high50d > 0) ? (((analysis.structure.price - high50d) / high50d) * 100) : null;
    const from50dLowPct = (low50d && low50d > 0) ? (((analysis.structure.price - low50d) / low50d) * 100) : null;
    const range50dPos = (high50d && low50d && high50d > low50d) ? (((analysis.structure.price - low50d) / (high50d - low50d)) * 100) : null;

    // Moving average distance percentages
    const distSma20Pct = lastCandle?.SMA_20 ? (((analysis.structure.price - lastCandle.SMA_20) / lastCandle.SMA_20) * 100) : null;
    const distSma50Pct = lastCandle?.SMA_50 ? (((analysis.structure.price - lastCandle.SMA_50) / lastCandle.SMA_50) * 100) : null;
    const distSma200Pct = lastCandle?.SMA_200 ? (((analysis.structure.price - lastCandle.SMA_200) / lastCandle.SMA_200) * 100) : null;

    // Weekly Trend & Momentum
    const weeklyTrend = analysis.structure.weeklyLikeTrend;
    const weeklyRsi = lastWeekly?.RSI != null ? lastWeekly.RSI.toFixed(1) : 'N/A';
    const weeklyMacd = lastWeekly?.MACD != null ? `${lastWeekly.MACD.toFixed(3)} (Sig: ${lastWeekly.MACD_Signal?.toFixed(3) || 'N/A'}, Hist: ${lastWeekly.MACD_Hist?.toFixed(3) || 'N/A'})` : 'N/A';
    const weeklySma20Dist = lastWeekly?.SMA_20 ? (((analysis.structure.price - lastWeekly.SMA_20) / lastWeekly.SMA_20) * 100) : null;

    // ── Formatting helpers ───────────────────────────────────────────────────
    // A pair is quoted in its own precision, never with a dollar sign, and its
    // distances are read in pips. An index is quoted in points, never with a
    // dollar sign either. Equities keep the original $ formatting.
    const hasDecimals = (value: number | null | undefined): value is number =>
      value != null && Number.isFinite(value);
    const px = (value: number | null | undefined): string => {
      if (!hasDecimals(value)) return '--';
      return pair ? value.toFixed(pair.precision) : value.toFixed(2);
    };
    const pipDistance = (value: number | null | undefined): string => {
      if (!pair || !hasDecimals(value)) return '';
      const pips = value / pair.pipSize;
      return ` (${pips >= 0 ? '+' : ''}${pips.toFixed(1)} pips)`;
    };
    const priceWithUnit = (value: number | null | undefined): string => {
      if (pair || isIndexQuote) return px(value);
      return `$${px(value)}`;
    };
    // The headline carries the unit once: "4166.20 pts" reads as an index
    // level; an equity keeps "$216.91"; a pair is unitless at its precision.
    const headlinePrice = (value: number | null | undefined): string => {
      if (pair) return px(value);
      if (isIndexQuote) return `${px(value)} pts`;
      return `$${px(value)}`;
    };
    const changeValue = q?.regularMarketChange;
    const changePct = q?.regularMarketChangePercent;
    const changePips = pair && hasDecimals(changeValue) ? changeValue / pair.pipSize : null;

    // Recent Hourly Candles (Past 6-8 Hours)
    const recentHourlyFormatted = hourlyCandles.slice(-8).map(c => {
      const timeStr = c.date instanceof Date ? c.date.toISOString().replace('T', ' ').slice(11, 16) + ' UTC' : String(c.date);
      // A zero-open candle is malformed: it carries no measurable change, so
      // the direction label is dropped rather than faking (UP 0.00%).
      const changeLabel = c.open > 0
        ? ` (${c.close >= c.open ? 'UP' : 'DOWN'} ${(((c.close - c.open) / c.open) * 100).toFixed(2)}%)`
        : '';
      const volumeLabel = pair ? '' : isIndexQuote ? ` | Vol (index-level): ${(c.volume / 1e3).toFixed(0)}k` : ` | Vol: ${(c.volume / 1e3).toFixed(0)}k`;
      return `    • [${timeStr}] Open: ${priceWithUnit(c.open)} | High: ${priceWithUnit(c.high)} | Low: ${priceWithUnit(c.low)} | Close: ${priceWithUnit(c.close)}${volumeLabel}${changeLabel}`;
    }).join('\n');

    // News scoring
    const scoredNews = scoreHeadlines(rawHeadlines.filter(h => h && !h.startsWith('No significant')));

    // Format full dataset sections
    const sections: string[] = [];

    // 1. Header & Valuation
    const fundamentals = pair
      ? `Pair: ${pair.pair} · Class: ${pair.class.toUpperCase()} · Precision: ${pair.precision} dp · Pip: ${pair.pipSize}\n` +
        `Market State: ${quote.marketState || 'CLOSED'} | Base: ${pair.base} | Quote: ${pair.quote}`
      : `Company: ${quote.name || symbol} · Exchange: ${quote.exchange || 'MARKET'} · Type: ${quote.quoteType || 'EQUITY'} · Currency: ${quote.currency || 'USD'}\n` +
        `Market State: ${quote.marketState || 'CLOSED'} | Trailing P/E: ${q?.trailingPE ? q.trailingPE.toFixed(1) + 'x' : 'N/A'} | Forward P/E: ${q?.forwardPE ? q.forwardPE.toFixed(1) + 'x' : 'N/A'}`;

    const activity = pair
      ? `Change: ${hasDecimals(changeValue) ? (changeValue >= 0 ? '+' : '') + px(changeValue) : '--'}${changePips != null ? ` (${changePips >= 0 ? '+' : ''}${changePips.toFixed(1)} pips)` : ''} (${hasDecimals(changePct) ? (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%' : '--%'}) | Day Volume: not reported for FX\n` +
        `Day Range: Low ${px(q?.regularMarketDayLow)} – High ${px(q?.regularMarketDayHigh)} | Open: ${px(q?.regularMarketOpen)} | Prev Close: ${px(quote.previousClose)}\n` +
        `52W Range: ${px(analysis.structure.low52w)} – ${px(analysis.structure.high52w)} (${analysis.structure.from52wHighPct?.toFixed(1) || '--'}% from high, +${analysis.structure.from52wLowPct?.toFixed(1) || '--'}% from low, Range Pos: ${analysis.structure.range52wPos?.toFixed(0) || '--'}%)`
      : `Last Price: ${headlinePrice(analysis.structure.price)} | Change: ${hasDecimals(changeValue) ? (changeValue >= 0 ? '+' : '') + changeValue.toFixed(2) : '--'} (${hasDecimals(changePct) ? (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%' : '--%'})\n` +
        `Day Range: Low ${priceWithUnit(q?.regularMarketDayLow)} – High ${priceWithUnit(q?.regularMarketDayHigh)} | Open: ${priceWithUnit(q?.regularMarketOpen)} | Prev Close: ${priceWithUnit(quote.previousClose)}\n` +
        (isIndexQuote
          ? `Day Volume (index-level): ${q?.regularMarketVolume ? (q.regularMarketVolume / 1e6).toFixed(2) + 'M' : '--'} (20D Avg (index-level): ${quote.averageVolume ? (quote.averageVolume / 1e6).toFixed(2) + 'M' : '--'}, Vol Ratio: ${analysis.structure.volumeRatio?.toFixed(2) || '--'}x)\n`
          : `Day Volume: ${q?.regularMarketVolume ? (q.regularMarketVolume / 1e6).toFixed(2) + 'M' : '--'} (20D Avg: ${quote.averageVolume ? (quote.averageVolume / 1e6).toFixed(2) + 'M' : '--'}, Vol Ratio: ${analysis.structure.volumeRatio?.toFixed(2) || '--'}x)\n`) +
        `Market Cap: ${quote.marketCap ? '$' + (quote.marketCap / 1e12 >= 1 ? (quote.marketCap / 1e12).toFixed(2) + 'T' : (quote.marketCap / 1e9).toFixed(2) + 'B') : '--'} | 52W Range: ${priceWithUnit(analysis.structure.low52w)} – ${priceWithUnit(analysis.structure.high52w)} (${analysis.structure.from52wHighPct?.toFixed(1) || '--'}% from ATH, +${analysis.structure.from52wLowPct?.toFixed(1) || '--'}% from 52w low, Range Pos: ${analysis.structure.range52wPos?.toFixed(0) || '--'}%)`;

    sections.push(
      `=== ${pair ? pair.pair : symbol} DASHBOARD OVERVIEW ===\n` +
      `${fundamentals}\n` +
      (pair ? `Last Price: ${px(analysis.structure.price)} | ` : '') +
      activity
    );

    // 2. Quantitative Verdict & Decision Engine
    sections.push(
      `=== QUANTITATIVE VERDICT & SCORE ===\n` +
      `Overall Score: ${analysis.score >= 0 ? '+' : ''}${analysis.score}/100 (${analysis.scoreLabel})\n` +
      `Directional Bias: ${analysis.bias} · Conviction: ${analysis.conviction}\n` +
      `8 Confluence Signals Matrix:\n` +
      analysis.signals.map(s => `  • ${s.label}: ${s.detail} [${s.bias} | Weight: ${s.weight}]`).join('\n')
    );

    // 3. Multi-Timeframe Technical Landscape (1H Intraday vs 1D Daily vs 1W Weekly)
    sections.push(
      `=== MULTI-TIMEFRAME TECHNICAL STRUCTURE ===\n` +
      `[1H Intraday Frame (Past Hourly Candles)]:\n` +
      (recentHourlyFormatted || '    • Hourly candles unavailable') + '\n' +
      `[Daily 1D Frame]:\n` +
      `  • 50-Day Positioning: High ${priceWithUnit(high50d)} | Low ${priceWithUnit(low50d)} | Range Width: ${range50dPct?.toFixed(1) || '--'}% | Pos in 50D Range: ${range50dPos?.toFixed(0) || '--'}% (${from50dHighPct?.toFixed(1) || '--'}% from 50d high, +${from50dLowPct?.toFixed(1) || '--'}% from 50d low)\n` +
      `  • 52-Week Positioning: High ${priceWithUnit(analysis.structure.high52w)} | Low ${priceWithUnit(analysis.structure.low52w)} | Pos in 52W Range: ${analysis.structure.range52wPos?.toFixed(0) || '--'}% (${analysis.structure.from52wHighPct?.toFixed(1) || '--'}% from high, +${analysis.structure.from52wLowPct?.toFixed(1) || '--'}% from 52w low)\n` +
      `  • RSI(14): ${analysis.structure.rsi?.toFixed(1) || '--'} (${analysis.structure.rsi && analysis.structure.rsi > 70 ? 'Overbought (Extended)' : analysis.structure.rsi && analysis.structure.rsi < 30 ? 'Oversold (Mean Reversion Bounce Candidate)' : 'Balanced/Neutral'})\n` +
      `  • MACD Momentum: MACD Line: ${lastCandle?.MACD?.toFixed(4) || '--'} | Signal: ${lastCandle?.MACD_Signal?.toFixed(4) || '--'} | Hist: ${lastCandle?.MACD_Hist?.toFixed(4) || '--'} (${lastCandle?.MACD_Hist && lastCandle.MACD_Hist > 0 ? 'Bullish Expansion' : 'Bearish Contraction / Pullback'})\n` +
      `  • Moving Average Stack: SMA 20 (${priceWithUnit(lastCandle?.SMA_20)}, ${distSma20Pct != null ? (distSma20Pct >= 0 ? '+' : '') + distSma20Pct.toFixed(2) + '%' : '--'}), SMA 50 (${priceWithUnit(lastCandle?.SMA_50)}, ${distSma50Pct != null ? (distSma50Pct >= 0 ? '+' : '') + distSma50Pct.toFixed(2) + '%' : '--'}), SMA 200 (${priceWithUnit(lastCandle?.SMA_200)}, ${distSma200Pct != null ? (distSma200Pct >= 0 ? '+' : '') + distSma200Pct.toFixed(2) + '%' : '--'}) -> Stack Status: ${analysis.structure.smaStack}\n` +
      `  • Golden/Death Cross: ${lastCandle?.SMA_50 && lastCandle?.SMA_200 && lastCandle.SMA_50 > lastCandle.SMA_200 ? 'Golden Cross active (50 > 200)' : 'Death Cross active (50 < 200)'}\n` +
      `  • Volatility & Bands: ATR: ${priceWithUnit(analysis.structure.atr)}${pipDistance(analysis.structure.atr)} (${analysis.structure.atrPercent?.toFixed(2) || '--'}% of price) | BB Width: ${lastCandle?.BB_Width?.toFixed(2) || '--'}% (Upper: ${priceWithUnit(lastCandle?.BB_High)}, Mid: ${priceWithUnit(lastCandle?.BB_Mid)}, Lower: ${priceWithUnit(lastCandle?.BB_Low)} | Position: ${analysis.structure.bbPosition})\n` +
      (pair
        ? `  • Volume & Flow: not applicable — FX quotes carry no consolidated volume or OBV reading\n`
        : isIndexQuote
          ? `  • Volume & Flow: Volume (index-level): ${q?.regularMarketVolume ? (q.regularMarketVolume / 1e6).toFixed(2) + 'M' : '--'} (Ratio: ${analysis.structure.volumeRatio?.toFixed(2) || '--'}x) | OBV Trend: ${analysis.structure.obvTrend ? 'Bullish Accumulation (Smart Money Inflow)' : 'Bearish Distribution (Smart Money Outflow)'}\n`
          : `  • Volume & Flow: Volume: ${q?.regularMarketVolume ? (q.regularMarketVolume / 1e6).toFixed(2) + 'M' : '--'} (Ratio: ${analysis.structure.volumeRatio?.toFixed(2) || '--'}x) | OBV Trend: ${analysis.structure.obvTrend ? 'Bullish Accumulation (Smart Money Inflow)' : 'Bearish Distribution (Smart Money Outflow)'}\n`) +
      `[Weekly 1W Macro Frame]:\n` +
      `  • Macro Trend: ${weeklyTrend}\n` +
      `  • Weekly RSI(14): ${weeklyRsi}\n` +
      `  • Weekly MACD: ${weeklyMacd}\n` +
      `  • Weekly SMA 20: ${priceWithUnit(lastWeekly?.SMA_20)} (${weeklySma20Dist != null ? (weeklySma20Dist >= 0 ? '+' : '') + weeklySma20Dist.toFixed(2) + '%' : '--'}) | Weekly SMA 50: ${priceWithUnit(lastWeekly?.SMA_50)}`
    );

    // 4. Candlestick & Chart Patterns
    sections.push(
      `=== PRICE ACTION, CANDLE DYNAMICS & LEVELS ===\n` +
      `Chart Patterns: ${patterns.patterns?.length ? patterns.patterns.join(', ') : 'None detected'}\n` +
      `Candlestick Dynamics: ${patterns.candle_patterns?.summary_text || 'None'}\n` +
      (patterns.candle_patterns?.signals?.length ? `Detected Candles: ${patterns.candle_patterns.signals.map((c: any) => `${c.name} (${c.bias}, ${c.confidence}) - ${c.meaning}`).join('; ')}\n` : '') +
      `Support Floor: ${priceWithUnit(analysis.support)} | Resistance Ceiling: ${priceWithUnit(analysis.resistance)}\n` +
      `Fibonacci Position: ${patterns.fibonacci_position || 'N/A'}\n` +
      `Dashboard Insights: ${analysis.insights.join('; ')}`
    );

    // 5. Actionable Trading Execution Plan
    sections.push(
      `=== ACTIONABLE TRADING PLAN ===\n` +
      `Action: ${analysis.plan.action} (Status: ${analysis.plan.status})\n` +
      `Setup: ${analysis.plan.setup}\n` +
      `Optimal Entry Zone: ${priceWithUnit(analysis.plan.entry)}${pipDistance(analysis.plan.entry != null && analysis.plan.stop != null ? analysis.plan.entry - analysis.plan.stop : null)} (${analysis.plan.entryLabel || 'Reaction Zone'})\n` +
      `Stop Loss: ${priceWithUnit(analysis.plan.stop)}${pipDistance(analysis.plan.entry != null && analysis.plan.stop != null ? analysis.plan.stop - analysis.plan.entry : null)} (${analysis.structure.atrPercent != null ? `ATR Buffer Rule: Stops tighter than ${analysis.structure.atrPercent.toFixed(1)}% get shaken out in normal market noise` : 'ATR Buffer Rule: size the stop from the ATR reading once it is available'})\n` +
      `Target 1: ${priceWithUnit(analysis.plan.target1)}${pipDistance(analysis.plan.target1 != null && analysis.plan.entry != null ? analysis.plan.target1 - analysis.plan.entry : null)} | Target 2: ${priceWithUnit(analysis.plan.target2)} | R:R to Target 1: ${analysis.plan.riskReward || '--'}\n` +
      (pair
        ? `Execution Trigger & Conditions: ${analysis.plan.notes || 'Wait for a close through the level, then size the position from pips at risk (see fx_risk_calc).'}`
        : `Execution Trigger & Conditions: ${analysis.plan.notes || 'Wait for a close that reclaims moving average or breaks nearby level with volume.'}`)
    );

    // 6. Cross-Asset Macro Context
    if (macro) {
      sections.push(
        `=== MACRO & CROSS-ASSET MATRIX ===\n` +
        `Market Regime: ${macro.market_regime} · Risk Sentiment: ${macro.risk_sentiment}\n` +
        `VIX Volatility: ${macro.vix_level?.toFixed(2) || '--'} (${macro.vix_level && macro.vix_level > 25 ? 'High Volatility' : macro.vix_level && macro.vix_level < 16 ? 'Low Volatility/Complacency' : 'Moderate Volatility'})\n` +
        `US 10-Year Treasury Yield: ${macro.tnx_yield != null ? macro.tnx_yield.toFixed(2) + '%' : '--'}\n` +
        `SPY 500 Correlation: ${macro.sp500_correlation} (Beta: ${macro.sp500_beta?.toFixed(2) || '--'})\n` +
        `QQQ Nasdaq Correlation: ${macro.nasdaq_correlation} (Beta: ${macro.nasdaq_beta?.toFixed(2) || '--'})`
      );
    }

    // 7. Crowd & Social Sentiment Pulse
    if (sentiment) {
      const st = sentiment.stocktwits_data;
      const reddit = sentiment.social_buzz?.find((b: any) => b.source === 'Reddit');
      const sampleMessages = st?.sample_messages?.length
        ? st.sample_messages.slice(0, 3).map((m: any) => `    • @${m.username || 'user'} [${m.sentiment || 'NEUTRAL'}]: "${m.body}"`).join('\n')
        : (st?.top_message ? `    • "${st.top_message}"` : '    • None');

      sections.push(
        `=== CROWD & SOCIAL SENTIMENT ===\n` +
        `${formatCrowdSignalEvidence(sentiment) || 'No source-attributed crowd observations were available.'}\n` +
        `StockTwits Watchlist: ${st?.watchlist_count ? Number(st.watchlist_count).toLocaleString() + ' watchers' : 'Active watchlist'}\n` +
        `Community Voices:\n${sampleMessages}\n` +
        (reddit ? `Reddit Buzz: ${reddit.mentions || 0} mentions (${reddit.top_posts?.slice(0, 2).join('; ') || 'High activity'})\n` : '')
      );
    }

    // 8. Recent Live News Headlines
    if (rawHeadlines.length > 0) {
      sections.push(
        `=== RECENT NEWS HEADLINES (Sentiment: ${scoredNews.sentiment}) ===\n` +
        rawHeadlines.slice(0, 5).map((h, i) => `  ${i + 1}. ${h}`).join('\n')
      );
    }

    sections.push(`TICKER DIRECT LINK: /ticker/${encodeURIComponent(symbol)}`);

    return { kind: 'ok', content: sections.join('\n\n') };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function executeFetchPrice(raw: string): Promise<string> {
  const upper = raw.trim().toUpperCase();
  const tried: string[] = [];

  // Primary listing first; the `.JK` format and Yahoo-discovered listings are
  // only tried after the primary fails to quote. Appending an exchange
  // suffix by default is what turned VOO into a non-existent IDX entry.
  const statics = staticTickerCandidates(upper);
  for (const symbol of statics) {
    tried.push(symbol);
    const observation = await tryPriceFetch(symbol);
    if (observation) return observation;
  }

  const discovered = await searchTickerSymbols(upper, new Set(statics));
  for (const symbol of discovered) {
    tried.push(symbol);
    const observation = await tryPriceFetch(symbol);
    if (observation) return observation;
  }

  // The lead sentence is the line the thinking panel quotes; "returned no
  // results" doubles as the engine's marker for an honestly-failed call.
  const attempts = tried.join(', ') || upper;
  const matches = await closestListings(raw);
  if (matches.length > 0) {
    return `BOZ could not get a live quote for "${raw}" — the quote service returned no results for the formats tried (${attempts}). Closest listings: ${matches.join(', ')}. Ask the user which listing they meant.`;
  }
  return `BOZ could not get a live quote for "${raw}" — the quote service returned no results for the formats tried (${attempts}). Ask the user to double-check the symbol.`;
}

/** Quotes ONE resolved symbol; undefined when it offers no price at all. */
async function tryPriceFetch(symbol: string): Promise<string | undefined> {
  try {
    // Validation off: the schema rejects whole symbols for commodities and FX,
    // which made `GC=F` and `EURUSD=X` report as "not found" despite existing.
    const quote = await yahooFinance.quote(symbol, {}, { validateResult: false });
    const price = (quote as any)?.regularMarketPrice;
    const change = (quote as any)?.regularMarketChangePercent;
    if (price === undefined || price === null) return undefined;

    const chgNum = typeof change === 'number' ? change : 0;
    const name = (quote as any).shortName || (quote as any).longName || symbol;
    const dayHigh = (quote as any).regularMarketDayHigh;
    const dayLow = (quote as any).regularMarketDayLow;
    const prevClose = (quote as any).regularMarketPreviousClose;
    const changeAbs = (quote as any).regularMarketChange;
    const pair = parseFxSymbol(symbol);

    if (pair) {
      // A pair has no dollar price and its move is read in pips.
      const rate = Number(price).toFixed(pair.precision);
      const pips = typeof changeAbs === 'number' ? changeAbs / pair.pipSize : null;
      const range = dayHigh != null && dayLow != null
        ? `${Number(dayLow).toFixed(pair.precision)} – ${Number(dayHigh).toFixed(pair.precision)}`
        : null;
      return [
        `Pair: ${pair.pair} (${symbol}) | Rate: ${rate} | Change: ${chgNum.toFixed(2)}%${pips != null ? ` (${pips >= 0 ? '+' : ''}${pips.toFixed(1)} pips)` : ''}`,
        range ? `Day Range: ${range}` : '',
        prevClose != null ? `Prev Close: ${Number(prevClose).toFixed(pair.precision)}` : '',
        `Pip Size: ${pair.pipSize} | Precision: ${pair.precision} dp`,
      ].filter(Boolean).join(' | ');
    }

    return [
      `Symbol: ${symbol} | Name: ${name} | Price: ${price} (Change: ${chgNum.toFixed(2)}%)`,
      dayHigh != null ? `Day Range: ${dayLow} – ${dayHigh}` : '',
      prevClose != null ? `Prev Close: ${prevClose}` : '',
    ].filter(Boolean).join(' | ');
  } catch {
    // This format could not be quoted; the caller tries the next candidate.
    return undefined;
  }
}

/** Listings Yahoo matches to a free-text name, for the clarification line. */
async function closestListings(raw: string): Promise<string[]> {
  try {
    const searchResults = await yahooFinance.search(raw, {}, { validateResult: false }).catch(() => null) as any;
    return (searchResults?.quotes || [])
      .filter((q: any) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'CRYPTOCURRENCY' || q.quoteType === 'INDEX' || q.quoteType === 'CURRENCY'))
      .slice(0, 3)
      .map((q: any) => `${q.symbol} (${q.shortname || q.longname || q.symbol})`);
  } catch {
    return [];
  }
}

// ─── Fact Extractors ──────────────────────────────────────────────────────────

export function extractTickerDashboardFact(symbol: string, obs: string) {
  const pm = obs.match(/Last Price:\s*\$?([\d,.]+)/);
  const bm = obs.match(/Directional Bias:\s*([^\n·]+)/);
  const sm = obs.match(/Overall Score:\s*([^\n(]+)/);
  const am = obs.match(/Action:\s*([^\n(]+)/);
  const em = obs.match(/Optimal Entry(?: Zone)?:\s*\$?([\d,.]+)/);
  const tm = obs.match(/Target 1:\s*\$?([\d,.]+)/);
  const stm = obs.match(/Stop Loss:\s*\$?([\d,.]+)/);
  const atrm = obs.match(/ATR:\s*\$?([\d,.]+)(?:\s*\(([^)]+)\))?/);
  const rsim = obs.match(/RSI\(14\):\s*([\d,.]+)/);
  const suppm = obs.match(/Support Floor:\s*\$?([\d,.]+)/);
  const resm = obs.match(/Resistance Ceiling:\s*\$?([\d,.]+)/);
  const regm = obs.match(/Market Regime:\s*([^\n·]+)/);

  const priceStr = pm ? `Price: ${pm[1]}` : '';
  const biasStr = bm ? `Bias: ${bm[1].trim()}` : '';
  const scoreStr = sm ? `Score: ${sm[1].trim()}` : '';
  const planStr = am ? `Plan: ${am[1].trim()} (Entry: ${em?.[1] || '--'}, Stop: ${stm?.[1] || '--'}, T1: ${tm?.[1] || '--'})` : '';
  const techStr = [
    atrm ? `ATR: ${atrm[1]}${atrm[2] ? ' (' + atrm[2] + ')' : ''}` : '',
    rsim ? `RSI: ${rsim[1]}` : '',
    suppm ? `Support: ${suppm[1]}` : '',
    resm ? `Resistance: ${resm[1]}` : '',
    regm ? `Regime: ${regm[1].trim()}` : '',
  ].filter(Boolean).join(', ');

  const fullFact = `${symbol}: ${priceStr}, ${biasStr} (${scoreStr}). ${planStr}${techStr ? ' | ' + techStr : ''}`.trim();

  return {
    step: 0,
    tool: 'fetch_ticker_dashboard',
    fact: fullFact,
    quality: (pm ? 'confirmed' : 'empty') as 'confirmed' | 'empty',
  };
}

export function extractPriceFact(symbolOrName: string, obs: string) {
  const pm = obs.match(/Price:\s*([\d,.]+)/);
  const cm = obs.match(/Change:\s*([-\d.]+)%/);
  const nm = obs.match(/Name:\s*([^|]+)/);
  if (pm) {
    return {
      step: 0,
      tool: 'fetch_price',
      fact: `${nm?.[1]?.trim() ?? symbolOrName}: price ${pm[1]}${cm ? ', change ' + cm[1] + '%' : ''}`,
      quality: 'confirmed' as const,
    };
  }
  return {
    step: 0,
    tool: 'fetch_price',
    fact: `${symbolOrName}: no price data found`,
    quality: 'empty' as const,
  };
}

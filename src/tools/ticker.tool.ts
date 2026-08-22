import { YahooService, yahooFinance } from '../services/market/yahoo.service.js';
import { IndicatorsService } from '../services/market/indicators.service.js';
import { MacroService } from '../services/market/macro.service.js';
import { ChartAnalyzer } from '../analyzers/chart.analyzer.js';
import { buildDashboardAnalysis, scoreHeadlines, type QuoteSnapshot } from '../shared/dashboard-analysis.js';
import { SentimentService } from '../services/market/sentiment.service.js';
import { NewsService } from '../services/news/news.service.js';
import { resolveSymbolIDX } from '../shared/market-constants.js';

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
      'Use this whenever the user asks for in-depth analysis, outlook, or trade setups on any stock/crypto/index ticker.'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Ticker symbol (e.g. NVDA, AAPL, BBCA, BTC-USD, ^GSPC)',
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
          description: 'Ticker symbol or company name (e.g. NVDA, AAPL, BBCA, BTC-USD)',
        },
      },
      required: ['symbol_or_name'],
    },
  },
};

// ─── Tool Executors ───────────────────────────────────────────────────────────

export async function executeFetchTickerDashboard(raw: string): Promise<string> {
  const symbol = resolveSymbolIDX(raw) || raw.toUpperCase();
  try {
    const yahoo = new YahooService();
    const indicators = new IndicatorsService();
    const chartAnalyzer = new ChartAnalyzer();
    const macroService = new MacroService();
    const sentimentService = new SentimentService();
    const newsService = new NewsService();

    const fromHourly = new Date();
    fromHourly.setDate(fromHourly.getDate() - 7);

    const fromDaily = new Date();
    fromDaily.setDate(fromDaily.getDate() - 420);

    const fromWeekly = new Date();
    fromWeekly.setDate(fromWeekly.getDate() - 730);

    const [candlesRaw, hourlyCandlesRaw, weeklyCandlesRaw, quoteRaw, macro, sentiment, rawHeadlines] = await Promise.all([
      yahoo.getHistoricalData(symbol, fromDaily, '1d', false, { adjustPrices: true }),
      yahoo.getHistoricalData(symbol, fromHourly, '1h', false, { adjustPrices: true }).catch(() => []),
      yahoo.getHistoricalData(symbol, fromWeekly, '1wk', false, { adjustPrices: true }).catch(() => []),
      yahooFinance.quote(symbol).catch(() => null),
      macroService.getMacroContext().catch(() => null),
      sentimentService.fetchCrowdSentiment(symbol).catch(() => null),
      newsService.getStockNews(symbol).catch(() => [] as string[]),
    ]);

    if (!candlesRaw.length) {
      return `No market data available for ${symbol}. Please check if the ticker is valid.`;
    }

    // 1D Daily Indicators & Analysis
    const candles = indicators.calculateAll(candlesRaw);
    const weeklyCandles = weeklyCandlesRaw.length ? indicators.calculateAll(weeklyCandlesRaw) : [];
    const hourlyCandles = hourlyCandlesRaw.length ? indicators.calculateAll(hourlyCandlesRaw) : [];
    const patterns = chartAnalyzer.analyzeChartPatterns(candles);
    const q = quoteRaw as any;
    const quote: QuoteSnapshot = {
      name: q?.longName ?? q?.shortName ?? symbol,
      marketCap: q?.marketCap ?? null,
      fiftyTwoWeekHigh: q?.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: q?.fiftyTwoWeekLow ?? null,
      previousClose: q?.regularMarketPreviousClose ?? null,
      marketState: q?.marketState ?? null,
      quoteType: q?.quoteType ?? q?.typeDisp ?? null,
      exchange: q?.fullExchangeName ?? q?.exchange ?? null,
      currency: q?.currency ?? null,
      averageVolume: q?.averageDailyVolume3Month ?? q?.averageDailyVolume10Day ?? null,
    };

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

    // Recent Hourly Candles (Past 6-8 Hours)
    const recentHourlyFormatted = hourlyCandles.slice(-8).map(c => {
      const timeStr = c.date instanceof Date ? c.date.toISOString().replace('T', ' ').slice(11, 16) + ' UTC' : String(c.date);
      const chg = c.open > 0 ? (((c.close - c.open) / c.open) * 100).toFixed(2) : '0.00';
      const dir = c.close >= c.open ? '🟢' : '🔴';
      return `    • [${timeStr}] Open: $${c.open.toFixed(2)} | High: $${c.high.toFixed(2)} | Low: $${c.low.toFixed(2)} | Close: $${c.close.toFixed(2)} | Vol: ${(c.volume / 1e3).toFixed(0)}k (${dir} ${chg}%)`;
    }).join('\n');

    // News scoring
    const scoredNews = scoreHeadlines(rawHeadlines.filter(h => h && !h.startsWith('No significant')));

    // Format full dataset sections
    const sections: string[] = [];

    // 1. Header & Valuation
    sections.push(
      `=== ${symbol} DASHBOARD OVERVIEW ===\n` +
      `Company: ${quote.name || symbol} · Exchange: ${quote.exchange || 'MARKET'} · Type: ${quote.quoteType || 'EQUITY'} · Currency: ${quote.currency || 'USD'}\n` +
      `Market State: ${quote.marketState || 'CLOSED'} | Trailing P/E: ${q?.trailingPE ? q.trailingPE.toFixed(1) + 'x' : 'N/A'} | Forward P/E: ${q?.forwardPE ? q.forwardPE.toFixed(1) + 'x' : 'N/A'}\n` +
      `Last Price: $${analysis.structure.price.toFixed(2)} | Change: ${q?.regularMarketChange != null ? (q.regularMarketChange >= 0 ? '+' : '') + q.regularMarketChange.toFixed(2) : '--'} (${q?.regularMarketChangePercent != null ? (q.regularMarketChangePercent >= 0 ? '+' : '') + q.regularMarketChangePercent.toFixed(2) + '%' : '0%'})\n` +
      `Day Range: Low $${q?.regularMarketDayLow?.toFixed(2) || '--'} – High $${q?.regularMarketDayHigh?.toFixed(2) || '--'} | Open: $${q?.regularMarketOpen?.toFixed(2) || '--'} | Prev Close: $${quote.previousClose?.toFixed(2) || '--'}\n` +
      `Day Volume: ${q?.regularMarketVolume ? (q.regularMarketVolume / 1e6).toFixed(2) + 'M' : '--'} (20D Avg: ${quote.averageVolume ? (quote.averageVolume / 1e6).toFixed(2) + 'M' : '--'}, Vol Ratio: ${analysis.structure.volumeRatio?.toFixed(2) || '--'}x)\n` +
      `Market Cap: ${quote.marketCap ? '$' + (quote.marketCap / 1e12 >= 1 ? (quote.marketCap / 1e12).toFixed(2) + 'T' : (quote.marketCap / 1e9).toFixed(2) + 'B') : '--'} | 52W Range: $${analysis.structure.low52w?.toFixed(2) || '--'} – $${analysis.structure.high52w?.toFixed(2) || '--'} (${analysis.structure.from52wHighPct?.toFixed(1) || '--'}% from ATH, +${analysis.structure.from52wLowPct?.toFixed(1) || '--'}% from 52w low, Range Pos: ${analysis.structure.range52wPos?.toFixed(0) || '--'}%)`
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
      `  • 50-Day Positioning: High $${high50d?.toFixed(2) || '--'} | Low $${low50d?.toFixed(2) || '--'} | Range Width: ${range50dPct?.toFixed(1) || '--'}% | Pos in 50D Range: ${range50dPos?.toFixed(0) || '--'}% (${from50dHighPct?.toFixed(1) || '--'}% from 50d high, +${from50dLowPct?.toFixed(1) || '--'}% from 50d low)\n` +
      `  • 52-Week Positioning: High $${analysis.structure.high52w?.toFixed(2) || '--'} | Low $${analysis.structure.low52w?.toFixed(2) || '--'} | Pos in 52W Range: ${analysis.structure.range52wPos?.toFixed(0) || '--'}% (${analysis.structure.from52wHighPct?.toFixed(1) || '--'}% from ATH, +${analysis.structure.from52wLowPct?.toFixed(1) || '--'}% from 52w low)\n` +
      `  • RSI(14): ${analysis.structure.rsi?.toFixed(1) || '--'} (${analysis.structure.rsi && analysis.structure.rsi > 70 ? 'Overbought (Extended) ⚠️' : analysis.structure.rsi && analysis.structure.rsi < 30 ? 'Oversold (Mean Reversion Bounce Candidate) 💎' : 'Balanced/Neutral'})\n` +
      `  • MACD Momentum: MACD Line: ${lastCandle?.MACD?.toFixed(4) || '--'} | Signal: ${lastCandle?.MACD_Signal?.toFixed(4) || '--'} | Hist: ${lastCandle?.MACD_Hist?.toFixed(4) || '--'} (${lastCandle?.MACD_Hist && lastCandle.MACD_Hist > 0 ? 'Bullish Expansion 🟢' : 'Bearish Contraction / Pullback 🔴'})\n` +
      `  • Moving Average Stack: SMA 20 ($${lastCandle?.SMA_20?.toFixed(2) || '--'}, ${distSma20Pct != null ? (distSma20Pct >= 0 ? '+' : '') + distSma20Pct.toFixed(2) + '%' : '--'}), SMA 50 ($${lastCandle?.SMA_50?.toFixed(2) || '--'}, ${distSma50Pct != null ? (distSma50Pct >= 0 ? '+' : '') + distSma50Pct.toFixed(2) + '%' : '--'}), SMA 200 ($${lastCandle?.SMA_200?.toFixed(2) || '--'}, ${distSma200Pct != null ? (distSma200Pct >= 0 ? '+' : '') + distSma200Pct.toFixed(2) + '%' : '--'}) -> Stack Status: ${analysis.structure.smaStack}\n` +
      `  • Golden/Death Cross: ${lastCandle?.SMA_50 && lastCandle?.SMA_200 && lastCandle.SMA_50 > lastCandle.SMA_200 ? 'Golden Cross active (50 > 200) 🟢' : 'Death Cross active (50 < 200) 🔴'}\n` +
      `  • Volatility & Bands: ATR: $${analysis.structure.atr?.toFixed(2) || '--'} (${analysis.structure.atrPercent?.toFixed(2) || '--'}% of price) | BB Width: ${lastCandle?.BB_Width?.toFixed(2) || '--'}% (Upper: $${lastCandle?.BB_High?.toFixed(2) || '--'}, Mid: $${lastCandle?.BB_Mid?.toFixed(2) || '--'}, Lower: $${lastCandle?.BB_Low?.toFixed(2) || '--'} | Position: ${analysis.structure.bbPosition})\n` +
      `  • Volume & Flow: Volume: ${q?.regularMarketVolume ? (q.regularMarketVolume / 1e6).toFixed(2) + 'M' : '--'} (Ratio: ${analysis.structure.volumeRatio?.toFixed(2) || '--'}x) | OBV Trend: ${analysis.structure.obvTrend ? 'Bullish Accumulation (Smart Money Inflow) 🟢' : 'Bearish Distribution (Smart Money Outflow) 🔴'}\n` +
      `[Weekly 1W Macro Frame]:\n` +
      `  • Macro Trend: ${weeklyTrend}\n` +
      `  • Weekly RSI(14): ${weeklyRsi}\n` +
      `  • Weekly MACD: ${weeklyMacd}\n` +
      `  • Weekly SMA 20: $${lastWeekly?.SMA_20?.toFixed(2) || '--'} (${weeklySma20Dist != null ? (weeklySma20Dist >= 0 ? '+' : '') + weeklySma20Dist.toFixed(2) + '%' : '--'}) | Weekly SMA 50: $${lastWeekly?.SMA_50?.toFixed(2) || '--'}`
    );

    // 4. Candlestick & Chart Patterns
    sections.push(
      `=== PRICE ACTION, CANDLE DYNAMICS & LEVELS ===\n` +
      `Chart Patterns: ${patterns.patterns?.length ? patterns.patterns.join(', ') : 'None detected'}\n` +
      `Candlestick Dynamics: ${patterns.candle_patterns?.summary_text || 'None'}\n` +
      (patterns.candle_patterns?.signals?.length ? `Detected Candles: ${patterns.candle_patterns.signals.map((c: any) => `${c.name} (${c.bias}, ${c.confidence}) - ${c.meaning}`).join('; ')}\n` : '') +
      `Support Floor: $${analysis.support?.toFixed(2) || '--'} | Resistance Ceiling: $${analysis.resistance?.toFixed(2) || '--'}\n` +
      `Fibonacci Position: ${patterns.fibonacci_position || 'N/A'}\n` +
      `Dashboard Insights: ${analysis.insights.join('; ')}`
    );

    // 5. Actionable Trading Execution Plan
    sections.push(
      `=== ACTIONABLE TRADING PLAN ===\n` +
      `Action: ${analysis.plan.action} (Status: ${analysis.plan.status})\n` +
      `Setup: ${analysis.plan.setup}\n` +
      `Optimal Entry Zone: $${analysis.plan.entry?.toFixed(2) || '--'} (${analysis.plan.entryLabel || 'Reaction Zone'})\n` +
      `Stop Loss: $${analysis.plan.stop?.toFixed(2) || '--'} (ATR Buffer Rule: Stops tighter than ${analysis.structure.atrPercent?.toFixed(1) || '2.5'}% get shaken out in normal market noise)\n` +
      `Target 1: $${analysis.plan.target1?.toFixed(2) || '--'} | Target 2: $${analysis.plan.target2?.toFixed(2) || '--'} | R:R to Target 1: ${analysis.plan.riskReward || '--'}\n` +
      `Execution Trigger & Conditions: ${analysis.plan.notes || 'Wait for a close that reclaims moving average or breaks nearby level with volume.'}`
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
        `CNN Fear & Greed Index: ${sentiment.fear_greed?.value || '--'} (${sentiment.fear_greed?.label || 'N/A'})\n` +
        `StockTwits Watchlist: ${st?.watchlist_count ? Number(st.watchlist_count).toLocaleString() + ' watchers' : 'Active watchlist'}\n` +
        (st ? `StockTwits Pulse: ${st.bull_ratio != null ? st.bull_ratio.toFixed(0) + '% Bullish / ' + (100 - st.bull_ratio).toFixed(0) + '% Bearish' : '--'} (${st.total_messages || 0} messages sampled)\n` : '') +
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

    sections.push(`DASHBOARD DIRECT LINK: /dashboard/${encodeURIComponent(symbol)}`);

    return sections.join('\n\n');
  } catch (err) {
    return `Failed to fetch dashboard data for ${symbol}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeFetchPrice(raw: string): Promise<string> {
  const symbol = resolveSymbolIDX(raw) || raw.toUpperCase();
  try {
    const quote = await yahooFinance.quote(symbol);
    const price = (quote as any)?.regularMarketPrice;
    const change = (quote as any)?.regularMarketChangePercent;
    if (price === undefined || price === null) {
      const searchResults = await yahooFinance.search(raw, {}, { validateResult: false }).catch(() => null) as any;
      const matches = (searchResults?.quotes || [])
        .filter((q: any) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'CRYPTOCURRENCY' || q.quoteType === 'INDEX'))
        .slice(0, 3)
        .map((q: any) => `${q.symbol} (${q.shortname || q.longname || q.symbol})`);
      if (matches.length > 0) {
        return `Ticker "${raw}" was not found. Closest matches: ${matches.join(', ')}. Ask the user for clarification on which one they meant.`;
      }
      return `No price data found for ticker "${raw}". Please ask user to clarify or check the symbol.`;
    }
    const chgNum = typeof change === 'number' ? change : 0;
    const name_ = (quote as any).shortName || (quote as any).longName || symbol;
    const dayHigh = (quote as any).regularMarketDayHigh;
    const dayLow = (quote as any).regularMarketDayLow;
    const prevClose = (quote as any).regularMarketPreviousClose;
    return [
      `Symbol: ${symbol} | Name: ${name_} | Price: ${price} (Change: ${chgNum.toFixed(2)}%)`,
      dayHigh != null ? `Day Range: ${dayLow} – ${dayHigh}` : '',
      prevClose != null ? `Prev Close: ${prevClose}` : '',
    ].filter(Boolean).join(' | ');
  } catch {
    const searchResults = await yahooFinance.search(raw, {}, { validateResult: false }).catch(() => null) as any;
    const matches = (searchResults?.quotes || [])
      .filter((q: any) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'CRYPTOCURRENCY' || q.quoteType === 'INDEX'))
      .slice(0, 3)
      .map((q: any) => `${q.symbol} (${q.shortname || q.longname || q.symbol})`);
    if (matches.length > 0) {
      return `Ticker "${raw}" was not found. Closest matches: ${matches.join(', ')}. Ask the user for clarification on which one they meant.`;
    }
    return `Could not find ticker "${raw}". Please ask user to verify the symbol.`;
  }
}

// ─── Fact Extractors ──────────────────────────────────────────────────────────

export function extractTickerDashboardFact(symbol: string, obs: string) {
  const pm = obs.match(/Last Price:\s*\$([\d,.]+)/);
  const bm = obs.match(/Directional Bias:\s*([^\n·]+)/);
  const sm = obs.match(/Overall Score:\s*([^\n(]+)/);
  const am = obs.match(/Action:\s*([^\n(]+)/);
  const em = obs.match(/Optimal Entry(?: Zone)?:\s*\$([\d,.]+)/);
  const tm = obs.match(/Target 1:\s*\$([\d,.]+)/);
  const stm = obs.match(/Stop Loss:\s*\$([\d,.]+)/);
  const atrm = obs.match(/ATR:\s*\$([\d,.]+)(?:\s*\(([^)]+)\))?/);
  const rsim = obs.match(/RSI\(14\):\s*([\d,.]+)/);
  const suppm = obs.match(/Support Floor:\s*\$([\d,.]+)/);
  const resm = obs.match(/Resistance Ceiling:\s*\$([\d,.]+)/);
  const regm = obs.match(/Market Regime:\s*([^\n·]+)/);

  const priceStr = pm ? `Price: $${pm[1]}` : '';
  const biasStr = bm ? `Bias: ${bm[1].trim()}` : '';
  const scoreStr = sm ? `Score: ${sm[1].trim()}` : '';
  const planStr = am ? `Plan: ${am[1].trim()} (Entry: $${em?.[1] || '--'}, Stop: $${stm?.[1] || '--'}, T1: $${tm?.[1] || '--'})` : '';
  const techStr = [
    atrm ? `ATR: $${atrm[1]}${atrm[2] ? ' (' + atrm[2] + ')' : ''}` : '',
    rsim ? `RSI: ${rsim[1]}` : '',
    suppm ? `Support: $${suppm[1]}` : '',
    resm ? `Resistance: $${resm[1]}` : '',
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

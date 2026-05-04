import { createRequire } from 'module';
import { MarketAnalyzer } from './market.analyzer.js';
import { ChartAnalyzer, ChartPatternResult } from './chart.analyzer.js';
import { IndicatorsService } from '../services/indicators.service.js';
import { YahooService } from '../services/yahoo.service.js';
import { AIService } from '../services/ai.service.js';
import { SentimentService } from '../services/sentiment.service.js';
import { NewsService } from '../services/news.service.js';
import { MacroService } from '../services/macro.service.js';
import { config } from '../config/config.js';

const _require = createRequire(import.meta.url);
const PKG_VERSION: string = (_require('../../package.json') as { version: string }).version;
import { clr, badge, OK, WARN, ERR, hr, hr2, BadgeColor } from '../utils/logger.js';
import {
  ln, row, section, sep, pctColor,
  rsiColor, rsiLabel, confColor, volClassColor, obvColor, spinner,
} from '../utils/display.js';

export class NVDAIntradayAnalyzer {
  private yahoo          = new YahooService();
  private indicators     = new IndicatorsService();
  private marketAnalyzer = new MarketAnalyzer();
  private chartAnalyzer  = new ChartAnalyzer();
  private aiService      = new AIService();
  private sentiment      = new SentimentService();
  private news           = new NewsService();
  private macro          = new MacroService();

  async runAnalysis(): Promise<void> {
    ln(hr2());
    ln(`  ${clr.white('NVDA')}  ${clr.dim('AI Intraday Analyzer')}  ${clr.ghost('v' + PKG_VERSION)}`);    
    ln(hr2());

    try {
      const now = new Date();

      row('info',     clr.dim(now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'), 'dim');
      row('window',   clr.dim('Intraday · next 2–6 hours'), 'dim');
      row('interval', clr.dim('1 hour'), 'dim');
      row('model',    clr.dim(config.aiModel), 'dim');
      sep();

      // ── Data fetch ────────────────────────────────────────────────────────
      const stopData = spinner(`  ${badge('data')}  Fetching price data`);
      const past = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      let candles = await this.yahoo.getHistoricalData(config.ticker, past, '1h');
      if (candles.length === 0) { stopData('err', 'No data from Yahoo'); throw new Error('No data fetched'); }
      stopData('ok', `${candles.length} bars loaded`);
      if (candles.length < 200) ln(`  ${WARN}  SMA-200 requires 200 bars — have ${candles.length}`);

      // ── Indicators ────────────────────────────────────────────────────────
      const stopCalc = spinner(`  ${badge('calc')}  Calculating technical indicators`);
      candles = this.indicators.calculateAll(candles);
      const summary  = this.marketAnalyzer.getMarketSummary(candles);
      const patterns = this.marketAnalyzer.getRecentPatterns(candles, 96);
      stopCalc('ok');

      // ── Chart patterns ────────────────────────────────────────────────────
      const stopChart = spinner(`  ${badge('chart')}  Analyzing chart patterns`);
      const chartPatterns = this.chartAnalyzer.analyzeChartPatterns(candles);
      stopChart('ok', `${chartPatterns.patterns.length} pattern(s) found`);

      // ── MTF data ─────────────────────────────────────────────────────────
      const stopMtf = spinner(`  ${badge('mtf')}  Fetching multi-timeframe data`);
      const [candles4h, candlesDaily] = await Promise.all([
        this.yahoo.getHistoricalData(config.ticker, new Date(now.getTime() - 30 * 86400_000), '1h', false),
        this.yahoo.getHistoricalData(config.ticker, new Date(now.getTime() - 90 * 86400_000), '1d', false),
      ]);
      const mtf1h    = this.indicators.calculateAll([...candles]);
      const mtf4h    = this.indicators.calculateAll([...candles4h]);
      const mtfDaily = this.indicators.calculateAll([...candlesDaily]);
      stopMtf('ok', '1h · 4h · daily');

      // ── Macro ─────────────────────────────────────────────────────────────
      const stopMacro = spinner(`  ${badge('macro')}  Fetching macro context`);
      const macroContext = await this.macro.getMacroContext();
      stopMacro('ok', 'SPY · QQQ ready');

      // ── News ──────────────────────────────────────────────────────────────
      const stopNews = spinner(`  ${badge('news')}  Fetching ${config.ticker} news`);
      const newsItems = await this.news.getStockNews(config.ticker);
      stopNews('ok', `${newsItems.length} items`);

      // ── Sentiment ─────────────────────────────────────────────────────────
      const stopSent = spinner(`  ${badge('crowd')}  Fetching crowd sentiment`);
      const crowdSentiment = await this.sentiment.fetchCrowdSentiment();
      stopSent('ok', 'Fear & Greed · StockTwits ready');

      // ── Validation (data-driven) ───────────────────────────────────────────
      const stopVal = spinner(`  ${badge('validate')}  Running pre-analysis validation`);
      const latest   = candles[candles.length - 1];
      const prev     = candles[candles.length - 2];
      const bodySize = Math.abs(latest.close - latest.open);
      const wickSize = latest.high - latest.low;
      const isDoji   = wickSize > 0 && (bodySize / wickSize) < 0.15;
      const isTightSqueeze = (summary.bb_squeeze_status === 'TIGHT_SQUEEZE' || summary.bb_squeeze_status === 'SQUEEZING');
      stopVal('ok');
      if (isDoji)        ln(`  ${WARN}  DOJI candle detected — indecision, reduce confidence`);
      if (isTightSqueeze) ln(`  ${WARN}  BB ${summary.volatility_regime} squeeze — wait for breakout confirmation`);
      if (!isDoji && !isTightSqueeze) ln(`  ${OK}  No structural warnings — clean setup`);
      sep();

      // ── Compute MTF bias ──────────────────────────────────────────────────
      const mtfBias = (c: typeof candles) => {
        if (c.length < 2) return 'NEUTRAL';
        const l = c[c.length - 1];
        const p = c[c.length - 2];
        const macdBull = (l.MACD ?? 0) > (l.MACD_Signal ?? 0);
        const rsiBull  = (l.RSI ?? 50) > 50;
        const aboveSma = l.SMA_20 ? l.close > l.SMA_20 : null;
        const score    = [macdBull, rsiBull, aboveSma].filter(Boolean).length;
        return score >= 2 ? 'BULL' : score <= 1 ? 'BEAR' : 'NEUTRAL';
      };
      const bias1h    = mtfBias(mtf1h);
      const bias4h    = mtfBias(mtf4h);
      const biasDaily = mtfBias(mtfDaily);
      const bullCount  = [bias1h, bias4h, biasDaily].filter(b => b === 'BULL').length;
      const bearCount  = [bias1h, bias4h, biasDaily].filter(b => b === 'BEAR').length;
      const mtfAlign   = bullCount >= 2 ? 'MODERATE_BULL' : bearCount >= 2 ? 'MODERATE_BEAR' : 'MIXED';
      const mtfConfidence = (bullCount === 3 || bearCount === 3) ? 'HIGH' : bullCount >= 2 || bearCount >= 2 ? 'MEDIUM' : 'LOW';

      // ── Compute market structure (HH·HL / LH·LL) ─────────────────────────
      const structureCandles = candles.slice(-24);
      const peaks   = structureCandles.filter((_, i) => i > 0 && i < structureCandles.length - 1 && structureCandles[i].high > structureCandles[i-1].high && structureCandles[i].high > structureCandles[i+1].high);
      const troughs = structureCandles.filter((_, i) => i > 0 && i < structureCandles.length - 1 && structureCandles[i].low < structureCandles[i-1].low && structureCandles[i].low < structureCandles[i+1].low);
      const lastPeak   = peaks.at(-1);
      const prevPeak   = peaks.at(-2);
      const lastTrough = troughs.at(-1);
      const prevTrough = troughs.at(-2);
      const hhhl = lastPeak && prevPeak && lastTrough && prevTrough && lastPeak.high > prevPeak.high && lastTrough.low > prevTrough.low;
      const lhll = lastPeak && prevPeak && lastTrough && prevTrough && lastPeak.high < prevPeak.high && lastTrough.low < prevTrough.low;
      const structureLabel = hhhl ? 'UPTREND (HH · HL)' : lhll ? 'DOWNTREND (LH · LL)' : 'RANGING / UNCLEAR';
      const structureColor = hhhl ? clr.green : lhll ? clr.red : clr.yellow;
      const structureStrength = hhhl || lhll ? 'CONFIRMED' : 'UNCERTAIN';

      // ── Compute volume-price correlation ──────────────────────────────────
      const vpWindow = candles.slice(-20);
      let upVol = 0, upCount = 0, dnVol = 0, dnCount = 0;
      for (let i = 1; i < vpWindow.length; i++) {
        if (vpWindow[i].close > vpWindow[i-1].close) { upVol += vpWindow[i].volume; upCount++; }
        else { dnVol += vpWindow[i].volume; dnCount++; }
      }
      const avgUpVol = upCount > 0 ? upVol / upCount : 0;
      const avgDnVol = dnCount > 0 ? dnVol / dnCount : 0;
      const vpRatio  = avgDnVol > 0 ? avgUpVol / avgDnVol : 1;
      const vpSignal = vpRatio > 1.15 ? 'ACCUMULATION' : vpRatio < 0.85 ? 'DISTRIBUTION' : 'NEUTRAL';
      const vpStrength = Math.min(100, Math.round(Math.abs(vpRatio - 1) * 200));

      // ── AI prompt ─────────────────────────────────────────────────────────
      const prompt = `You are an expert NVDA stock trading analyst focused on INTRADAY trading.
Your goal is to predict price movement over the next 2-6 hours.

CURRENT MARKET DATA:
- Current Price: $${summary.current_price.toFixed(2)}
- 1H Change: ${summary.change_1h.toFixed(2)}%
- 4H Change: ${summary.change_4h.toFixed(2)}%
- 24H Change: ${summary.change_24h.toFixed(2)}%
- 24H High: $${summary.high_24h.toFixed(2)}  Low: $${summary.low_24h.toFixed(2)}
- Volume Ratio: ${summary.volume_ratio.toFixed(2)}x  (${summary.volume_classification})
- OBV Signal: ${summary.obv_signal}
- RSI: ${summary.rsi.toFixed(1)}  (${rsiLabel(summary.rsi)})
- MACD: ${summary.macd.toFixed(4)}  Signal: ${summary.macd_signal.toFixed(4)}
- Volatility Regime: ${summary.volatility_regime}  (${summary.volatility_warning})
- ATR: $${summary.atr.toFixed(2)}  (${summary.atr_percent.toFixed(2)}%)
- BB Width: ${summary.bb_width.toFixed(2)}%  Squeeze: ${summary.bb_squeeze_status}  Position: ${summary.bb_position}

MULTI-TIMEFRAME:
- 1H Bias: ${bias1h}
- 4H Bias: ${bias4h}
- Daily Bias: ${biasDaily}
- Alignment: ${mtfAlign}  (confidence: ${mtfConfidence})

MARKET STRUCTURE:
- Pattern: ${structureLabel}
- Strength: ${structureStrength}

VOLUME-PRICE CORRELATION:
- Signal: ${vpSignal}  (up/dn ratio: ${vpRatio.toFixed(2)}x)

RECENT PATTERNS:
${patterns}

CHART PATTERNS:
${chartPatterns.patterns.join(', ')}
Nearest Support: $${chartPatterns.nearest_support?.toFixed(2)}
Nearest Resistance: $${chartPatterns.nearest_resistance?.toFixed(2)}
Fibonacci Position: ${chartPatterns.fibonacci_position}

MACRO CONTEXT:
- Regime: ${macroContext.market_regime}
- Risk Sentiment: ${macroContext.risk_sentiment}
- SPY: ${macroContext.sp500_correlation}
- QQQ: ${macroContext.nasdaq_correlation}

NEWS:
${newsItems.join('\n')}

CROWD SENTIMENT (apply CONTRARIAN logic — see framework above):
- Fear & Greed Index : ${crowdSentiment.fear_greed?.value ?? 'N/A'} / 100  (${crowdSentiment.fear_greed?.label ?? 'N/A'})
- F&G Momentum      : ${crowdSentiment.fear_greed?.momentum ?? 'N/A'}
- StockTwits NVDA   : ${crowdSentiment.stocktwits_nvda?.bull_ratio?.toFixed(1) ?? 'N/A'}% bullish  (bulls ${crowdSentiment.stocktwits_nvda?.bullish ?? 0} · bears ${crowdSentiment.stocktwits_nvda?.bearish ?? 0} · total tagged ${crowdSentiment.stocktwits_nvda?.total_with_sentiment ?? 0})
- Overall Signals   : ${crowdSentiment.summary?.overall_signals?.join(', ') ?? 'NEUTRAL'}
- Contrarian Note   : ${
  (() => {
    const br = crowdSentiment.stocktwits_nvda?.bull_ratio ?? 50;
    const fg = crowdSentiment.fear_greed?.value ?? 50;
    if (br > 70 && fg > 60) return '⚠ HIGH CONTRARIAN RISK — retail euphoria on both metrics; historically bearish for near-term';
    if (br > 70)            return '⚠ StockTwits crowd is euphoric (>70% bullish) — apply contrarian caution';
    if (br < 30 && fg < 40) return '✓ HIGH CONTRARIAN OPPORTUNITY — retail fear on both metrics; historically bullish for near-term';
    if (br < 30)            return '✓ StockTwits crowd is fearful (<30% bullish) — apply contrarian bullish bias';
    return 'Neutral — no extreme crowd signal';
  })()
}

Provide your intraday prediction using the format:
PREDICTION: UP or DOWN
CONFIDENCE: 0-100
STRATEGY: short intraday strategy
TARGET: $price
STOP: $price
`;

      const aiAnalysis = await this.aiService.analyze(prompt);

      if (aiAnalysis.status === 'error' || aiAnalysis.status === 'uncertain') {
        ln(`  ${ERR}  AI analysis failed: ${aiAnalysis.reason}`);
        return;
      }

      // ════════════════════════════════════════════════════════════════════════
      // VERDICT BOX — printed first so you see the result immediately
      // ════════════════════════════════════════════════════════════════════════
      const predColorFn =
        aiAnalysis.prediction === 'UP'   ? clr.green :
        aiAnalysis.prediction === 'DOWN' ? clr.red   : clr.yellow;
      const predLabel =
        aiAnalysis.prediction === 'UP'   ? 'LONG'  :
        aiAnalysis.prediction === 'DOWN' ? 'SHORT' : 'UNCERTAIN';
      const predBadgeColor: BadgeColor =
        aiAnalysis.prediction === 'UP'   ? 'green' :
        aiAnalysis.prediction === 'DOWN' ? 'red'   : 'yellow';

      const entryPrice  = summary.current_price;
      const targetPrice = aiAnalysis.target_price ?? (entryPrice * 1.02);
      const stopPrice   = aiAnalysis.stop_loss    ?? (entryPrice * 0.99);
      const targetPct   = ((targetPrice - entryPrice) / entryPrice) * 100;
      const stopPct     = ((stopPrice   - entryPrice) / entryPrice) * 100;
      const rrRatio     = Math.abs(targetPct / stopPct);

      ln('');
      ln(hr2());
      ln(`  ${badge('verdict', predBadgeColor)}  ${predColorFn(predLabel)}  ${clr.dim('·')}  ${confColor(aiAnalysis.confidence)}  confidence  ${clr.dim('·')}  R/R ${clr.dim('1 : ' + rrRatio.toFixed(2))}`);
      ln(hr2());
      row('entry',    clr.dim('$' + entryPrice.toFixed(2)));
      row('target',   clr.green('$' + targetPrice.toFixed(2)) + clr.dim('  (' + pctColor(targetPct) + ')'), 'green');
      row('stop',     clr.red('$'   + stopPrice.toFixed(2))   + clr.dim('  (' + pctColor(stopPct)   + ')'), 'red');
      if (aiAnalysis.strategy) row('strategy', clr.dim(aiAnalysis.strategy));
      ln(hr2());

      if (aiAnalysis.raw_response) {
        ln('');
        ln(hr());
        ln(clr.dim('  raw AI response'));
        ln(hr());
        ln(clr.dim(aiAnalysis.raw_response));
        ln(hr());
        ln('');
      }

      // ════════════════════════════════════════════════════════════════════════
      // MARKET SNAPSHOT
      // ════════════════════════════════════════════════════════════════════════
      section('snapshot', 'MARKET SNAPSHOT');
      row('source',   clr.dim('Yahoo Finance  ·  ~15 min delay'), 'dim');
      row('price',    clr.cyan('$' + summary.current_price.toFixed(2)), 'cyan');
      row('1h',       pctColor(summary.change_1h));
      row('4h',       pctColor(summary.change_4h));
      row('24h',      pctColor(summary.change_24h));
      row('range',    clr.dim(`${summary.range_24h_pct.toFixed(2)}%  ($${summary.low_24h.toFixed(2)} – $${summary.high_24h.toFixed(2)})`));
      row('vol',      volClassColor(summary.volume_classification) + clr.dim(`  (${summary.volume_ratio.toFixed(2)}× avg)`));
      row('obv',      obvColor(summary.obv_signal));

      // ── Technical indicators ──────────────────────────────────────────────
      section('technical', 'TECHNICAL INDICATORS');
      const rsi = summary.rsi;
      row('rsi',    rsiColor(rsi)(rsi.toFixed(1)) + clr.dim(`  (${rsiLabel(rsi)})`));
      row('macd',   (summary.macd > summary.macd_signal ? clr.green : clr.red)(summary.macd.toFixed(4)) + clr.dim(`  signal ${summary.macd_signal.toFixed(4)}  hist ${(summary.macd - summary.macd_signal).toFixed(4)}`));
      row('sma20',  summary.price_vs_sma20 !== 0 ? pctColor(summary.price_vs_sma20) + clr.dim(' vs SMA-20') : clr.dim('N/A'));
      row('sma50',  summary.price_vs_sma50  !== null ? pctColor(summary.price_vs_sma50)  + clr.dim(' vs SMA-50')  : clr.dim('N/A'));
      row('sma200', summary.price_vs_sma200 !== null ? pctColor(summary.price_vs_sma200) + clr.dim(' vs SMA-200') : clr.dim('N/A'));
      row('regime', clr.dim(summary.volatility_regime));

      // ── Volatility ────────────────────────────────────────────────────────
      section('volatility', 'VOLATILITY ANALYSIS', 'yellow');
      row('1h',    clr.dim(summary.volatility_1h.toFixed(3) + '%'));
      row('4h',    clr.dim(summary.volatility_4h.toFixed(3) + '%'));
      row('24h',   clr.dim(summary.volatility_24h.toFixed(3) + '%'));
      row('atr',   clr.dim(`$${summary.atr.toFixed(2)}  (${summary.atr_percent.toFixed(2)}%)`));
      row('bb',    clr.dim(`Width ${summary.bb_width.toFixed(2)}%  ·  ${summary.bb_squeeze_status}  ·  ${summary.bb_position}`));
      if (isTightSqueeze) ln(`  ${WARN}  ${summary.volatility_warning}`);

      // ── Chart patterns ────────────────────────────────────────────────────
      section('chart', 'CHART PATTERNS');
      chartPatterns.patterns.forEach((p, i) => {
        const conf = chartPatterns.pattern_confidence?.[i] ?? 'MEDIUM';
        ln(`  ${clr.dim('·')}  ${p}  ${clr.dim('[' + conf + ']')}`);
      });
      ln('');
      if (chartPatterns.nearest_support)    row('support',    clr.green('$' + chartPatterns.nearest_support.toFixed(2)),    'green');
      if (chartPatterns.nearest_resistance) row('resistance', clr.red('$'   + chartPatterns.nearest_resistance.toFixed(2)), 'red');
      row('fib-pos', clr.dim(chartPatterns.fibonacci_position));

      // ── Fibonacci ─────────────────────────────────────────────────────────
      section('fibonacci', 'FIBONACCI RETRACEMENT');
      const fibLevels = chartPatterns.fibonacci_levels as Record<string, number>;
      Object.entries(fibLevels).forEach(([level, lvlPrice]) => {
        const near     = Math.abs(summary.current_price - lvlPrice) / summary.current_price < 0.015;
        const priceStr = '$' + lvlPrice.toFixed(2);
        ln(`  ${clr.dim(level.padEnd(6))}  ${near ? clr.yellow('► ' + priceStr + '  ← near this level') : clr.dim(priceStr)}`);
      });

      // ── Macro ─────────────────────────────────────────────────────────────
      section('macro', 'MACRO CONTEXT');
      row('regime',    clr.dim(macroContext.market_regime));
      row('sentiment', (macroContext.risk_sentiment === 'RISK_ON' ? clr.green : macroContext.risk_sentiment === 'RISK_OFF' ? clr.red : clr.dim)(macroContext.risk_sentiment));
      row('spy',       clr.dim(macroContext.sp500_correlation));
      row('qqq',       clr.dim(macroContext.nasdaq_correlation ?? 'N/A'));

      // ── MTF ───────────────────────────────────────────────────────────────
      section('mtf', 'MULTI-TIMEFRAME CONFLUENCE');
      const biasClr = (b: string) => b === 'BULL' ? clr.green(b) : b === 'BEAR' ? clr.red(b) : clr.yellow(b);
      row('1h',        biasClr(bias1h));
      row('4h (1h bars)', biasClr(bias4h));
      row('daily',     biasClr(biasDaily));
      row('alignment', (mtfAlign.includes('BULL') ? clr.green : mtfAlign.includes('BEAR') ? clr.red : clr.yellow)(mtfAlign) + clr.dim(`  (confidence: ${mtfConfidence})`));
      row('score',     clr.dim(`Bullish ${bullCount}/3  ·  Bearish ${bearCount}/3`));

      // ── Market structure ──────────────────────────────────────────────────
      section('structure', 'MARKET STRUCTURE');
      row('pattern',  structureColor(structureLabel));
      row('strength', clr.dim(structureStrength));
      if (lastPeak)   row('last-peak',   clr.dim('$' + lastPeak.high.toFixed(2)));
      if (prevPeak)   row('prev-peak',   clr.dim('$' + prevPeak.high.toFixed(2)));
      if (lastTrough) row('last-trough', clr.dim('$' + lastTrough.low.toFixed(2)));
      if (prevTrough) row('prev-trough', clr.dim('$' + prevTrough.low.toFixed(2)));

      // ── Volume-price ──────────────────────────────────────────────────────
      section('vol-price', 'VOLUME-PRICE CORRELATION');
      row('signal',      obvColor(vpSignal));
      row('up/dn-ratio', clr.dim(vpRatio.toFixed(2) + '×'));
      row('strength',    clr.dim(vpStrength + ' / 100'));
      row('up-avg-vol',  clr.dim((avgUpVol / 1_000_000).toFixed(2) + 'M  (' + upCount + ' moves)'));
      row('dn-avg-vol',  clr.dim((avgDnVol / 1_000_000).toFixed(2) + 'M  (' + dnCount + ' moves)'));

      // ── News ──────────────────────────────────────────────────────────────
      section('news', 'MARKET NEWS');
      if (newsItems.length === 0) {
        ln(`  ${clr.dim('No recent news available')}`);
      } else {
        newsItems.forEach((n: string) => ln(`  ${clr.dim('·')}  ${n}`));
      }

      // ── Crowd sentiment ───────────────────────────────────────────────────
      section('crowd', 'CROWD SENTIMENT');
      const fg    = crowdSentiment.fear_greed;
      const fgVal = fg?.value ?? 50;
      const fgLbl = fg?.label ?? 'Unknown';
      const fgMom = fg?.momentum ?? 'N/A';
      const fgClr = fgVal < 30 ? clr.red : fgVal > 70 ? clr.green : clr.yellow;
      const st    = crowdSentiment.stocktwits_nvda;
      const bull  = st?.bull_ratio ?? 50;
      const bullClr = bull > 60 ? clr.green : bull < 40 ? clr.red : clr.yellow;

      // Fear & Greed inline bar
      const fgBar = (() => {
        const filled = Math.round((fgVal / 100) * 20);
        return clr.dim('[') + (fgVal < 30 ? clr.red : fgVal > 70 ? clr.green : clr.yellow)('█'.repeat(filled)) + clr.dim('░'.repeat(20 - filled)) + clr.dim(']');
      })();

      row('fear-greed', `${fgClr(String(fgVal))} / 100  ${fgBar}  ${clr.dim(fgLbl)}`);
      row('fg-momentum', clr.dim(fgMom));
      if (st) {
        row('stocktwits', bullClr(bull.toFixed(0) + '% bullish') + clr.dim(`  (bulls ${st.bullish} · bears ${st.bearish} · total ${st.total_with_sentiment})`));
      }
      const signals = crowdSentiment.summary?.overall_signals as string[] ?? [];
      if (signals.length) row('signals', signals.map((s: string) => clr.dim(s)).join('  '));

      // ── AI section (full detail) ──────────────────────────────────────────
      section('ai', `AI PREDICTION  ${clr.dim('(' + config.aiModel + ')')}`, 'magenta');
      row('decision',    predColorFn(predLabel), predBadgeColor);
      row('confidence',  confColor(aiAnalysis.confidence));
      row('strategy',    clr.dim(aiAnalysis.strategy ?? 'N/A'));
      row('entry',       clr.dim('$' + entryPrice.toFixed(2)));
      row('target',      clr.green('$' + targetPrice.toFixed(2)) + clr.dim(`  (${pctColor(targetPct)})`), 'green');
      row('stop',        clr.red('$'   + stopPrice.toFixed(2))   + clr.dim(`  (${pctColor(stopPct)})`),   'red');
      row('r/r',         clr.dim('1 : ' + rrRatio.toFixed(2)));

      // ── Summary ───────────────────────────────────────────────────────────
      section('summary', 'ANALYSIS SUMMARY');
      const summaryDir  = aiAnalysis.prediction === 'UP' ? 'bullish' : aiAnalysis.prediction === 'DOWN' ? 'bearish' : 'neutral';
      const summaryConf = aiAnalysis.confidence >= 70 ? 'high' : aiAnalysis.confidence >= 50 ? 'moderate' : 'low';
      ln(`  ${clr.dim(`NVDA ${summaryDir} bias on ${summary.volatility_regime.toLowerCase()} volatility regime.`)}`);
      ln(`  ${clr.dim(`MTF alignment: ${mtfAlign}  ·  Market structure: ${structureLabel}`)}`);
      ln(`  ${clr.dim(`AI confidence ${summaryConf} (${aiAnalysis.confidence}%)  ·  R/R ${rrRatio.toFixed(2)}`)}`);

      ln('');
      ln(hr2());
      ln(`  ${OK}  Intraday analysis complete`);
      ln(hr2());

    } catch (e) {
      ln(`  ${ERR}  ${e}`);
    }
  }
}

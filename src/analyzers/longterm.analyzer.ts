import { MarketAnalyzer } from './market.analyzer.js';
import { ChartAnalyzer } from './chart.analyzer.js';
import { IndicatorsService } from '../services/market/indicators.service.js';
import { YahooService } from '../services/market/yahoo.service.js';
import { AIService } from '../services/ai/ai.service.js';
import { SentimentService } from '../services/market/sentiment.service.js';
import { NewsService } from '../services/news/news.service.js';
import { MacroService } from '../services/market/macro.service.js';
import { config } from '../config/config.js';
import { buildLongTermPrompt } from '../shared/prompts.js';
import { computeDataFreshness } from '../utils/data-freshness.js';
import { getBuildVersion } from '../utils/version.js';

const BUILD_VERSION = getBuildVersion();
import { clr, badge, OK, WARN, ERR, hr, hr2, BadgeColor } from '../utils/logger.js';
import {
  ln, row, section, sep, pctColor,
  rsiColor, rsiLabel, confColor, spinner,
} from '../utils/display.js';

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`;
}

function aggregateWeeklyCandles(candles: { date: Date; open: number; high: number; low: number; close: number; volume: number }[]): { date: Date; open: number; high: number; low: number; close: number; volume: number }[] {
  if (candles.length === 0) return [];
  const result: { date: Date; open: number; high: number; low: number; close: number; volume: number }[] = [];
  let bucketKey: string | null = null;
  let bucket: { date: Date; open: number; high: number; low: number; close: number; volume: number } | null = null;

  for (const candle of candles) {
    const key = isoWeekKey(candle.date);
    if (key !== bucketKey) {
      if (bucket) result.push(bucket);
      bucketKey = key;
      bucket = {
        date: candle.date,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
    } else if (bucket) {
      bucket.high = Math.max(bucket.high, candle.high);
      bucket.low = Math.min(bucket.low, candle.low);
      bucket.close = candle.close;
      bucket.volume += candle.volume;
    }
  }

  if (bucket) result.push(bucket);
  return result;
}

export class LongTermAnalyzer {
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
    ln(`  ${clr.white(config.ticker)}  ${clr.dim('AI Long-Term Analyzer')}  ${clr.ghost('v' + BUILD_VERSION)}`);
    ln(hr2());

    try {
      const now = new Date();

      row('info',     clr.dim(now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'), 'dim');
      row('window',   clr.dim('Long-term · 3–12 month outlook'), 'dim');
      row('interval', clr.dim('1 day  /  weekly'), 'dim');
      row('model',    clr.dim(config.aiModel), 'dim');
      sep();

      // ── Data fetch — daily (2 years, adjusted) ────────────────────────────
      const stopDaily = spinner(`  ${badge('data')}  Fetching daily data  (2 years, adjusted)`);
      const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 86400_000);
      const dailyAll = await this.yahoo.getHistoricalData(config.ticker, twoYearsAgo, '1d', true, {
        adjustPrices: true,
      });
      if (dailyAll.length === 0) { stopDaily('err', 'No data from Yahoo'); throw new Error('No daily data'); }
      stopDaily('ok', `${dailyAll.length} daily bars`);

      // ── Weekly aggregation (calendar weeks) ──────────────────────────────
      const stopWeekly = spinner(`  ${badge('data')}  Aggregating weekly trend  (2 years)`);
      const weeklyCandles = aggregateWeeklyCandles(dailyAll);
      stopWeekly('ok', `${weeklyCandles.length} weekly bars`);

      let dailyCandles = dailyAll.slice(-Math.min(dailyAll.length, 252));

      // ── Indicators ────────────────────────────────────────────────────────
      const stopCalc = spinner(`  ${badge('calc')}  Calculating long-term indicators`);
      dailyCandles = this.indicators.calculateAll(dailyCandles);
      const summary    = this.marketAnalyzer.getMarketSummary(dailyCandles, {
        intervalMinutes: 1440,
        dropIncomplete: false,
        now,
      });
      const patterns30d  = this.marketAnalyzer.getRecentPatterns(dailyCandles, 30);
      const patterns90d  = this.marketAnalyzer.getRecentPatterns(dailyCandles, 90);
      const patterns365d = this.marketAnalyzer.getRecentPatterns(dailyCandles, Math.min(dailyCandles.length, 252));
      stopCalc('ok');

      const latestCandle = dailyAll[dailyAll.length - 1];
      const dataFreshness = computeDataFreshness(
        latestCandle,
        now,
        1440,
        summary.is_incomplete_candle === true,
      );

      // ── Chart patterns ────────────────────────────────────────────────────
      const stopChart = spinner(`  ${badge('chart')}  Analyzing long-term chart patterns`);
      const chartPatterns = this.chartAnalyzer.analyzeChartPatterns(dailyCandles);
      stopChart('ok', `${chartPatterns.patterns.length} pattern(s)`);

      // ── Macro ─────────────────────────────────────────────────────────────
      const stopMacro = spinner(`  ${badge('macro')}  Fetching macro context`);
      const macroContext = await this.macro.getMacroContext();
      stopMacro('ok', 'SPY · QQQ · tech · rates ready');

      // ── News ──────────────────────────────────────────────────────────────
      const stopNews = spinner(`  ${badge('news')}  Fetching ${config.ticker} news & catalysts`);
      const newsItems = await this.news.getStockNews(config.ticker);
      stopNews('ok', `${newsItems.length} items`);

      // ── Sentiment ─────────────────────────────────────────────────────────
      const stopSent = spinner(`  ${badge('crowd')}  Fetching crowd sentiment`);
      const crowdSentiment = await this.sentiment.fetchCrowdSentiment();
      stopSent('ok', 'Fear & Greed · StockTwits · Reddit ready');

      // ── Validation ────────────────────────────────────────────────────────
      const stopVal = spinner(`  ${badge('validate')}  Running long-term validation`);
      stopVal(dailyCandles.length >= 200 ? 'ok' : 'warn',
              dailyCandles.length >= 200 ? '200-day SMA available' : `Only ${dailyCandles.length} bars — SMA-200 may be incomplete`);
      sep();

      // ── Key metrics ───────────────────────────────────────────────────────
      const latest  = dailyCandles[dailyCandles.length - 1];
      const price   = latest.close;
      const sma50   = latest.SMA_50  ?? null;
      const sma200  = latest.SMA_200 ?? null;
      const rsi     = latest.RSI     ?? null;
      const atr     = latest.ATR     ?? null;

      const high52w = Math.max(...dailyCandles.slice(-252).map(c => c.high));
      const low52w  = Math.min(...dailyCandles.slice(-252).map(c => c.low));
      const pctFromHigh = ((price - high52w) / high52w) * 100;
      const pctFromLow  = ((price - low52w)  / low52w)  * 100;
      const rangePos    = ((price - low52w) / (high52w - low52w)) * 100;

      const goldenCross  = sma50 !== null && sma200 !== null && sma50 > sma200;
      const aboveSma200  = sma200 !== null ? price > sma200 : null;
      const aboveSma50   = sma50  !== null ? price > sma50  : null;

      // ── Weekly trend (10-week SMA and 2-year change) ────────────────────
      const firstWk = weeklyCandles[0];
      const lastWk = weeklyCandles[weeklyCandles.length - 1];
      const weeklyChange = firstWk && lastWk ? ((lastWk.close - firstWk.close) / firstWk.close) * 100 : 0;

      let weeklyTrend = 'SIDEWAYS';
      if (weeklyCandles.length >= 10) {
        const last10 = weeklyCandles.slice(-10);
        const sma10 = last10.reduce((sum, c) => sum + c.close, 0) / 10;
        const latestWeeklyClose = lastWk.close;
        if (latestWeeklyClose > sma10 * 1.02) {
          weeklyTrend = 'UPTREND';
        } else if (latestWeeklyClose < sma10 * 0.98) {
          weeklyTrend = 'DOWNTREND';
        } else {
          weeklyTrend = 'SIDEWAYS';
        }
      } else if (weeklyCandles.length > 0) {
        const fw = weeklyCandles[0].close;
        const lw = lastWk.close;
        if (lw > fw * 1.02) weeklyTrend = 'UPTREND';
        else if (lw < fw * 0.98) weeklyTrend = 'DOWNTREND';
      }

      // ── Drawdown from 52w high ────────────────────────────────────────────
      const maxDrawdown = pctFromHigh; // already negative if below high

      // ── AI prompt ─────────────────────────────────────────────────────────
      const prompt = buildLongTermPrompt({
        price,
        dataFreshness: {
          latest_candle_utc: dataFreshness.latestCandleUtc,
          age_minutes: dataFreshness.ageMinutes,
          is_stale: dataFreshness.isStale,
          is_incomplete: dataFreshness.isIncomplete,
          market_open: dataFreshness.marketOpen,
          stale_threshold_minutes: dataFreshness.staleThresholdMinutes,
        },
        high52w,
        low52w,
        pctFromHigh,
        pctFromLow,
        rangePos,
        sma50,
        sma200,
        aboveSma50,
        aboveSma200,
        goldenCross,
        rsi,
        atr,
        maxDrawdown,
        weeklyTrend,
        weeklyChange,
        patterns30d,
        patterns90d,
        patterns365d,
        chartPatterns,
        macroContext,
        newsItems,
        crowdSentiment,
      });

      const aiAnalysis = await this.aiService.analyze(prompt);

      if (aiAnalysis.status === 'error' || aiAnalysis.status === 'uncertain') {
        ln(`  ${ERR}  AI analysis failed: ${aiAnalysis.reason}`);
        return;
      }

      // ── Counter-trend bearish gate ───────────────────────────────────────
      const isUpWeekly = weeklyTrend === 'UPTREND';
      const isAboveSma200 = aboveSma200 === true;
      const isGolden = goldenCross === true;
      const bullishLongSignals = [isUpWeekly, isAboveSma200, isGolden].filter(Boolean).length;
      const confirmBear = (aboveSma200 === false) || (weeklyTrend === 'DOWNTREND') || ((sma50 !== null && price < sma50) && (rsi !== null && rsi < 45));
      const gateBear = aiAnalysis.prediction === 'DOWN' && bullishLongSignals >= 2 && !confirmBear;
      const gateNote = gateBear
        ? 'WAIT: Long-term down call needs confirmation (weekly downtrend or break below SMA-200)'
        : '';

      // ════════════════════════════════════════════════════════════════════════
      // VERDICT BOX
      // ════════════════════════════════════════════════════════════════════════
      const displayPrediction = gateBear ? 'UNKNOWN' : aiAnalysis.prediction;
      const displayConfidence = gateBear ? Math.min(aiAnalysis.confidence, 55) : aiAnalysis.confidence;
      const displayStrategy = gateBear
        ? 'WAIT for confirmation: weekly downtrend or SMA-200 breakdown'
        : (aiAnalysis.strategy ?? 'N/A');

      const predColorFn =
        displayPrediction === 'UP'   ? clr.green :
        displayPrediction === 'DOWN' ? clr.red   : clr.yellow;
      const predLabel =
        displayPrediction === 'UP'   ? 'BULLISH' :
        displayPrediction === 'DOWN' ? 'BEARISH' : 'WAIT';
      const predBadgeColor: BadgeColor =
        displayPrediction === 'UP'   ? 'green' :
        displayPrediction === 'DOWN' ? 'red'   : 'yellow';

      const entry      = price;
      const dailyAtr   = (atr !== null && atr > 0) ? atr : (entry * 0.02);
      let target: number;
      let stop: number;
      if (aiAnalysis.prediction === 'UP') {
        target = aiAnalysis.target_price ?? (entry + 6 * dailyAtr);
        stop   = aiAnalysis.stop_loss ?? (entry - 4 * dailyAtr);
      } else if (aiAnalysis.prediction === 'DOWN') {
        target = aiAnalysis.target_price ?? (entry - 6 * dailyAtr);
        stop   = aiAnalysis.stop_loss ?? (entry + 4 * dailyAtr);
      } else {
        target = aiAnalysis.target_price ?? (entry * 1.20);
        stop   = aiAnalysis.stop_loss ?? (entry * 0.85);
      }
      const targetPct  = ((target - entry) / entry) * 100;
      const stopPct    = ((stop   - entry) / entry) * 100;
      const rrRatio    = (stopPct !== 0 && isFinite(stopPct) && isFinite(targetPct))
        ? Math.abs(targetPct / stopPct)
        : 0;

      ln('');
      ln(hr2());
      ln(`  ${badge('verdict', predBadgeColor)}  ${predColorFn(predLabel)}  ${clr.dim('·')}  ${confColor(displayConfidence)}  confidence  ${clr.dim('·')}  12-mo R/R ${clr.dim('1 : ' + rrRatio.toFixed(2))}`);
      ln(hr2());
      row('current',  clr.dim('$' + entry.toFixed(2)));
      row('target',   clr.green('$' + target.toFixed(2)) + clr.dim('  (' + pctColor(targetPct) + '  upside)'), 'green');
      row('stop',     clr.red('$'   + stop.toFixed(2))   + clr.dim('  (' + pctColor(stopPct)   + '  invalidation)'), 'red');
      row('strategy', clr.dim(displayStrategy));
      row('data age', clr.dim(`${dataFreshness.ageMinutes.toFixed(1)} min`));
      row('stale', dataFreshness.isStale ? clr.yellow('STALE') : clr.green('FRESH'));
      if (dataFreshness.isIncomplete) ln(`  ${WARN}  Latest candle appears incomplete — treat signals cautiously`);
      ln(hr2());

      if (gateBear) {
        ln(`  ${WARN}  ${gateNote}`);
        ln('');
      }

      section('freshness', 'DATA FRESHNESS', 'yellow');
      row('latest',    clr.dim(dataFreshness.latestCandleUtc));
      row('age',       clr.dim(`${dataFreshness.ageMinutes.toFixed(1)} min old`));
      row('threshold', clr.dim(`${dataFreshness.staleThresholdMinutes} min`));
      row('market',    clr.dim(dataFreshness.marketOpen ? 'OPEN' : 'CLOSED'));
      row('stale',     dataFreshness.isStale ? clr.yellow('STALE') : clr.green('FRESH'));
      row('incomplete', dataFreshness.isIncomplete ? clr.yellow('YES') : clr.green('NO'));

      if (aiAnalysis.reasons && aiAnalysis.reasons.length > 0) {
        section('reasons', 'AI RATIONALE');
        aiAnalysis.reasons.forEach((reason) => {
          ln(`  ${clr.dim('·')}  ${reason}`);
        });
        ln('');
      }

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
      // PRICE OVERVIEW
      // ════════════════════════════════════════════════════════════════════════
      section('snapshot', 'PRICE OVERVIEW');
      row('source',   clr.dim('Yahoo Finance  ·  daily close'), 'dim');
      row('price',    clr.cyan('$' + price.toFixed(2)), 'cyan');
      row('52w-high', clr.dim('$' + high52w.toFixed(2)) + clr.dim('  (' + pctFromHigh.toFixed(1) + '%)'));
      row('52w-low',  clr.dim('$' + low52w.toFixed(2))  + clr.dim('  (+' + pctFromLow.toFixed(1) + '%)'));
      row('drawdown', pctColor(maxDrawdown) + clr.dim('  from 52w high'));

      // 52-week range bar
      ln('');
      const barLen = 32;
      const filled = Math.round((rangePos / 100) * barLen);
      const bar    = clr.green('█'.repeat(filled)) + clr.dim('░'.repeat(barLen - filled));
      ln(`  ${clr.dim('$' + low52w.toFixed(0).padStart(6))}  ${bar}  ${clr.dim('$' + high52w.toFixed(0))}`);
      ln(`  ${clr.dim(' '.repeat(9))}${clr.yellow('▲').padEnd(filled > 0 ? filled : 1)}  ${clr.dim(rangePos.toFixed(1) + '% of range')}`);
      ln('');

      row('weekly-trend', (weeklyTrend === 'UPTREND' ? clr.green : weeklyTrend === 'DOWNTREND' ? clr.red : clr.yellow)(weeklyTrend) + clr.dim(`  (2yr: ${pctColor(weeklyChange)})`));

      // ── Moving averages ───────────────────────────────────────────────────
      section('moving-avg', 'MOVING AVERAGES');
      if (sma50) {
        row('sma-50',  clr.dim('$' + sma50.toFixed(2)) + (aboveSma50  ? clr.green('  ▲ above') : clr.red('  ▼ below')));
      } else {
        row('sma-50',  clr.dim('N/A'));
      }
      if (sma200) {
        row('sma-200', clr.dim('$' + sma200.toFixed(2)) + (aboveSma200 ? clr.green('  ▲ above') : clr.red('  ▼ below')));
      } else {
        row('sma-200', clr.dim('N/A'));
      }
      row('cross',    goldenCross ? clr.green('GOLDEN CROSS  (SMA-50 > SMA-200 · bullish)') : clr.red('DEATH CROSS  (SMA-50 < SMA-200 · bearish)'), goldenCross ? 'green' : 'red');
      if (aboveSma200 !== null) {
        row('lt-signal', aboveSma200 ? clr.green('ABOVE SMA-200 — long-term uptrend intact') : clr.red('BELOW SMA-200 — long-term structure broken'), aboveSma200 ? 'green' : 'red');
      }

      // ── Technical indicators ──────────────────────────────────────────────
      section('technical', 'TECHNICAL INDICATORS  (DAILY)');
      if (rsi !== null) {
        row('rsi', rsiColor(rsi)(rsi.toFixed(1)) + clr.dim(`  (${rsiLabel(rsi)})`));
      }
      row('macd',   (summary.macd > summary.macd_signal ? clr.green : clr.red)(summary.macd.toFixed(4)) + clr.dim(`  signal ${summary.macd_signal.toFixed(4)}`));
      row('atr',    atr ? clr.dim(`$${atr.toFixed(2)}  (${((atr / price) * 100).toFixed(1)}%)`) : clr.dim('N/A'));
      row('regime', clr.dim(summary.volatility_regime));

      // ── Trend analysis ────────────────────────────────────────────────────
      section('trend', 'TREND ANALYSIS');
      row('30d',    clr.dim(patterns30d));
      row('90d',    clr.dim(patterns90d));
      row('1-year', clr.dim(patterns365d));

      // ── Chart patterns ────────────────────────────────────────────────────
      section('chart', 'CHART PATTERNS  (DAILY)');
      chartPatterns.patterns.forEach((p, i) => {
        const conf = chartPatterns.pattern_confidence?.[i] ?? 'MEDIUM';
        ln(`  ${clr.dim('·')}  ${p}  ${clr.dim('[' + conf + ']  [daily]')}`);
      });
      ln('');
      if (chartPatterns.nearest_support)    row('support',    clr.green('$' + chartPatterns.nearest_support.toFixed(2))    + clr.dim('  (key long-term support)'),    'green');
      if (chartPatterns.nearest_resistance) row('resistance', clr.red('$'   + chartPatterns.nearest_resistance.toFixed(2)) + clr.dim('  (key long-term resistance)'), 'red');
      row('fib-pos', clr.dim(chartPatterns.fibonacci_position));

      // ── Fibonacci (52-week range) ─────────────────────────────────────────
      section('fibonacci', 'FIBONACCI RETRACEMENT  (52-WEEK RANGE)');
      const fibDiff = high52w - low52w;
      const fibData: [string, number][] = [
        ['0.0',   high52w],
        ['0.236', high52w - 0.236 * fibDiff],
        ['0.382', high52w - 0.382 * fibDiff],
        ['0.5',   high52w - 0.5   * fibDiff],
        ['0.618', high52w - 0.618 * fibDiff],
        ['0.786', high52w - 0.786 * fibDiff],
        ['1.0',   low52w],
      ];
      fibData.forEach(([level, lvlPrice]) => {
        const near     = Math.abs(price - lvlPrice) / price < 0.015;
        const priceStr = '$' + lvlPrice.toFixed(2);
        ln(`  ${clr.dim(level.padEnd(6))}  ${near ? clr.yellow('► ' + priceStr + '  ← near this level') : clr.dim(priceStr)}`);
      });

      // ── Macro ─────────────────────────────────────────────────────────────
      section('macro', 'MACRO CONTEXT');
      row('regime',    clr.dim(macroContext.market_regime));
      row('risk',      (macroContext.risk_sentiment === 'RISK_ON' ? clr.green : macroContext.risk_sentiment === 'RISK_OFF' ? clr.red : clr.dim)(macroContext.risk_sentiment));
      row('spy',       clr.dim(macroContext.sp500_correlation));
      row('qqq',       clr.dim(macroContext.nasdaq_correlation ?? 'N/A'));

      // ── News ──────────────────────────────────────────────────────────────
      section('news', 'NEWS & CATALYSTS');
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
      const st    = crowdSentiment.stocktwits_data;
      const bull  = st?.bull_ratio ?? 50;
      const bullClr = bull > 60 ? clr.green : bull < 40 ? clr.red : clr.yellow;

      const fgBar = (() => {
        const filled = Math.round((fgVal / 100) * 20);
        return clr.dim('[') + (fgVal < 30 ? clr.red : fgVal > 70 ? clr.green : clr.yellow)('█'.repeat(filled)) + clr.dim('░'.repeat(20 - filled)) + clr.dim(']');
      })();

      row('fear-greed', `${fgClr(String(fgVal))} / 100  ${fgBar}  ${clr.dim(fgLbl)}`);
      row('fg-momentum', clr.dim(fgMom));
      if (st) {
        row('stocktwits', bullClr(bull.toFixed(0) + '% bullish') + clr.dim(`  (bulls ${st.bullish} · bears ${st.bearish} · total ${st.total_with_sentiment})`));
      }
      const socialBuzz = crowdSentiment.social_buzz ?? [];
      for (const buzz of socialBuzz) {
        const top = buzz.top_posts && buzz.top_posts.length > 0
          ? `  (${buzz.top_posts.slice(0, 3).join(' · ')})`
          : '';
        row(buzz.source.toLowerCase(), clr.dim(`${buzz.mentions} mentions${top}`));
      }
      const signals = crowdSentiment.summary?.overall_signals as string[] ?? [];
      if (signals.length) row('signals', signals.map((s: string) => clr.dim(s)).join('  '));

      // ── AI outlook (full detail) ──────────────────────────────────────────
      section('ai', `AI LONG-TERM OUTLOOK  ${clr.dim('(' + config.aiModel + ')')}`, 'magenta');
      row('outlook',    predColorFn(predLabel), predBadgeColor);
      row('confidence', confColor(displayConfidence));
      row('strategy',   clr.dim(displayStrategy));

      ln('');
      ln(`  ${clr.dim('─'.repeat(68))}`);
      ln(`  ${badge('price-target', 'white')}  ${clr.white('12-MONTH PRICE TARGET')}`);
      ln(`  ${clr.dim('─'.repeat(68))}`);
      row('current',     clr.dim('$' + entry.toFixed(2)));
      row('bull-target', clr.green('$' + target.toFixed(2)) + clr.dim(`  (${pctColor(targetPct)}  upside)`), 'green');
      row('invalidation', clr.red('$' + stop.toFixed(2))   + clr.dim(`  (${pctColor(stopPct)}  stop)`),    'red');
      row('r/r',         clr.dim('1 : ' + rrRatio.toFixed(2)));

      // ── Positioning guidance ──────────────────────────────────────────────
      ln('');
      ln(`  ${clr.dim('─'.repeat(68))}`);
      ln(`  ${badge('position', 'white')}  ${clr.white('POSITIONING GUIDANCE')}`);
      ln(`  ${clr.dim('─'.repeat(68))}`);
      const isLong = aiAnalysis.prediction === 'UP';
      if (isLong) {
        if (aboveSma200) {
          ln(`    ${OK}  Price above SMA-200 — long-term structure intact`);
          ln(`    ${OK}  Accumulate on dips toward SMA-50 / key support`);
          ln(`    ${OK}  Add on confirmed breakouts above resistance`);
        } else {
          ln(`  ${WARN}  Price below SMA-200 — wait for reclaim before adding`);
          ln(`  ${WARN}  Consider small starter position only`);
        }
        if (goldenCross) ln(`    ${OK}  Golden Cross confirmed — strong long-term tailwind`);
        ln(`  ${clr.yellow('!')}  Reduce if price closes below SMA-200 on weekly`);
      } else {
        ln(`  ${clr.yellow('!')}  Reduce or avoid new long positions`);
        ln(`  ${clr.yellow('!')}  Wait for SMA-200 reclaim before re-entering`);
        ln(`  ${clr.yellow('!')}  Consider defensive hedges if holding`);
        if (!goldenCross) ln(`  ${clr.yellow('!')}  Death Cross active — bearish long-term signal`);
      }

      // ── Summary ───────────────────────────────────────────────────────────
      section('summary', 'LONG-TERM ANALYSIS SUMMARY');
      const summaryDir  = displayPrediction === 'UP' ? 'bullish' : displayPrediction === 'DOWN' ? 'bearish' : 'neutral';
      const summaryConf = displayConfidence >= 70 ? 'high' : displayConfidence >= 50 ? 'moderate' : 'low';
      ln(`  ${clr.dim(`${config.ticker} ${summaryDir} on ${summaryConf} AI confidence (${displayConfidence}%).`)}`);
      ln(`  ${clr.dim(`Weekly trend: ${weeklyTrend}  ·  SMA-200: ${aboveSma200 ? 'above ▲' : 'below ▼'}  ·  ${goldenCross ? 'Golden Cross ✔' : 'Death Cross ✖'}`)}`);
      ln(`  ${clr.dim(`12-month target $${target.toFixed(2)}  ·  invalidation $${stop.toFixed(2)}  ·  R/R ${rrRatio.toFixed(2)}`)}`);

      ln('');
      ln(hr2());
      ln(`  ${OK}  Long-term analysis complete`);
      ln(hr2());

    } catch (e) {
      ln(`  ${ERR}  ${e}`);
    }
  }
}

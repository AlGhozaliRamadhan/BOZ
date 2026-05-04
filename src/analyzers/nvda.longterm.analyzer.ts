import { createRequire } from 'module';
import { MarketAnalyzer } from './market.analyzer.js';
import { ChartAnalyzer, ChartPatternResult } from './chart.analyzer.js';
import { IndicatorsService } from '../services/indicators.service.js';
import { YahooService } from '../services/yahoo.service.js';
import { AIService } from '../services/ai.service.js';
import { NewsService } from '../services/news.service.js';
import { MacroService } from '../services/macro.service.js';
import { config } from '../config/config.js';

const _require = createRequire(import.meta.url);
const PKG_VERSION: string = (_require('../../package.json') as { version: string }).version;
import { clr, badge, OK, WARN, ERR, hr, hr2, BadgeColor } from '../utils/logger.js';
import {
  ln, row, section, sep, pctColor,
  rsiColor, rsiLabel, confColor, spinner,
} from '../utils/display.js';

export class NVDALongTermAnalyzer {
  private yahoo          = new YahooService();
  private indicators     = new IndicatorsService();
  private marketAnalyzer = new MarketAnalyzer();
  private chartAnalyzer  = new ChartAnalyzer();
  private aiService      = new AIService();
  private news           = new NewsService();
  private macro          = new MacroService();

  async runAnalysis(): Promise<void> {
    ln(hr2());
    ln(`  ${clr.white('NVDA')}  ${clr.dim('AI Long-Term Analyzer')}  ${clr.ghost('v' + PKG_VERSION)}`);
    ln(hr2());

    try {
      const now = new Date();

      row('info',     clr.dim(now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'), 'dim');
      row('window',   clr.dim('Long-term · 3–12 month outlook'), 'dim');
      row('interval', clr.dim('1 day  /  weekly'), 'dim');
      row('model',    clr.dim(config.aiModel), 'dim');
      sep();

      // ── Data fetch — daily (1 year) ───────────────────────────────────────
      const stopDaily = spinner(`  ${badge('data')}  Fetching daily data  (1 year)`);
      const oneYearAgo  = new Date(now.getTime() - 365 * 86400_000);
      let dailyCandles  = await this.yahoo.getHistoricalData(config.ticker, oneYearAgo, '1d');
      if (dailyCandles.length === 0) { stopDaily('err', 'No data from Yahoo'); throw new Error('No daily data'); }
      stopDaily('ok', `${dailyCandles.length} daily bars`);

      // ── Data fetch — weekly proxy (2 years) ───────────────────────────────
      const stopWeekly = spinner(`  ${badge('data')}  Fetching weekly trend  (2 years)`);
      const twoYearsAgo   = new Date(now.getTime() - 2 * 365 * 86400_000);
      const weeklyCandles = await this.yahoo.getHistoricalData(config.ticker, twoYearsAgo, '1d', false);
      stopWeekly('ok', `${weeklyCandles.length} bars for weekly trend`);

      // ── Indicators ────────────────────────────────────────────────────────
      const stopCalc = spinner(`  ${badge('calc')}  Calculating long-term indicators`);
      dailyCandles = this.indicators.calculateAll(dailyCandles);
      const summary    = this.marketAnalyzer.getMarketSummary(dailyCandles);
      const patterns30d  = this.marketAnalyzer.getRecentPatterns(dailyCandles, 30);
      const patterns90d  = this.marketAnalyzer.getRecentPatterns(dailyCandles, 90);
      const patterns365d = this.marketAnalyzer.getRecentPatterns(dailyCandles, Math.min(dailyCandles.length, 252));
      stopCalc('ok');

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

      // ── Weekly trend (sample every 5 candles from 2yr data) ──────────────
      const weekSampled = weeklyCandles.filter((_, i) => i % 5 === 0);
      const wkFirst = weekSampled[0]?.close ?? price;
      const wkLast  = weekSampled[weekSampled.length - 1]?.close ?? price;
      const weeklyTrend = wkLast > wkFirst * 1.05 ? 'UPTREND' : wkLast < wkFirst * 0.95 ? 'DOWNTREND' : 'SIDEWAYS';
      const weeklyChange = ((wkLast - wkFirst) / wkFirst) * 100;

      // ── Drawdown from 52w high ────────────────────────────────────────────
      const maxDrawdown = pctFromHigh; // already negative if below high

      // ── AI prompt ─────────────────────────────────────────────────────────
      const prompt = `You are an expert NVDA stock analyst focused on LONG-TERM investing (3-12 month horizon).
Assess whether NVDA is a BUY, HOLD, or SELL for a long-term position.

PRICE & TREND DATA:
- Current Price: $${price.toFixed(2)}
- 52-Week High: $${high52w.toFixed(2)}  (${pctFromHigh.toFixed(1)}% from high)
- 52-Week Low:  $${low52w.toFixed(2)}   (+${pctFromLow.toFixed(1)}% from low)
- 52-Week Range Position: ${rangePos.toFixed(1)}%
- SMA-50:  ${sma50  ? '$' + sma50.toFixed(2)  : 'N/A'}  (price ${aboveSma50  ? 'above ▲' : 'below ▼'})
- SMA-200: ${sma200 ? '$' + sma200.toFixed(2) : 'N/A'}  (price ${aboveSma200 ? 'above ▲' : 'below ▼'})
- Golden Cross: ${goldenCross ? 'YES (bullish)' : 'NO (bearish)'}
- RSI (14): ${rsi?.toFixed(1) ?? 'N/A'}  (${rsi ? rsiLabel(rsi) : 'N/A'})
- ATR: ${atr ? '$' + atr.toFixed(2) + ' (' + ((atr / price) * 100).toFixed(1) + '%)' : 'N/A'}
- Max Drawdown from 52w High: ${maxDrawdown.toFixed(1)}%

WEEKLY TREND (2-year):
- Direction: ${weeklyTrend}
- 2-Year Change: ${weeklyChange.toFixed(1)}%

TREND ANALYSIS:
- 30-day:  ${patterns30d}
- 90-day:  ${patterns90d}
- 1-year:  ${patterns365d}

CHART PATTERNS (daily):
${chartPatterns.patterns.join(', ')}
Key Support:    $${chartPatterns.nearest_support?.toFixed(2) ?? 'N/A'}
Key Resistance: $${chartPatterns.nearest_resistance?.toFixed(2) ?? 'N/A'}
Fibonacci Position: ${chartPatterns.fibonacci_position}

MACRO CONTEXT:
- Regime: ${macroContext.market_regime}
- Risk: ${macroContext.risk_sentiment}
- SPY: ${macroContext.sp500_correlation}
- QQQ: ${macroContext.nasdaq_correlation}

RECENT NEWS & CATALYSTS:
${newsItems.join('\n')}

Provide your long-term outlook using the format:
PREDICTION: UP or DOWN
CONFIDENCE: 0-100
STRATEGY: long-term position strategy
TARGET: $price (12-month target)
STOP: $price (long-term invalidation level)
`;

      const aiAnalysis = await this.aiService.analyze(prompt);

      if (aiAnalysis.status === 'error' || aiAnalysis.status === 'uncertain') {
        ln(`  ${ERR}  AI analysis failed: ${aiAnalysis.reason}`);
        return;
      }

      // ════════════════════════════════════════════════════════════════════════
      // VERDICT BOX
      // ════════════════════════════════════════════════════════════════════════
      const predColorFn =
        aiAnalysis.prediction === 'UP'   ? clr.green :
        aiAnalysis.prediction === 'DOWN' ? clr.red   : clr.yellow;
      const predLabel =
        aiAnalysis.prediction === 'UP'   ? 'BULLISH' :
        aiAnalysis.prediction === 'DOWN' ? 'BEARISH' : 'NEUTRAL';
      const predBadgeColor: BadgeColor =
        aiAnalysis.prediction === 'UP'   ? 'green' :
        aiAnalysis.prediction === 'DOWN' ? 'red'   : 'yellow';

      const entry      = price;
      const target     = aiAnalysis.target_price ?? (entry * 1.20);
      const stop       = aiAnalysis.stop_loss    ?? (entry * 0.85);
      const targetPct  = ((target - entry) / entry) * 100;
      const stopPct    = ((stop   - entry) / entry) * 100;
      const rrRatio    = Math.abs(targetPct / stopPct);

      ln('');
      ln(hr2());
      ln(`  ${badge('verdict', predBadgeColor)}  ${predColorFn(predLabel)}  ${clr.dim('·')}  ${confColor(aiAnalysis.confidence)}  confidence  ${clr.dim('·')}  12-mo R/R ${clr.dim('1 : ' + rrRatio.toFixed(2))}`);
      ln(hr2());
      row('current',  clr.dim('$' + entry.toFixed(2)));
      row('target',   clr.green('$' + target.toFixed(2)) + clr.dim('  (' + pctColor(targetPct) + '  upside)'), 'green');
      row('stop',     clr.red('$'   + stop.toFixed(2))   + clr.dim('  (' + pctColor(stopPct)   + '  invalidation)'), 'red');
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

      // ── AI outlook (full detail) ──────────────────────────────────────────
      section('ai', `AI LONG-TERM OUTLOOK  ${clr.dim('(' + config.aiModel + ')')}`, 'magenta');
      row('outlook',    predColorFn(predLabel), predBadgeColor);
      row('confidence', confColor(aiAnalysis.confidence));
      row('strategy',   clr.dim(aiAnalysis.strategy ?? 'N/A'));

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
      const summaryDir  = aiAnalysis.prediction === 'UP' ? 'bullish' : aiAnalysis.prediction === 'DOWN' ? 'bearish' : 'neutral';
      const summaryConf = aiAnalysis.confidence >= 70 ? 'high' : aiAnalysis.confidence >= 50 ? 'moderate' : 'low';
      ln(`  ${clr.dim(`NVDA ${summaryDir} on ${summaryConf} AI confidence (${aiAnalysis.confidence}%).`)}`);
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

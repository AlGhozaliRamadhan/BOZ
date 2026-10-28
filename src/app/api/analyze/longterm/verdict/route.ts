import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody, requestBodyErrorResponse } from '@/app/lib/api-helpers';
import { AIService } from '@/services/ai/ai.service';
import { buildPotentialLevels } from '@/shared/trade-levels';
import { parseFxSymbol, type FxPair } from '@/shared/fx';
import { formatCrowdSignalEvidence } from '@/shared/evidence-attribution';
import { buildStocktwitsPulse } from '@/shared/crowd-pulse';

function formatStocktwitsPulseShort(stocktwits: any): string {
  if (!stocktwits) return 'N/A';
  const pulse = buildStocktwitsPulse({
    bullish: stocktwits.bullish ?? null,
    bearish: stocktwits.bearish ?? null,
    total_with_sentiment: stocktwits.total_with_sentiment ?? null,
    total_messages: stocktwits.total_messages ?? null,
    bull_ratio: stocktwits.bull_ratio,
  });
  if (pulse.bullRatio == null || pulse.labelled <= 0) return 'no audited read';
  return `${pulse.bullRatio.toFixed(0)}% Bullish of ${pulse.labelled} labelled (confidence ${pulse.confidence})`;
}

export async function POST(request: NextRequest) {
  try {
    const { ticker, marketData, macro, sentiment, chartPatterns } = await parseBody<{ 
      ticker: string, 
      marketData: any, 
      macro: any, 
      sentiment: any, 
      chartPatterns: any 
    }>(request);
    
    if (!ticker) return errorResponse('Ticker is required', 400);
    if (!marketData || !marketData.lastCandleFull) return errorResponse('Market data missing', 400);

    const context52w = {
      high52w: marketData.fiftyTwoWeekHigh,
      low52w: marketData.fiftyTwoWeekLow,
      from52wHigh: marketData.from52wHigh,
      from52wLow: marketData.from52wLow
    };

    const aiService = new AIService();
    const pair = parseFxSymbol(ticker) ?? parseFxSymbol(String(marketData.pair ?? ''));
    const prompt = buildLongtermPrompt(ticker, marketData.lastCandleFull, pair, macro, sentiment, chartPatterns, context52w);
    const verdict = await aiService.analyze(prompt);

    // Legacy levels (fixed-percentage math). Canonical math is risk_calc
    // in shared/risk-math.ts. Always emit a potential envelope — even on
    // WATCH / uncertain / error — so callers still show where price could go.
    const verdictLean = verdict as { prediction?: 'UP' | 'DOWN' | 'UNKNOWN'; confidence?: number };
    const tradeLevels = buildPotentialLevels(
      marketData.lastCandleFull.close ?? null,
      verdict.status === 'ok' ? verdict.prediction : (verdictLean.prediction ?? 'UNKNOWN'),
      verdict.status === 'ok' ? verdict.confidence : (verdictLean.confidence ?? 50),
      '',
    );
    if (verdict.status !== 'ok') {
      tradeLevels.isPotential = true;
    }

    return jsonResponse({
      verdict,
      tradeLevels,
    });
  } catch (err: unknown) {
    const bodyError = requestBodyErrorResponse(err);
    if (bodyError) return bodyError;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}

function buildLongtermPrompt(
  ticker: string,
  last: any,
  pair: FxPair | null,
  macro: any,
  sentiment: any,
  chartPatterns: any,
  context52w: { high52w: number; low52w: number; from52wHigh: number; from52wLow: number },
): string {
  const fmt = (v: number | null | undefined, decimals = 2) =>
    v != null ? v.toFixed(decimals) : 'N/A';
  // A pair is a rate: own precision, no dollar sign, and no volume story.
  const px = (v: number | null | undefined, decimals = pair ? pair.precision : 2) =>
    v != null ? v.toFixed(decimals) : 'N/A';
  const unit = pair ? '' : '$';
  const flowLine = pair
    ? '- Institutional Flow & Volatility: OBV Trend: not applicable | Volume Ratio: not reported for FX | ATR: ' + fmt(last.ATR_Percent) + '%'
    : `- Institutional Flow & Volatility: RSI: ${fmt(last.RSI, 1)} | OBV Trend: ${last.OBV_Trend ? 'Accumulation' : 'Distribution'} | Volume Ratio: ${fmt(last.Volume_Ratio)}x | ATR: ${fmt(last.ATR_Percent)}%`;

  return `Conduct a comprehensive institutional multi-month investment analysis and strategic outlook for ${ticker}${pair ? ` (${pair.pair})` : ''} (3-12 month horizon).

Asset & Valuation Profile:
- Current Price: ${unit}${px(last.close)}
- 52-Week Range: High ${unit}${px(context52w.high52w)} (${fmt(context52w.from52wHigh, 1)}% from ATH) | Low ${unit}${px(context52w.low52w)} (+${fmt(context52w.from52wLow, 1)}% off lows)
- Multi-Timeframe Alignment: SMA20: ${unit}${px(last.SMA_20)} | SMA50: ${unit}${px(last.SMA_50)} | SMA200: ${unit}${px(last.SMA_200)}
${flowLine}

Macro Regime & Monetary Backdrop:
- Global Macro Regime: ${macro.market_regime} | Risk Sentiment: ${macro.risk_sentiment}
- 10-Year Treasury Yield: ${macro.tnx_yield != null ? macro.tnx_yield.toFixed(2) + '%' : 'N/A'} | SPY Beta/Corr: ${macro.sp500_correlation} | VIX: ${macro.vix_level ?? 'N/A'}
- Crowd Sentiment: Fear & Greed: ${sentiment.fear_greed?.value ?? 'N/A'} (${sentiment.fear_greed?.label ?? 'N/A'}) | StockTwits: ${formatStocktwitsPulseShort(sentiment.stocktwits_data)}
- Crowd evidence: ${formatCrowdSignalEvidence(sentiment) || 'No source-attributed crowd signal was available.'}

Multi-Month Chart Structure:
- Daily/Weekly Patterns: ${chartPatterns.patterns?.join(', ') || 'None'}
- Fibonacci Position: ${chartPatterns.fibonacci_position || 'N/A'}
- Primary Floor: ${unit}${px(chartPatterns.nearest_support)} | Overhead Resistance: ${unit}${px(chartPatterns.nearest_resistance)}${pair ? `

FX note: ${pair.pair} is a rate quoted to ${pair.precision} decimals; one pip is ${pair.pipSize} ${pair.quote}. A long-horizon pair view is a macro view — rate differentials, central-bank path and carry. Read risk in pips, not dollars, and never imply execution — BOZ is research only.` : ''}

REQUIRED OUTPUT:
1. "thesis": In-depth institutional investment thesis detailing the company's business model vision, secular growth catalysts, economic moat, competitive positioning, valuation multiple potential, and 3-12 month roadmap.
2. "strategy": Concrete positioning strategy (accumulation conditions, multi-tranche DCA, portfolio sizing, invalidation level). Do not invent band/price numbers here — levels come only from deterministic tool output; state missing inputs as missing.
3. "reasons": 3-4 strategic catalyst pillars (e.g. secular industry adoption, earnings margin expansion, institutional accumulation) — do NOT write generic indicator statements.`;
}

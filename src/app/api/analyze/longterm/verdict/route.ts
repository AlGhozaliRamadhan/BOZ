import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody } from '@/app/lib/api-helpers';
import { AIService } from '@/services/ai/ai.service';
import { buildTradeLevels } from '@/shared/trade-levels';

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
    const prompt = buildLongtermPrompt(ticker, marketData.lastCandleFull, macro, sentiment, chartPatterns, context52w);
    const verdict = await aiService.analyze(prompt);

    let tradeLevels = null;
    if (verdict.status === 'ok') {
      const action = verdict.prediction === 'UP' ? 'BUY' : verdict.prediction === 'DOWN' ? 'SELL' : 'WATCH';
      tradeLevels = buildTradeLevels(marketData.lastCandleFull.close, action as 'BUY' | 'SELL' | 'WATCH', verdict.confidence, '');
    }

    return jsonResponse({
      verdict,
      tradeLevels,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}

function buildLongtermPrompt(
  ticker: string,
  last: any,
  macro: any,
  sentiment: any,
  chartPatterns: any,
  context52w: { high52w: number; low52w: number; from52wHigh: number; from52wLow: number },
): string {
  const fmt = (v: number | null | undefined, decimals = 2) =>
    v != null ? v.toFixed(decimals) : 'N/A';

  return `Conduct a comprehensive institutional multi-month investment analysis and strategic business outlook for ${ticker} (3-12 month investment horizon).

Asset & Valuation Profile:
- Current Price: $${fmt(last.close)}
- 52-Week Range: High $${fmt(context52w.high52w)} (${fmt(context52w.from52wHigh, 1)}% from ATH) | Low $${fmt(context52w.low52w)} (+${fmt(context52w.from52wLow, 1)}% off lows)
- Multi-Timeframe Alignment: SMA20: $${fmt(last.SMA_20)} | SMA50: $${fmt(last.SMA_50)} | SMA200: $${fmt(last.SMA_200)}
- Institutional Flow & Volatility: RSI: ${fmt(last.RSI, 1)} | OBV Trend: ${last.OBV_Trend ? 'Accumulation 🟢' : 'Distribution 🔴'} | Volume Ratio: ${fmt(last.Volume_Ratio)}x | ATR: ${fmt(last.ATR_Percent)}%

Macro Regime & Monetary Backdrop:
- Global Macro Regime: ${macro.market_regime} | Risk Sentiment: ${macro.risk_sentiment}
- 10-Year Treasury Yield: ${macro.tnx_yield != null ? macro.tnx_yield.toFixed(2) + '%' : 'N/A'} | SPY Beta/Corr: ${macro.sp500_correlation} | VIX: ${macro.vix_level ?? 'N/A'}
- Crowd Sentiment: Fear & Greed: ${sentiment.fear_greed?.value ?? 'N/A'} (${sentiment.fear_greed?.label ?? 'N/A'}) | StockTwits: ${sentiment.stocktwits_data?.bull_ratio != null ? sentiment.stocktwits_data.bull_ratio.toFixed(0) + '% Bullish' : 'N/A'}

Multi-Month Chart Structure:
- Daily/Weekly Patterns: ${chartPatterns.patterns?.join(', ') || 'None'}
- Fibonacci Position: ${chartPatterns.fibonacci_position || 'N/A'}
- Primary Floor: $${fmt(chartPatterns.nearest_support)} | Overhead Resistance: $${fmt(chartPatterns.nearest_resistance)}

REQUIRED OUTPUT:
1. "thesis": In-depth institutional investment thesis detailing the company's business model vision, secular growth catalysts, economic moat, competitive positioning, valuation multiple potential, and 3-12 month roadmap.
2. "strategy": Concrete positioning strategy (accumulation bands, multi-tranche DCA, portfolio sizing, invalidation level).
3. "reasons": 3-4 strategic catalyst pillars (e.g. secular industry adoption, earnings margin expansion, institutional accumulation) — do NOT write generic indicator statements.`;
}

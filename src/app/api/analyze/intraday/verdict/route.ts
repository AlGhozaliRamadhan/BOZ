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

    const aiService = new AIService();
    const prompt = buildIntradayPrompt(ticker, marketData.lastCandleFull, macro, sentiment, chartPatterns);
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

function buildIntradayPrompt(
  ticker: string,
  last: any,
  macro: any,
  sentiment: any,
  chartPatterns: any,
): string {
  const fmt = (v: number | null | undefined, decimals = 2) =>
    v != null ? v.toFixed(decimals) : 'N/A';

  return `Conduct a comprehensive institutional intraday analysis for ${ticker}.

Market Data Snapshot:
- Current Price: $${fmt(last.close)}
- RSI (14): ${fmt(last.RSI, 1)}
- MACD: ${fmt(last.MACD, 4)} (Signal: ${fmt(last.MACD_Signal, 4)})
- Moving Averages: SMA20: $${fmt(last.SMA_20)} | SMA50: $${fmt(last.SMA_50)}
- Volatility: ATR: $${fmt(last.ATR)} (${fmt(last.ATR_Percent)}%) | BB Width: ${fmt(last.BB_Width)}
- Volume Dynamics: Volume Ratio: ${fmt(last.Volume_Ratio)}x | OBV Trend: ${last.OBV_Trend ? 'Bullish' : 'Bearish'}

Macro & Sentiment Landscape:
- Macro Regime: ${macro.market_regime} | Risk Appetite: ${macro.risk_sentiment}
- SPY Correlation: ${macro.sp500_correlation} | VIX Volatility Index: ${macro.vix_level ?? 'N/A'}
- Sentiment Index: Fear & Greed: ${sentiment.fear_greed?.value ?? 'N/A'} (${sentiment.fear_greed?.label ?? 'N/A'})
- Crowd Ratio: ${sentiment.stocktwits_data?.bull_ratio != null ? sentiment.stocktwits_data.bull_ratio.toFixed(0) + '% Bullish' : 'N/A'}

Price Action & Structure:
- Technical Patterns: ${chartPatterns.patterns?.join(', ') || 'None'}
- Candlestick Dynamics: ${chartPatterns.candle_patterns?.summary_text || 'None'}
- Fibonacci Zone: ${chartPatterns.fibonacci_position || 'N/A'}
- Support Floor: $${fmt(chartPatterns.nearest_support)} | Resistance Ceiling: $${fmt(chartPatterns.nearest_resistance)}

REQUIRED OUTPUT:
1. "thesis": Multi-paragraph professional market breakdown explaining the intraday session vision, liquidity pools, order flow bias, and catalysts.
2. "strategy": Concise, actionable execution blueprint (entry trigger, scaling, stop-loss management).
3. "reasons": 3-4 strategic catalyst points explaining the business/session rationale (NOT raw formula restatements).`;
}

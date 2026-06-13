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

  return `Analyze ${ticker} for intraday trading (2-6 hour horizon).

Current Price: $${fmt(last.close)}
RSI(14): ${fmt(last.RSI, 1)}
MACD: ${fmt(last.MACD, 4)} / Signal: ${fmt(last.MACD_Signal, 4)}
SMA20: ${fmt(last.SMA_20)} | SMA50: ${fmt(last.SMA_50)}
ATR: ${fmt(last.ATR)} (${fmt(last.ATR_Percent)}%)
BB Width: ${fmt(last.BB_Width)}
Volume Ratio: ${fmt(last.Volume_Ratio)}
OBV Trend: ${last.OBV_Trend ? 'Bullish' : 'Bearish'}

Macro Context:
- Market Regime: ${macro.market_regime}
- Risk Sentiment: ${macro.risk_sentiment}
- SPY Correlation: ${macro.sp500_correlation}
- VIX: ${macro.vix_level ?? 'N/A'}

Sentiment:
- Fear & Greed: ${sentiment.fear_greed?.value ?? 'N/A'} (${sentiment.fear_greed?.label ?? 'N/A'})
- StockTwits Bull Ratio: ${sentiment.stocktwits_data?.bull_ratio != null ? sentiment.stocktwits_data.bull_ratio.toFixed(0) + '%' : 'N/A'}

Chart Patterns: ${chartPatterns.patterns?.join(', ') || 'None'}
Candle Pattern: ${chartPatterns.candle_patterns?.summary_text || 'None'}
Fibonacci Position: ${chartPatterns.fibonacci_position || 'N/A'}
Nearest Support: $${fmt(chartPatterns.nearest_support)}
Nearest Resistance: $${fmt(chartPatterns.nearest_resistance)}`;
}

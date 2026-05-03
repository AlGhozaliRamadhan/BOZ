import axios from 'axios';

export class SentimentService {
  async fetchCrowdSentiment(): Promise<any> {
    const crowd = {
      fear_greed:         null as any,
      stocktwits_nvda:    null as any,
      stocktwits_trending: [] as any[],
      summary:            {} as any,
    };

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    // ── Fear & Greed (CNN Money — equity market) ──────────────────────────────
    try {
      const fgRes = await axios.get(
        'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
        { headers, timeout: 10_000 }
      );
      const score = fgRes.data?.fear_and_greed?.score;
      const rating = fgRes.data?.fear_and_greed?.rating;
      if (score !== undefined) {
        crowd.fear_greed = {
          value:    Math.round(score),
          label:    rating ?? 'Unknown',
          momentum: fgRes.data?.fear_and_greed_historical?.data?.[1]?.rating ?? 'N/A',
        };
        console.log(`[CROWD] Fear & Greed: ${crowd.fear_greed.value} (${crowd.fear_greed.label})`);
      }
    } catch (err) {
      console.warn(`[WARNING] Fear & Greed (CNN) error: ${(err as Error).message}`);
      // Fallback: alternative.me (crypto-oriented but better than nothing)
      try {
        const fgRes2 = await axios.get('https://api.alternative.me/fng/?limit=1', { headers, timeout: 8_000 });
        const latest = fgRes2.data?.data?.[0];
        if (latest) {
          crowd.fear_greed = {
            value:    parseInt(latest.value, 10),
            label:    latest.value_classification,
            momentum: 'N/A',
          };
          console.log(`[CROWD] Fear & Greed (fallback): ${crowd.fear_greed.value} (${crowd.fear_greed.label})`);
        }
      } catch { /* silently skip */ }
    }

    // ── StockTwits NVDA ───────────────────────────────────────────────────────
    try {
      const stRes = await axios.get(
        'https://api.stocktwits.com/api/2/streams/symbol/NVDA.json',
        { headers, timeout: 10_000 }
      );
      if (stRes.data?.messages) {
        const messages = stRes.data.messages as any[];
        let bullish = 0, bearish = 0;
        for (const m of messages) {
          const basic = m.entities?.sentiment?.basic;
          if (basic === 'Bullish') bullish++;
          if (basic === 'Bearish') bearish++;
        }
        const total = bullish + bearish;
        crowd.stocktwits_nvda = {
          bullish,
          bearish,
          total_with_sentiment: total,
          bull_ratio: total > 0 ? (bullish / total) * 100 : 50,
        };
        console.log(`[CROWD] StockTwits NVDA: ${crowd.stocktwits_nvda.bull_ratio.toFixed(0)}% bullish`);
      }
    } catch (err) {
      console.warn(`[WARNING] StockTwits NVDA error: ${(err as Error).message}`);
    }

    // ── Summary (consumed by nvda.analyzer.ts) ────────────────────────────────
    const bullRatio = crowd.stocktwits_nvda?.bull_ratio ?? 50;
    const fgValue   = crowd.fear_greed?.value ?? 50;
    const overallSignals: string[] = [];
    if (fgValue < 25)  overallSignals.push('EXTREME_FEAR');
    if (fgValue > 75)  overallSignals.push('EXTREME_GREED');
    if (bullRatio > 70) overallSignals.push('CROWD_BULLISH');
    if (bullRatio < 30) overallSignals.push('CROWD_BEARISH');
    if (overallSignals.length === 0) overallSignals.push('NEUTRAL');

    crowd.summary = {
      overall_signals:  overallSignals,
      nvda_is_trending: !!crowd.stocktwits_nvda,
    };

    return crowd;
  }
}

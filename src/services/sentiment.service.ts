import axios from 'axios';
import https from 'https';
import { log, clr } from '../utils/logger.js';
import { config } from '../config/config.js';

export class SentimentService {
  async fetchCrowdSentiment(): Promise<any> {
    const crowd = {
      fear_greed:          null as any,
      stocktwits_data:     null as any,
      stocktwits_trending: [] as any[],
      social_buzz:         [] as any[],
      summary:             {} as any,
    };

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };

    const redditAgent = new https.Agent({
      keepAlive: true,
      minVersion: 'TLSv1.2',
    });

    // ── Fear & Greed (CNN Money) ───────────────────────────────────────────────
    try {
      const fgRes = await axios.get(
        'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
        { headers, timeout: 10_000 },
      );
      const score  = fgRes.data?.fear_and_greed?.score;
      const rating = fgRes.data?.fear_and_greed?.rating;
      if (score !== undefined) {
        crowd.fear_greed = {
          value:    Math.round(score),
          label:    rating ?? 'Unknown',
          momentum: fgRes.data?.fear_and_greed_historical?.data?.[1]?.rating ?? 'N/A',
        };
        const scoreColor =
          crowd.fear_greed.value < 30 ? clr.red :
          crowd.fear_greed.value > 70 ? clr.green : clr.yellow;
        log.crowd('fear-greed', `${scoreColor(String(crowd.fear_greed.value))}  ${clr.dim(crowd.fear_greed.label)}`);
      }
    } catch (err) {
      log.warn('crowd', `Fear & Greed (CNN) error: ${(err as Error).message}`);
      // Fallback: alternative.me
      try {
        const fgRes2 = await axios.get('https://api.alternative.me/fng/?limit=1', { headers, timeout: 8_000 });
        const latest = fgRes2.data?.data?.[0];
        if (latest) {
          crowd.fear_greed = {
            value:    parseInt(latest.value, 10),
            label:    latest.value_classification,
            momentum: 'N/A',
          };
          log.crowd('fear-greed', `${clr.dim(String(crowd.fear_greed.value))}  ${clr.dim(crowd.fear_greed.label)}  ${clr.ghost('(fallback)')}`);
        }
      } catch { /* silently skip */ }
    }

    // ── StockTwits Data ───────────────────────────────────────────────────────
    try {
      const stRes = await axios.get(
        `https://api.stocktwits.com/api/2/streams/symbol/${config.ticker}.json`,
        { headers, timeout: 10_000 },
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
        crowd.stocktwits_data = {
          bullish,
          bearish,
          total_with_sentiment: total,
          bull_ratio: total > 0 ? (bullish / total) * 100 : 50,
        };
        const ratio      = crowd.stocktwits_data.bull_ratio;
        const ratioColor = ratio > 60 ? clr.green : ratio < 40 ? clr.red : clr.yellow;
        log.crowd('stocktwits', `${ratioColor(ratio.toFixed(0) + '% bullish')}  ${clr.dim(`bulls ${bullish} · bears ${bearish} · total ${messages.length}`)}`);
      }
    } catch (err) {
      log.warn('crowd', `StockTwits ${config.ticker} error: ${(err as Error).message}`);
    }

    // ── Reddit Search (Social Buzz) ──────────────────────────────────────────
    try {
      const query = encodeURIComponent(`${config.ticker} OR $${config.ticker}`);
      const bases = ['https://www.reddit.com', 'https://old.reddit.com'];
      let posts: any[] = [];
      let lastError: string | null = null;

      for (const base of bases) {
        try {
          const redditRes = await axios.get(
            `${base}/search.json?q=${query}&sort=new&limit=10`,
            { headers, timeout: 10_000, httpsAgent: redditAgent },
          );
          posts = redditRes.data?.data?.children ?? [];
          if (posts.length > 0) break;
        } catch (err) {
          lastError = (err as Error).message;
        }
      }

      const titles = posts
        .map((p: any) => p?.data?.title)
        .filter((t: any) => typeof t === 'string')
        .slice(0, 5);
      if (posts.length > 0) {
        crowd.social_buzz.push({
          source: 'Reddit',
          mentions: posts.length,
          top_posts: titles,
        });
        log.crowd('reddit', `${clr.dim(`${posts.length} mentions (last 10)`)}`);
      } else if (lastError) {
        log.warn('crowd', `Reddit ${config.ticker} search error: ${lastError}`);
      }
    } catch (err) {
      log.warn('crowd', `Reddit ${config.ticker} search error: ${(err as Error).message}`);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const bullRatio      = crowd.stocktwits_data?.bull_ratio ?? 50;
    const fgValue        = crowd.fear_greed?.value ?? 50;
    const overallSignals: string[] = [];
    if (fgValue   < 25) overallSignals.push('EXTREME_FEAR');
    if (fgValue   > 75) overallSignals.push('EXTREME_GREED');
    if (bullRatio > 70) overallSignals.push('CROWD_BULLISH');
    if (bullRatio < 30) overallSignals.push('CROWD_BEARISH');
    if (overallSignals.length === 0) overallSignals.push('NEUTRAL');

    crowd.summary = {
      overall_signals:  overallSignals,
      is_trending:      !!crowd.stocktwits_data,
    };

    return crowd;
  }
}

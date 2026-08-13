import axios from 'axios';
import Parser from 'rss-parser';
import https from 'https';
import { log, clr } from '../../utils/logger.js';
import { config } from '../../config/config.js';
import { buildSocialSearchQuery, resolveStockTwitsSymbol } from '../../shared/market-constants.js';

// axios TLS agent for CNN / StockTwits / alternative.me (standard servers, no JA3 issues)
const tlsAgent = new https.Agent({
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  ciphers: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
  ].join(':'),
});

export class SentimentService {
  private readonly retryableStatuses = new Set([429, 500, 502, 503, 504]);
  private readonly retryableCodes = new Set(['ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND']);

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private shouldRetry(err: any): boolean {
    const status = err?.response?.status as number | undefined;
    if (status && this.retryableStatuses.has(status)) return true;
    const code = err?.code as string | undefined;
    if (code && this.retryableCodes.has(code)) return true;
    return false;
  }

  private async withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        if (!this.shouldRetry(err) || attempt === attempts - 1) throw err;
        const base = 500 * Math.pow(2, attempt);
        const jitter = Math.round(Math.random() * 250);
        const delay = Math.min(8000, base + jitter);
        if (process.env.DEBUG_CROWD) {
          log.warn('crowd', `Retrying ${label} in ${delay}ms (attempt ${attempt + 2}/${attempts})`);
        }
        await this.sleep(delay);
      }
    }
    throw lastErr;
  }

  private async fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<any> {
    let lastErr: any;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await fetch(url, init);
        if (res.ok) return res;
        if (!this.retryableStatuses.has(res.status) || attempt === attempts - 1) return res;
        const base = 500 * Math.pow(2, attempt);
        const jitter = Math.round(Math.random() * 250);
        const delay = Math.min(8000, base + jitter);
        if (process.env.DEBUG_CROWD) {
          log.warn('crowd', `Retrying fetch ${url} in ${delay}ms (attempt ${attempt + 2}/${attempts})`);
        }
        await this.sleep(delay);
      } catch (err: any) {
        lastErr = err;
        if (attempt === attempts - 1) throw err;
        const base = 500 * Math.pow(2, attempt);
        const jitter = Math.round(Math.random() * 250);
        const delay = Math.min(8000, base + jitter);
        if (process.env.DEBUG_CROWD) {
          log.warn('crowd', `Retrying fetch ${url} in ${delay}ms (attempt ${attempt + 2}/${attempts})`);
        }
        await this.sleep(delay);
      }
    }
    throw lastErr;
  }

  async fetchCrowdSentiment(tickerOverride?: string): Promise<any> {
    const ticker = (tickerOverride || config.ticker || '').toUpperCase();
    const crowd = {
      fear_greed:          null as any,
      stocktwits_data:     null as any,
      stocktwits_trending: [] as any[],
      social_buzz:         [] as any[],
      summary:             {} as any,
    };

    // Neutral browser-like UA — avoids 418 anti-bot blocks (e.g. CNN Fear & Greed)
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    // StockTwits blocks generic browser UAs — their API requires their own app UA + referrer
    const stHeaders = {
      'User-Agent': 'Stocktwits/5.0 (iPhone; iOS 17; Scale/3.00)',
      'Accept': 'application/json',
      'Referer': 'https://stocktwits.com/',
      'Origin': 'https://stocktwits.com',
    };

    const stockTwitsSymbol = resolveStockTwitsSymbol(ticker);

    // ── Fear & Greed (CNN Money) ───────────────────────────────────────────────
    try {
      const fgRes = await this.withRetry('fear_greed_cnn', () =>
        axios.get(
          'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
          { headers, httpsAgent: tlsAgent, timeout: 10_000 },
        ),
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
      // Silently fall through — CNN 418s are expected (anti-bot WAF), alternative.me is reliable
      if (process.env.DEBUG_CROWD) log.warn('crowd', `Fear & Greed (CNN) error: ${(err as Error).message}`);
      try {
        const fgRes2 = await this.withRetry('fear_greed_altme', () =>
          axios.get(
            'https://api.alternative.me/fng/?limit=1',
            { headers, httpsAgent: tlsAgent, timeout: 8_000 },
          ),
        );
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

    // ── StockTwits ─────────────────────────────────────────────────────────────
    try {
      if (!stockTwitsSymbol) {
        log.crowd('stocktwits', clr.dim(`skipped for ${ticker}`));
      } else {
        const stRes = await this.withRetry('stocktwits_stream', () =>
          axios.get(
            `https://api.stocktwits.com/api/2/streams/symbol/${stockTwitsSymbol}.json`,
            { headers: stHeaders, httpsAgent: tlsAgent, timeout: 10_000 },
          ),
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
          const sampleMessages = messages
            .filter((m: any) => typeof m.body === 'string' && m.body.trim().length > 0)
            .slice(0, 2)
            .map((m: any) => ({
              id: m.id,
              body: m.body.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim(),
              sentiment: m.entities?.sentiment?.basic || null,
              username: m.user?.username || 'Trader',
              created_at: m.created_at,
            }));

          crowd.stocktwits_data = {
            bullish,
            bearish,
            total_with_sentiment: total,
            total_messages: messages.length,
            watchlist_count: stRes.data?.symbol?.watchlist_count ?? null,
            sample_messages: sampleMessages,
            bull_ratio: total > 0 ? (bullish / total) * 100 : 50,
          };
          const ratio      = crowd.stocktwits_data.bull_ratio;
          const ratioColor = ratio > 60 ? clr.green : ratio < 40 ? clr.red : clr.yellow;
          log.crowd('stocktwits', `${ratioColor(ratio.toFixed(0) + '% bullish')}  ${clr.dim(`bulls ${bullish} · bears ${bearish} · total ${messages.length}`)}`);
        }
      }
    } catch (err) {
      log.warn('crowd', `StockTwits ${stockTwitsSymbol ?? ticker} error: ${(err as Error).message}`);
    }

    // ── Reddit Social Buzz ─────────────────────────────────────────────────────
    // Uses native fetch() (Node's undici TLS stack) instead of axios.
    // Cloudflare (which protects reddit.com) rejects Node's OpenSSL JA3 fingerprint
    // with SSL alert 40. Undici has a different TLS fingerprint that passes the check.
    const now = Date.now();
    const cacheKey = ticker;
    if ((global as any).__redditCache && (global as any).__redditCache[cacheKey] && now - (global as any).__redditCache[cacheKey].timestamp < 300000) {
      const cached = (global as any).__redditCache[cacheKey];
      crowd.social_buzz.push({ source: 'Reddit', mentions: cached.mentions, top_posts: cached.top_posts });
      log.crowd('reddit', clr.dim(`${cached.mentions} mentions (cached)`));
    } else {
      try {
      const query    = encodeURIComponent(buildSocialSearchQuery(ticker));
      const searchUrl = `https://www.reddit.com/search.rss?q=${query}&sort=new&limit=100&t=month`;

      const res = await this.fetchWithRetry(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const xml = await res.text();
        const parser = new Parser();
        const feed = await parser.parseString(xml);
        const posts = feed.items || [];
        const titles = posts
          .map(p => p.title as string)
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .slice(0, 5);

        if (posts.length > 0) {
          // Report the actual RSS hit count. The feed is capped (~100); do not invent a larger number.
          const mentions = posts.length;
          crowd.social_buzz.push({
            source: 'Reddit',
            mentions,
            top_posts: titles,
            window: 'month',
            capped: mentions >= 100,
          });
          log.crowd('reddit', clr.dim(`${mentions} recent posts${mentions >= 100 ? ' (feed cap)' : ''}`));

          if (!(global as any).__redditCache) (global as any).__redditCache = {};
          (global as any).__redditCache[cacheKey] = { timestamp: now, mentions, top_posts: titles };
        } else {
          log.crowd('reddit', clr.dim('no recent posts found'));
        }
      } else {
        if (process.env.DEBUG_CROWD) {
          log.warn('crowd', `Reddit HTTP ${res.status} — skipping social buzz`);
        }
      }
    } catch (err) {
        if (process.env.DEBUG_CROWD) {
          log.warn('crowd', `Reddit ${ticker} error: ${(err as Error).message}`);
        }
      }
    }

    // ── Summary ────────────────────────────────────────────────────────────────
    const bullRatio      = crowd.stocktwits_data?.bull_ratio ?? 50;
    const fgValue        = crowd.fear_greed?.value ?? 50;
    const overallSignals: string[] = [];
    if (fgValue   < 25) overallSignals.push('EXTREME_FEAR');
    if (fgValue   > 75) overallSignals.push('EXTREME_GREED');
    if (bullRatio > 70) overallSignals.push('CROWD_BULLISH');
    if (bullRatio < 30) overallSignals.push('CROWD_BEARISH');
    if (overallSignals.length === 0) overallSignals.push('NEUTRAL');

    crowd.summary = {
      overall_signals: overallSignals,
      is_trending:     !!crowd.stocktwits_data,
    };

    return crowd;
  }
}

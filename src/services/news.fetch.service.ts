// ─── services/news.fetch.service.ts ──────────────────────────────────────────
// Single news-fetching service shared by ALL analyzers and agents.
// Previously this logic was duplicated between news.intel.analyzer.ts and
// news.intel.agent.ts (fetchAllNews / fetchAllNewsData).  It now lives here.

import axios            from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir }       from 'os';
import { join }         from 'path';
import Parser           from 'rss-parser';
import { log }          from '../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NewsItem {
  category:   string;
  type:       string;
  title:      string;
  details:    string;
  source:     string;
  timestamp:  string;
  impact:     'high' | 'medium' | 'low';
  assets?:    string[];
  url?:       string;
  sentiment?: string;
}

export interface AllNewsData {
  cryptocurrency: NewsItem[];
  stocks:         NewsItem[];
  commodities:    NewsItem[];
  oil:            NewsItem[];
  forex:          NewsItem[];
  economy:        NewsItem[];
  all:            NewsItem[];
  crowd_sentiment?: CrowdSentiment;
}

export interface CrowdSentiment {
  fear_greed:           FearGreed | null;
  coingecko_community:  CoinSentiment[];
  stocktwits_trending:  StockTwitSymbol[];
  summary:              Record<string, string>;
}

export interface FearGreed {
  value:    number;
  label:    string;
  avg_7d:   number | null;
  trend_7d: number[];
  momentum: string;
}

export interface CoinSentiment {
  symbol:          string;
  name:            string;
  price:           number;
  change_24h:      number;
  crowd_sentiment: 'bullish' | 'bearish';
}

export interface StockTwitSymbol {
  symbol:          string;
  title:           string;
  watchlist_count: number;
}

// ─── NewsFetchService ─────────────────────────────────────────────────────────

export class NewsFetchService {
  private readonly parser  = new Parser();
  private readonly headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  };

  // ── Simple in-memory cache ─────────────────────────────────────────────
  private cache: Record<string, { time: number; data: any }> = {};
  private readonly cacheFile = join(tmpdir(), 'boz-news-cache.json');
  private readonly cacheTTL: Record<string, number> = {
    crypto_news:       300,
    stock_news:        300,
    macro_news:        600,
    news_broad_market: 300,
    crowd_sentiment:   600,
  };

  public constructor() {
    this.cache = this.loadDiskCache();
  }

  // ── RSS feed registry ──────────────────────────────────────────────────
  private readonly marketRssFeeds: Record<string, string[]> = {
    stocks: [
      'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^IXIC,AAPL,MSFT,NVDA&region=US&lang=en-US',
      'https://www.marketwatch.com/rss/topstories',
    ],
    commodities: [
      // kitco.com/rss/kitconews.xml → 404 (path moved)
      // investing.com/rss/news_14.rss → 404 (blocks scrapers)
      // news.goldseek.com/newsRSS.xml → malformed XML entities in feed content
      // Replaced with clean, well-maintained feeds:
      'https://silverseek.com/rss.xml',                    // SilverSeek — silver/metals news since 2003
      'https://www.marketwatch.com/rss/realtimeheadlines', // MarketWatch real-time (incl. commodities)
    ],
    oil:   ['https://oilprice.com/rss/main'],
    forex: ['https://www.fxstreet.com/rss/news'],
    economy: [
      'https://www.cnbc.com/id/100003114/device/rss/rss.html',
      // feeds.reuters.com is dead (ENOTFOUND) — replaced with BBC Business
      'https://feeds.bbci.co.uk/news/business/rss.xml',
    ],
  };

  // ─── Cache helpers ─────────────────────────────────────────────────────

  private async getCached<T>(
    key:        string,
    fetchFn:    () => Promise<T>,
    defaultTTL = 300,
  ): Promise<T> {
    const now = Date.now();
    const ttl = (this.cacheTTL[key] ?? defaultTTL) * 1000;
    if (this.cache[key] && now - this.cache[key].time < ttl) {
      return this.cache[key].data as T;
    }
    const data = await fetchFn();
    this.cache[key] = { time: now, data };
    this.saveDiskCache();
    return data;
  }

  private loadDiskCache(): Record<string, { time: number; data: any }> {
    try {
      if (existsSync(this.cacheFile))
        return JSON.parse(readFileSync(this.cacheFile, 'utf8'));
    } catch {}
    return {};
  }

  private saveDiskCache(): void {
    try {
      writeFileSync(this.cacheFile, JSON.stringify(this.cache), 'utf8');
    } catch {}
  }

  // ─── RSS XML sanitizer ─────────────────────────────────────────────────
  // Some feeds (e.g. GoldSeek) embed bare & or non-standard named entities
  // in their content, which breaks strict XML parsers.  Fetch the raw text,
  // scrub it, then hand it to rss-parser via parseString() instead of
  // parseURL() so we control the input.

  private async parseURLSafe(url: string): Promise<ReturnType<Parser['parseString']>> {
    const res = await axios.get<string>(url, {
      headers:        { ...this.headers, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      timeout:        8000,
      responseType:   'text',
      // Treat any 2xx as success; let non-2xx propagate so the caller's
      // status-code branch can log it correctly.
      validateStatus: s => s >= 200 && s < 300,
    });

    // Replace bare & that are NOT already part of a valid XML entity reference.
    // Valid references: &amp; &lt; &gt; &quot; &apos; &#123; &#xAB; &namedRef;
    // Everything else → &amp;
    const sanitized = res.data.replace(
      /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+|[A-Za-z][A-Za-z\d]*);)/g,
      '&amp;',
    );

    return this.parser.parseString(sanitized);
  }

  // ─── Public: fetch everything ──────────────────────────────────────────

  public async fetchAll(withCrowdSentiment = true): Promise<AllNewsData> {
    const data: AllNewsData = {
      cryptocurrency: [], stocks: [], commodities: [],
      oil: [], forex: [], economy: [], all: [],
    };

    log.info('news', 'Fetching crypto news...');
    data.cryptocurrency = await this.fetchCryptoNews();

    log.info('news', 'Fetching stock news...');
    data.stocks = await this.fetchStockNews();

    log.info('news', 'Fetching macro news...');
    data.economy = await this.fetchMacroNews();

    log.info('news', 'Fetching broad market RSS...');
    const broad = await this.fetchBroadMarketNews();
    for (const item of broad) {
      const cat = item.category.toLowerCase();
      if ((data as any)[cat]) (data as any)[cat].push(item);
      else if (cat === 'macro') data.economy.push(item);
      else data.stocks.push(item);
    }

    if (withCrowdSentiment) {
      log.info('news', 'Fetching crowd sentiment...');
      data.crowd_sentiment = await this.fetchCrowdSentiment();
    }

    data.all = [
      ...data.cryptocurrency, ...data.stocks, ...data.commodities,
      ...data.oil, ...data.forex, ...data.economy,
    ];

    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    data.all.sort(
      (a, b) => (order[a.impact ?? 'low'] ?? 2) - (order[b.impact ?? 'low'] ?? 2),
    );

    log.ok('news',
      `Total: ${data.all.length} items  ` +
      `(crypto ${data.cryptocurrency.length} · stocks ${data.stocks.length} · ` +
      `economy ${data.economy.length} · commodities ${data.commodities.length} · ` +
      `oil ${data.oil.length} · forex ${data.forex.length})`,
    );

    return data;
  }

  // ─── Crypto news ───────────────────────────────────────────────────────

  public async fetchCryptoNews(): Promise<NewsItem[]> {
    return this.getCached('crypto_news', async () => {
      const items: NewsItem[] = [];

      // CoinGecko trending
      try {
        const res = await axios.get(
          'https://api.coingecko.com/api/v3/search/trending',
          { headers: this.headers, timeout: 5000 },
        );
        for (const coin of (res.data?.coins ?? []).slice(0, 10)) {
          items.push({
            category: 'cryptocurrency', type: 'trending',
            title:    `${coin.item.name} (${coin.item.symbol}) trending`,
            details:  `Market cap rank: #${coin.item.market_cap_rank}, score: ${coin.item.score}`,
            source:   'CoinGecko Trending',
            timestamp: new Date().toISOString(),
            impact:   'medium',
            assets:   [coin.item.symbol.toUpperCase()],
          });
        }
      } catch (e: any) { log.warn('news', `CoinGecko trending: ${e.message}`); }

      // CryptoCompare
      try {
        const res = await axios.get(
          'https://min-api.cryptocompare.com/data/v2/news/?lang=EN',
          { headers: this.headers, timeout: 5000 },
        );
        const highKw = ['regulation', 'sec', 'etf', 'approved', 'banned', 'hack',
                        'lawsuit', 'crash', 'surge', 'billion', 'fed', 'rate'];
        const medKw  = ['partnership', 'launch', 'update', 'upgrade', 'adoption',
                        'institutional', 'integration'];
        const ccData = Array.isArray(res.data?.Data) ? res.data.Data : [];
        for (const art of ccData.slice(0, 15)) {
          const blob   = `${art.title ?? ''} ${art.body ?? ''}`.toLowerCase();
          const impact: 'high' | 'medium' | 'low' =
            highKw.some(k => blob.includes(k)) ? 'high' :
            medKw.some(k => blob.includes(k))  ? 'medium' : 'low';
          const cats = (art.categories ?? '')
            .toUpperCase().split('|')
            .filter((c: string) => c.trim().length <= 5 && c.trim().length > 0);
          items.push({
            category:  'cryptocurrency', type: 'news', impact,
            title:     art.title ?? '',
            details:   (art.body ?? '').substring(0, 500),
            source:    art.source ?? 'CryptoCompare',
            url:       art.url,
            timestamp: new Date((art.published_on ?? 0) * 1000).toISOString(),
            assets:    cats.length > 0 ? cats.slice(0, 5) : ['BTC', 'ETH'],
          });
        }
      } catch (e: any) { log.warn('news', `CryptoCompare: ${e.message}`); }

      return items;
    });
  }

  // ─── Stock news ────────────────────────────────────────────────────────

  public async fetchStockNews(): Promise<NewsItem[]> {
    return this.getCached('stock_news', async () => {
      const items: NewsItem[] = [];
      const macroKw = ['fed', 'rate', 'inflation', 'recession', 'earnings', 'ipo',
                       'fomc', 'cpi', 'gdp', 'nfp'];

      if (process.env.ALPHA_VANTAGE_API_KEY) {
        try {
          const res = await axios.get(
            `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`,
            { headers: this.headers, timeout: 5000 },
          );
          for (const art of (res.data?.feed ?? []).slice(0, 10)) {
            items.push({
              category:  'stocks', type: 'news',
              title:     art.title ?? '',
              details:   (art.summary ?? '').substring(0, 500),
              source:    art.source ?? 'Alpha Vantage',
              url:       art.url,
              timestamp: art.time_published ?? new Date().toISOString(),
              sentiment: art.overall_sentiment_label ?? 'Neutral',
              impact:    Math.abs(parseFloat(art.overall_sentiment_score ?? '0')) > 0.5
                           ? 'high' : 'medium',
              assets:    (art.ticker_sentiment ?? []).slice(0, 5).map((t: any) => t.ticker),
            });
          }
        } catch (e: any) { log.warn('news', `Alpha Vantage: ${e.message}`); }
      }

      if (process.env.FINNHUB_API_KEY) {
        try {
          const res = await axios.get(
            `https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY}`,
            { headers: this.headers, timeout: 5000 },
          );
          for (const art of (res.data ?? []).slice(0, 10)) {
            const title  = (art.headline ?? '').toLowerCase();
            const impact: 'high' | 'medium' | 'low' =
              macroKw.some(w => title.includes(w)) ? 'high' : 'medium';
            items.push({
              category:  'stocks', type: 'news', impact,
              title:     art.headline ?? '',
              details:   (art.summary ?? '').substring(0, 500),
              source:    art.source ?? 'Finnhub',
              url:       art.url,
              timestamp: new Date((art.datetime ?? 0) * 1000).toISOString(),
              assets:    (art.related ?? '').split(',').slice(0, 5).filter(Boolean),
            });
          }
        } catch (e: any) { log.warn('news', `Finnhub: ${e.message}`); }
      }

      return items;
    });
  }

  // ─── Macro / FRED news ─────────────────────────────────────────────────

  public async fetchMacroNews(): Promise<NewsItem[]> {
    return this.getCached('macro_news', async () => {
      const items: NewsItem[] = [];
      if (process.env.FRED_API_KEY) {
        try {
          const res = await axios.get(
            `https://api.stlouisfed.org/fred/releases?api_key=${process.env.FRED_API_KEY}&file_type=json&limit=10`,
            { headers: this.headers, timeout: 5000 },
          );
          for (const r of (res.data?.releases ?? []).slice(0, 10)) {
            items.push({
              category:  'economy', type: 'economic_release', impact: 'high',
              title:     r.name ?? '',
              details:   `Economic data release: ${r.name}`,
              source:    'Federal Reserve (FRED)',
              timestamp: new Date().toISOString(),
              assets:    ['SPY', 'DXY', 'TLT', 'GLD'],
            });
          }
        } catch (e: any) { log.warn('news', `FRED API: ${e.message}`); }
      }
      return items;
    });
  }

  // ─── Broad market RSS ──────────────────────────────────────────────────

  public async fetchBroadMarketNews(): Promise<NewsItem[]> {
    return this.getCached('news_broad_market', async () => {
      const items: NewsItem[] = [];
      const highKw = ['breaking', 'urgent', 'crash', 'surge', 'billion', 'regulation',
                      'approved', 'banned', 'record', 'historic'];
      const medKw  = ['announces', 'launches', 'partnership', 'update', 'report',
                      'forecasts', 'warns'];

      for (const [category, feeds] of Object.entries(this.marketRssFeeds)) {
        for (const url of feeds) {
          try {
            // Use parseURLSafe: fetches raw XML, sanitizes bare & entities,
            // then parses — so malformed feeds don't crash the whole category.
            const feed = await this.parseURLSafe(url);
            for (const entry of (feed.items ?? []).slice(0, 10)) {
              const title  = (entry.title ?? '').toLowerCase();
              const impact: 'high' | 'medium' | 'low' =
                highKw.some(k => title.includes(k)) ? 'high' :
                medKw.some(k => title.includes(k))  ? 'medium' : 'low';
              items.push({
                category, type: 'news', impact,
                title:     entry.title ?? '',
                details:   (entry.contentSnippet ?? '').substring(0, 500),
                source:    feed.title ?? 'RSS Feed',
                url:       entry.link,
                timestamp: entry.pubDate ?? new Date().toISOString(),
              });
            }
          } catch (e: any) {
            const status = (e?.response?.status as number | undefined);
            if (status === 404)
              log.warn('news', `RSS ${category}: feed returned 404 — URL may have moved (${url})`);
            else if (status === 503 || status === 429)
              log.info('news', `RSS ${category}: feed temporarily unavailable (${status})`);
            else
              log.warn('news', `RSS ${category}: ${e.message}`);
          }
        }
      }
      return items;
    });
  }

  // ─── Crowd sentiment ───────────────────────────────────────────────────

  public async fetchCrowdSentiment(): Promise<CrowdSentiment> {
    return this.getCached('crowd_sentiment', async () => {
      const crowd: CrowdSentiment = {
        fear_greed:          null,
        coingecko_community: [],
        stocktwits_trending: [],
        summary:             {},
      };

      // Primary: alternative.me (7-day trend)
      try {
        const res = await axios.get(
          'https://api.alternative.me/fng/?limit=7',
          { headers: this.headers, timeout: 5000 },
        );
        const data = res.data?.data ?? [];
        if (data.length > 0) {
          const latest  = data[0];
          const values: number[] = data.map((d: any) => parseInt(d.value ?? '50', 10));
          const avg7d   = values.reduce((a, b) => a + b, 0) / values.length;
          crowd.fear_greed = {
            value:    parseInt(latest.value ?? '50', 10),
            label:    latest.value_classification ?? 'Neutral',
            avg_7d:   Math.round(avg7d * 10) / 10,
            trend_7d: values,
            momentum:
              values[0] > avg7d + 5 ? 'RISING_GREED' :
              values[0] < avg7d - 5 ? 'RISING_FEAR'  : 'STABLE',
          };
        }
      } catch (e: any) { log.warn('news', `Fear & Greed alt.me: ${e.message}`); }

      // Fallback: CNN Fear & Greed
      if (!crowd.fear_greed) {
        try {
          const res = await axios.get(
            'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
            { headers: this.headers, timeout: 5000 },
          );
          const score  = res.data?.fear_and_greed?.score;
          const rating = res.data?.fear_and_greed?.rating;
          if (score !== undefined) {
            crowd.fear_greed = {
              value: Math.round(score), label: rating ?? 'Unknown',
              momentum: 'N/A', avg_7d: null, trend_7d: [],
            };
          }
        } catch { /* silent */ }
      }

      // CoinGecko top-10 community sentiment
      try {
        const res = await axios.get(
          'https://api.coingecko.com/api/v3/coins/markets' +
          '?vs_currency=usd&order=market_cap_desc&per_page=10&page=1' +
          '&sparkline=false&price_change_percentage=24h',
          { headers: this.headers, timeout: 5000 },
        );
        let bull = 0, bear = 0;
        for (const coin of (res.data ?? [])) {
          const chg = coin.price_change_percentage_24h ?? 0;
          if (chg > 0) bull++; else bear++;
          crowd.coingecko_community.push({
            symbol:          (coin.symbol ?? '').toUpperCase(),
            name:            coin.name,
            price:           coin.current_price,
            change_24h:      Math.round(chg * 100) / 100,
            crowd_sentiment: chg > 0 ? 'bullish' : 'bearish',
          });
        }
        crowd.summary.crypto_crowd =
          `${bull} of top 10 coins bullish, ${bear} bearish in last 24h`;
      } catch (e: any) { log.warn('news', `CoinGecko community: ${e.message}`); }

      // StockTwits trending
      try {
        const res = await axios.get(
          'https://api.stocktwits.com/api/2/trending/symbols.json',
          { headers: this.headers, timeout: 5000 },
        );
        for (const sym of (res.data?.symbols ?? []).slice(0, 15)) {
          crowd.stocktwits_trending.push({
            symbol: sym.symbol, title: sym.title,
            watchlist_count: sym.watchlist_count,
          });
        }
        const top5 = (res.data?.symbols ?? []).slice(0, 5).map((s: any) => s.symbol);
        if (top5.length > 0)
          crowd.summary.stocktwits_hot = `Top trending: ${top5.join(', ')}`;
      } catch (e: any) { log.warn('news', `StockTwits: ${e.message}`); }

      // Overall crowd consensus label
      const fg = crowd.fear_greed;
      if (fg) {
        const v = fg.value;
        crowd.summary.overall =
          v <= 25 ? 'EXTREME_FEAR — crowd panicking (contrarian BUY signal)' :
          v <= 40 ? 'FEAR — crowd cautious'                                   :
          v <= 60 ? 'NEUTRAL — crowd undecided'                               :
          v <= 75 ? 'GREED — crowd optimistic'                                :
                    'EXTREME_GREED — crowd euphoric (contrarian SELL signal)';
      }

      return crowd;
    });
  }

  // ─── Utility: collect a flat news blob for keyword matching ───────────

  public collectNewsBlob(data: AllNewsData, assetFilter = ''): string {
    const filter = assetFilter.trim().toUpperCase();
    return data.all
      .filter(n =>
        !filter ||
        `${n.title ?? ''} ${n.details ?? ''}`.toUpperCase().includes(filter),
      )
      .map(n => `${n.title ?? ''} ${n.details ?? ''}`)
      .join(' ')
      .toLowerCase();
  }
}

// ─── Singleton export (mirrors pattern used by yahoo.service.ts) ──────────────
export const newsFetchService = new NewsFetchService();

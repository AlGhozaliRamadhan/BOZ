// ─── services/news.fetch.service.ts ──────────────────────────────────────────
import axios            from 'axios';
import { readFileSync, existsSync } from 'fs';
import { mkdir, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import Parser           from 'rss-parser';
import { log }          from '../../utils/logger.js';
import { mapWithConcurrency } from '../../utils/concurrency.js';

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
  indonesia:      NewsItem[];
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

interface CacheEntry {
  time: number;
  /** TTL in seconds the entry was stored with, so pruning can honour it. */
  ttl?: number;
  data: any;
}

export class NewsFetchService {
  private readonly parser  = new Parser();
  private readonly headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  };

  private readonly retryableStatuses = new Set([429, 500, 502, 503, 504]);
  private readonly retryableCodes = new Set(['ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND']);

  private cache: Record<string, CacheEntry> = {};
  private cacheLoaded = false;
  /** One fetch per key at a time; concurrent callers await the same promise. */
  private readonly cacheInflight = new Map<string, Promise<any>>();
  private diskSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private diskSaving = false;
  private diskDirty = false;
  private readonly cacheTTL: Record<string, number> = {
    crypto_news:        300,
    stock_news:         300,
    macro_news:         600,
    news_broad_market:  300,
    indonesia_news:     180,   // fresher TTL — Indonesian market moves fast
    crowd_sentiment:    600,
  };

  /** Hard ceiling so per-ticker search keys cannot grow without bound. */
  private static readonly MAX_CACHE_ENTRIES = 160;
  private static readonly MAX_CACHE_BYTES = 8_000_000;
  private static readonly DEFAULT_TTL_SECONDS = 300;
  /** Writes are coalesced: a burst of fetches produces one disk write. */
  private static readonly DISK_SAVE_DEBOUNCE_MS = 1_500;

  private cacheFile(): string {
    const cacheDir =
      process.env.BOZ_CACHE_DIR?.trim() ||
      process.env.TMPDIR ||
      process.env.TEMP ||
      process.env.TMP ||
      process.cwd();
    return join(cacheDir, 'boz-news-cache.json');
  }

  private ensureCacheLoaded(): void {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    this.cache = this.loadDiskCache();
  }

  // ─── Retry helpers ───────────────────────────────────────────────────

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
        log.info('news', `Retrying ${label} in ${delay}ms (attempt ${attempt + 2}/${attempts})`);
        await this.sleep(delay);
      }
    }
    throw lastErr;
  }

  // ── RSS feed registry ──────────────────────────────────────────────────
  private readonly marketRssFeeds: Record<string, string[]> = {
    stocks: [
      'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^IXIC,AAPL,MSFT,NVDA&region=US&lang=en-US',
      'https://www.marketwatch.com/rss/topstories',
    ],
    commodities: [
      'https://silverseek.com/rss.xml',
      'https://www.marketwatch.com/rss/realtimeheadlines',
    ],
    oil:   ['https://oilprice.com/rss/main'],
    forex: ['https://www.fxstreet.com/rss/news', 'https://www.dailyfx.com/feeds/market-news'],
    economy: [
      'https://www.cnbc.com/id/100003114/device/rss/rss.html',
      'https://feeds.bbci.co.uk/news/business/rss.xml',
    ],
    // ── Indonesian market feeds ────────────────────────────────────────
    // These are real, public, regularly updated RSS feeds for IDX/IHSG news.
    indonesia: [
      'https://www.cnbcindonesia.com/rss',                                  // CNBC Indonesia — top financial news source
      'https://www.cnnindonesia.com/ekonomi/rss',                           // CNN Indonesia Economy
      'https://www.antaranews.com/rss/ekonomi.xml',                         // Antara News Economy
      'https://finance.detik.com/rss',                                      // Detik Finance
      'https://www.idxchannel.com/rss',                                     // IDX Channel — IDX-specific
    ],
  };

  // ─── Cache helpers ─────────────────────────────────────────────────────

  private async getCached<T>(
    key:        string,
    fetchFn:    () => Promise<T>,
    defaultTTL = NewsFetchService.DEFAULT_TTL_SECONDS,
  ): Promise<T> {
    this.ensureCacheLoaded();
    const now = Date.now();
    const ttl = (this.cacheTTL[key] ?? defaultTTL);
    const entry = this.cache[key];
    if (entry && now - entry.time < ttl * 1000) {
      return entry.data as T;
    }
    if (entry) delete this.cache[key];

    const pending = this.cacheInflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = (async () => {
      try {
        const data = await fetchFn();
        this.cache[key] = { time: Date.now(), ttl, data };
        this.pruneCache();
        this.scheduleDiskSave();
        return data;
      } finally {
        this.cacheInflight.delete(key);
      }
    })();
    this.cacheInflight.set(key, promise);
    return promise;
  }

  /** Drops expired entries, then the oldest survivors once the cap is hit. */
  private pruneCache(now = Date.now()): void {
    for (const [key, entry] of Object.entries(this.cache)) {
      const ttl = entry?.ttl ?? this.cacheTTL[key] ?? NewsFetchService.DEFAULT_TTL_SECONDS;
      if (!entry || typeof entry.time !== 'number' || now - entry.time >= ttl * 1000) {
        delete this.cache[key];
      }
    }

    const keys = Object.keys(this.cache);
    const overflow = keys.length - NewsFetchService.MAX_CACHE_ENTRIES;
    if (overflow <= 0) return;
    keys
      .sort((left, right) => (this.cache[left]?.time ?? 0) - (this.cache[right]?.time ?? 0))
      .slice(0, overflow)
      .forEach(key => delete this.cache[key]);
  }

  private loadDiskCache(): Record<string, CacheEntry> {
    try {
      const cacheFile = this.cacheFile();
      if (!existsSync(cacheFile)) return {};
      const raw = readFileSync(cacheFile, 'utf8');
      if (raw.length > NewsFetchService.MAX_CACHE_BYTES) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const entries: Record<string, CacheEntry> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') continue;
        const candidate = value as CacheEntry;
        if (typeof candidate.time !== 'number' || Number.isNaN(candidate.time)) continue;
        entries[key] = {
          time: candidate.time,
          ttl: typeof candidate.ttl === 'number' ? candidate.ttl : undefined,
          data: candidate.data,
        };
      }
      // Persisted entries are only as fresh as their own TTL.
      for (const [key, entry] of Object.entries(entries)) {
        const ttl = entry.ttl ?? this.cacheTTL[key] ?? NewsFetchService.DEFAULT_TTL_SECONDS;
        if (Date.now() - entry.time >= ttl * 1000) delete entries[key];
      }
      return entries;
    } catch {
      return {};
    }
  }

  /**
   * Best-effort persistence.
   *
   * This used to be a synchronous write on every fetch, which blocked the event
   * loop for a payload that now includes several months of ticker headlines.
   * Writes are now debounced and async (temp file + rename); losing the last
   * few seconds of cache on a hard kill only costs one refetch.
   */
  private scheduleDiskSave(): void {
    this.diskDirty = true;
    if (this.diskSaveTimer) return;
    this.diskSaveTimer = setTimeout(() => {
      this.diskSaveTimer = null;
      void this.flushDiskCache();
    }, NewsFetchService.DISK_SAVE_DEBOUNCE_MS);
    // Never keep the process alive just to persist a cache.
    this.diskSaveTimer.unref?.();
  }

  private async flushDiskCache(): Promise<void> {
    if (this.diskSaving) return;
    this.diskSaving = true;
    try {
      while (this.diskDirty) {
        this.diskDirty = false;
        this.pruneCache();
        const cacheFile = this.cacheFile();
        const temporary = `${cacheFile}.${process.pid}.tmp`;
        const payload = JSON.stringify(this.cache);
        if (payload.length > NewsFetchService.MAX_CACHE_BYTES) return;
        await mkdir(dirname(cacheFile), { recursive: true });
        await writeFile(temporary, payload, 'utf8');
        await rename(temporary, cacheFile);
      }
    } catch {
      // Cache persistence is an optimisation, never a correctness requirement.
    } finally {
      this.diskSaving = false;
    }
  }

  // ─── RSS XML sanitizer ─────────────────────────────────────────────────

  private async parseURLSafe(url: string): Promise<ReturnType<Parser['parseString']>> {
    const res = await this.withRetry(`rss:${url}`, () =>
      axios.get<string>(url, {
        headers:        { ...this.headers, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
        timeout:        8000,
        responseType:   'text',
        maxContentLength: 1_000_000,
        maxBodyLength:  1_000_000,
        validateStatus: s => s >= 200 && s < 300,
      }),
    );

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
      oil: [], forex: [], economy: [], indonesia: [], all: [],
    };

    // Every category (and the crowd read) is an independent provider set.
    // Awaiting them one by one made `fetchAll` cost the sum of all of them.
    log.info('news', 'Fetching news feeds...');
    const [cryptocurrency, stocks, economy, indonesia, broad, crowdSentiment] = await Promise.all([
      this.fetchCryptoNews(),
      this.fetchStockNews(),
      this.fetchMacroNews(),
      this.fetchIndonesiaNews(),
      this.fetchBroadMarketNews(),
      withCrowdSentiment ? this.fetchCrowdSentiment() : Promise.resolve(null),
    ]);

    // The cached arrays are shared with every other request, so copy before
    // appending the broad-market rows into them.
    data.cryptocurrency = [...cryptocurrency];
    data.stocks = [...stocks];
    data.economy = [...economy];
    data.indonesia = [...indonesia];

    for (const item of broad) {
      const cat = item.category.toLowerCase();
      if ((data as any)[cat]) (data as any)[cat].push(item);
      else if (cat === 'macro') data.economy.push(item);
      else data.stocks.push(item);
    }

    if (crowdSentiment) data.crowd_sentiment = crowdSentiment;

    data.all = [
      ...data.indonesia, ...data.cryptocurrency, ...data.stocks,
      ...data.commodities, ...data.oil, ...data.forex, ...data.economy,
    ];

    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    data.all.sort(
      (a, b) => (order[a.impact ?? 'low'] ?? 2) - (order[b.impact ?? 'low'] ?? 2),
    );

    log.ok('news',
      `Total: ${data.all.length} items  ` +
      `(indonesia ${data.indonesia.length} · crypto ${data.cryptocurrency.length} · ` +
      `stocks ${data.stocks.length} · economy ${data.economy.length})`,
    );

    return data;
  }

  // ─── Indonesian market news ────────────────────────────────────────────

  public async fetchIndonesiaNews(): Promise<NewsItem[]> {
    return this.getCached('indonesia_news', async () => {
      const highKw = ['ihsg', 'idx', 'bi rate', 'bank indonesia', 'rupiah', 'idr',
                      'bursa', 'saham', 'crash', 'rally', 'koreksi', 'naik', 'turun',
                      'record', 'all time', 'tertinggi', 'terendah', 'inflasi'];
      const medKw  = ['bbca', 'bbri', 'bmri', 'tlkm', 'asii', 'goto', 'emiten',
                      'dividen', 'laba', 'pendapatan', 'ekspor', 'impor'];

      // The five feeds are independent; fetch them together and keep registry
      // order so the output does not reshuffle between refreshes.
      const perFeed = await mapWithConcurrency(
        this.marketRssFeeds.indonesia,
        5,
        async (url): Promise<NewsItem[]> => {
          const feedItems: NewsItem[] = [];
          try {
            const feed = await this.parseURLSafe(url);
            for (const entry of (feed.items ?? []).slice(0, 12)) {
              const title = (entry.title ?? '').toLowerCase();
              const snippet = (entry.contentSnippet ?? entry.content ?? '').toLowerCase();
              const blob = title + ' ' + snippet;
              const impact: 'high' | 'medium' | 'low' =
                highKw.some(k => blob.includes(k)) ? 'high' :
                medKw.some(k => blob.includes(k))  ? 'medium' : 'low';
              feedItems.push({
                category:  'indonesia',
                type:      'news',
                impact,
                title:     entry.title ?? '',
                details:   (entry.contentSnippet ?? '').substring(0, 500),
                source:    feed.title ?? new URL(url).hostname,
                url:       entry.link,
                timestamp: entry.pubDate ?? new Date().toISOString(),
                assets:    ['IHSG', '^JKSE'],
              });
            }
            log.info('news', `Indonesian RSS (${new URL(url).hostname}): ${feed.items?.length ?? 0} items`);
          } catch (e: any) {
            const status = e?.response?.status as number | undefined;
            if (status === 404)
              log.warn('news', `Indonesian RSS 404 — feed may have moved: ${url}`);
            else if (status === 403 || status === 429)
              log.info('news', `Indonesian RSS blocked (${status}): ${url}`);
            else
              log.warn('news', `Indonesian RSS (${url}): ${e.message}`);
          }
          return feedItems;
        },
      );
      const items = perFeed.flat();

      // Sort: high-impact first, then by recency
      items.sort((a, b) => {
        const impactOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const imp = (impactOrder[a.impact] ?? 2) - (impactOrder[b.impact] ?? 2);
        if (imp !== 0) return imp;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      return items;
    });
  }

  // ─── Crypto news ───────────────────────────────────────────────────────

  public async fetchCryptoNews(): Promise<NewsItem[]> {
    return this.getCached('crypto_news', async () => {
      const items: NewsItem[] = [];

      try {
        const res = await this.withRetry('coingecko_trending', () =>
          axios.get('https://api.coingecko.com/api/v3/search/trending', { headers: this.headers, timeout: 5000 }),
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

      try {
        const res = await this.withRetry('cryptocompare_news', () =>
          axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN', { headers: this.headers, timeout: 5000 }),
        );
        const highKw = ['regulation', 'sec', 'etf', 'approved', 'banned', 'hack',
                        'lawsuit', 'crash', 'surge', 'billion', 'fed', 'rate'];
        const medKw  = ['partnership', 'launch', 'update', 'upgrade', 'adoption', 'institutional'];
        const ccData = Array.isArray(res.data?.Data) ? res.data.Data : [];
        for (const art of ccData.slice(0, 15)) {
          const blob   = `${art.title ?? ''} ${art.body ?? ''}`.toLowerCase();
          const impact: 'high' | 'medium' | 'low' =
            highKw.some(k => blob.includes(k)) ? 'high' :
            medKw.some(k => blob.includes(k))  ? 'medium' : 'low';
          const cats = (art.categories ?? '').toUpperCase().split('|')
            .filter((c: string) => c.trim().length <= 5 && c.trim().length > 0);
          items.push({
            category: 'cryptocurrency', type: 'news', impact,
            title:    art.title ?? '',
            details:  (art.body ?? '').substring(0, 500),
            source:   art.source ?? 'CryptoCompare',
            url:      art.url,
            timestamp: new Date((art.published_on ?? 0) * 1000).toISOString(),
            assets:   cats.length > 0 ? cats.slice(0, 5) : ['BTC', 'ETH'],
          });
        }
      } catch (e: any) { log.warn('news', `CryptoCompare: ${e.message}`); }

      return items;
    });
  }

  // ─── Stock news ────────────────────────────────────────────────────────

  /**
   * Fetch live, ticker-specific headlines from Google News RSS. Unlike the
   * broad market feed, this query is scoped to the dashboard's exact symbol.
   */
  /** Shared Google-News-RSS → NewsItem mapping for every ticker-scoped fetch. */
  private mapGoogleNewsFeed(feed: { items?: any[] }, cleanSymbol: string): NewsItem[] {
    return (feed.items ?? [])
      .map((entry) => {
        const rawTitle = (entry.title ?? '').trim();
        const sourceSeparator = rawTitle.lastIndexOf(' - ');
        return {
          category: 'stocks',
          type: 'news',
          impact: 'medium' as const,
          title: sourceSeparator > 0 ? rawTitle.slice(0, sourceSeparator) : rawTitle,
          details: (entry.contentSnippet ?? entry.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
          source: sourceSeparator > 0 ? rawTitle.slice(sourceSeparator + 3) : 'Google News',
          url: entry.link,
          timestamp: entry.isoDate ?? entry.pubDate ?? new Date().toISOString(),
          assets: [cleanSymbol],
        };
      })
      .filter((item) => item.title);
  }

  public async fetchTickerNews(symbol: string): Promise<NewsItem[]> {
    const cleanSymbol = symbol.replace(/\.JK$/i, '').trim().toUpperCase();
    if (!cleanSymbol) return [];

    return this.getCached('ticker_news_' + cleanSymbol, async () => {
      const query = cleanSymbol + ' stock news earnings catalysts';
      const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en-US&gl=US&ceid=US:en';
      const feed = await this.parseURLSafe(url);
      return this.mapGoogleNewsFeed(feed, cleanSymbol).slice(0, 12);
    });
  }

  /**
   * Day-bucketed companion to `fetchTickerNews` for the calendar day-view:
   * the same Google News search widened with a `when:<days>d` window and a
   * deep item cap, so a clicked day inside the window still has rows. It
   * lives under its own cache key — the strip's fresh 12-item list and this
   * deeper list must not overwrite each other's fetch.
   */
  public async fetchTickerNewsHistory(symbol: string, windowDays = 30): Promise<NewsItem[]> {
    const cleanSymbol = symbol.replace(/\.JK$/i, '').trim().toUpperCase();
    if (!cleanSymbol) return [];
    const days = Math.max(1, Math.min(30, Math.round(windowDays)));

    return this.getCached(
      `ticker_news_history_${cleanSymbol}_${days}`,
      async () => {
        const query = `${cleanSymbol} stock news when:${days}d`;
        const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en-US&gl=US&ceid=US:en';
        const feed = await this.parseURLSafe(url);
        return this.mapGoogleNewsFeed(feed, cleanSymbol).slice(0, 80);
      },
      15 * 60,
    );
  }

  public async fetchStockNews(): Promise<NewsItem[]> {
    return this.getCached('stock_news', async () => {
      const items: NewsItem[] = [];
      const macroKw = ['fed', 'rate', 'inflation', 'recession', 'earnings', 'ipo', 'fomc', 'cpi', 'gdp', 'nfp'];

      if (process.env.ALPHA_VANTAGE_API_KEY) {
        try {
          const res = await this.withRetry('alpha_vantage_news', () =>
            axios.get(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`, { headers: this.headers, timeout: 5000 }),
          );
          for (const art of (res.data?.feed ?? []).slice(0, 10)) {
            items.push({
              category: 'stocks', type: 'news',
              title:    art.title ?? '',
              details:  (art.summary ?? '').substring(0, 500),
              source:   art.source ?? 'Alpha Vantage',
              url:      art.url,
              timestamp: art.time_published ?? new Date().toISOString(),
              sentiment: art.overall_sentiment_label ?? 'Neutral',
              impact:   Math.abs(parseFloat(art.overall_sentiment_score ?? '0')) > 0.5 ? 'high' : 'medium',
              assets:   (art.ticker_sentiment ?? []).slice(0, 5).map((t: any) => t.ticker),
            });
          }
        } catch (e: any) { log.warn('news', `Alpha Vantage: ${e.message}`); }
      }

      if (process.env.FINNHUB_API_KEY) {
        try {
          const res = await this.withRetry('finnhub_news', () =>
            axios.get(`https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY}`, { headers: this.headers, timeout: 5000 }),
          );
          for (const art of (res.data ?? []).slice(0, 10)) {
            const title = (art.headline ?? '').toLowerCase();
            const impact: 'high' | 'medium' | 'low' = macroKw.some(w => title.includes(w)) ? 'high' : 'medium';
            items.push({
              category: 'stocks', type: 'news', impact,
              title:    art.headline ?? '',
              details:  (art.summary ?? '').substring(0, 500),
              source:   art.source ?? 'Finnhub',
              url:      art.url,
              timestamp: new Date((art.datetime ?? 0) * 1000).toISOString(),
              assets:   (art.related ?? '').split(',').slice(0, 5).filter(Boolean),
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
          const res = await this.withRetry('fred_releases', () =>
            axios.get(`https://api.stlouisfed.org/fred/releases?api_key=${process.env.FRED_API_KEY}&file_type=json&limit=10`, { headers: this.headers, timeout: 5000 }),
          );
          for (const r of (res.data?.releases ?? []).slice(0, 10)) {
            items.push({
              category: 'economy', type: 'economic_release', impact: 'high',
              title:    r.name ?? '',
              details:  `Economic data release: ${r.name}`,
              source:   'Federal Reserve (FRED)',
              timestamp: new Date().toISOString(),
              assets:   ['SPY', 'DXY', 'TLT', 'GLD'],
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
      const highKw = ['breaking', 'urgent', 'crash', 'surge', 'billion', 'regulation', 'approved', 'banned', 'record', 'historic'];
      const medKw  = ['announces', 'launches', 'partnership', 'update', 'report', 'forecasts', 'warns'];

      // Only the non-Indonesian feeds here
      const feedsToFetch: Record<string, string[]> = {
        stocks:      this.marketRssFeeds.stocks,
        commodities: this.marketRssFeeds.commodities,
        oil:         this.marketRssFeeds.oil,
        forex:       this.marketRssFeeds.forex,
        economy:     this.marketRssFeeds.economy,
      };

      // Nine feeds across five categories. Awaiting them serially meant the
      // slowest feed decided the whole refresh; they are independent, so fetch
      // them together and let `mapWithConcurrency` keep the burst bounded.
      const tasks = Object.entries(feedsToFetch).flatMap(([category, feeds]) =>
        feeds.map(url => ({ category, url })),
      );

      const perFeed = await mapWithConcurrency(tasks, 6, async ({ category, url }) => {
        const feedItems: NewsItem[] = [];
        try {
          const feed = await this.parseURLSafe(url);
          for (const entry of (feed.items ?? []).slice(0, 10)) {
            const title  = (entry.title ?? '').toLowerCase();
            const impact: 'high' | 'medium' | 'low' =
              highKw.some(k => title.includes(k)) ? 'high' :
              medKw.some(k => title.includes(k))  ? 'medium' : 'low';
            feedItems.push({
              category, type: 'news', impact,
              title:     entry.title ?? '',
              details:   (entry.contentSnippet ?? '').substring(0, 500),
              source:    feed.title ?? 'RSS Feed',
              url:       entry.link,
              timestamp: entry.pubDate ?? new Date().toISOString(),
            });
          }
        } catch (e: any) {
          const status = e?.response?.status as number | undefined;
          if (status === 404) log.warn('news', `RSS ${category}: 404 — URL may have moved (${url})`);
          else if (status === 403 || status === 429 || status === 503)
            log.info('news', `RSS ${category}: blocked/unavailable (${status}) — skipping ${url}`);
          else log.warn('news', `RSS ${category}: ${e.message}`);
        }
        return feedItems;
      });

      // Registry order is preserved by `mapWithConcurrency`, so the cached row
      // order stays stable between refreshes.
      return perFeed.flat();
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

      // Three unrelated providers. The fear&greed pair has a real ordering
      // requirement (alt.me, then CNN only when alt.me failed), so that stays
      // one task; CoinGecko and StockTwits are independent and now overlap it.
      const [fearGreed, coingecko, stocktwits] = await Promise.all([
        this.fetchFearGreed(),
        this.fetchCoinGeckoCommunity(),
        this.fetchStockTwitsTrending(),
      ]);

      if (fearGreed) crowd.fear_greed = fearGreed;
      if (coingecko.items.length > 0) crowd.coingecko_community = coingecko.items;
      if (coingecko.summary) crowd.summary.crypto_crowd = coingecko.summary;
      if (stocktwits.items.length > 0) crowd.stocktwits_trending = stocktwits.items;
      if (stocktwits.summary) crowd.summary.stocktwits_hot = stocktwits.summary;

      const fg = crowd.fear_greed;
      if (fg) {
        const v = fg.value;
        crowd.summary.overall =
          v <= 25 ? 'EXTREME_FEAR — crowd panicking (potential contrarian context; require price confirmation)' :
          v <= 40 ? 'FEAR — crowd cautious'                                   :
          v <= 60 ? 'NEUTRAL — crowd undecided'                               :
          v <= 75 ? 'GREED — crowd optimistic'                                :
                    'EXTREME_GREED — crowd euphoric (contrarian SELL signal)';
      }

      return crowd;
    });
  }

  /** alt.me first; CNN is only asked when alt.me produced nothing usable. */
  private async fetchFearGreed(): Promise<FearGreed | null> {
    try {
      const res = await this.withRetry('fear_greed_altme', () =>
        axios.get('https://api.alternative.me/fng/?limit=7', { headers: this.headers, timeout: 5000 }),
      );
      const data = res.data?.data ?? [];
      if (data.length > 0) {
        // A vendor row without a value must not become a fabricated 50: the
        // index only exists when the payload actually carries one, so
        // malformed rows are dropped and an unusable payload is skipped.
        const latestValue = parseInt(data[0].value, 10);
        const values: number[] = data
          .map((d: any) => parseInt(d.value, 10))
          .filter((v: number) => !Number.isNaN(v));
        if (!Number.isNaN(latestValue) && values.length > 0) {
          const avg7d = values.reduce((a, b) => a + b, 0) / values.length;
          return {
            value:    latestValue,
            label:    data[0].value_classification ?? 'Neutral',
            avg_7d:   Math.round(avg7d * 10) / 10,
            trend_7d: values,
            momentum:
              values[0] > avg7d + 5 ? 'RISING_GREED' :
              values[0] < avg7d - 5 ? 'RISING_FEAR'  : 'STABLE',
          };
        }
      }
    } catch (e: any) { log.warn('news', `Fear & Greed alt.me: ${e.message}`); }

    try {
      const res = await this.withRetry('fear_greed_cnn', () =>
        axios.get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', { headers: this.headers, timeout: 5000 }),
      );
      const score  = res.data?.fear_and_greed?.score;
      const rating = res.data?.fear_and_greed?.rating;
      if (score !== undefined) {
        return { value: Math.round(score), label: rating ?? 'Unknown', momentum: 'N/A', avg_7d: null, trend_7d: [] };
      }
    } catch { /* silent */ }

    return null;
  }

  private async fetchCoinGeckoCommunity(): Promise<{ items: CoinSentiment[]; summary: string | null }> {
    const items: CoinSentiment[] = [];
    try {
      const res = await this.withRetry('coingecko_markets', () =>
        axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h', { headers: this.headers, timeout: 5000 }),
      );
      let bull = 0, bear = 0;
      for (const coin of (res.data ?? [])) {
        const chg = coin.price_change_percentage_24h ?? 0;
        if (chg > 0) bull++; else bear++;
        items.push({
          symbol: (coin.symbol ?? '').toUpperCase(), name: coin.name,
          price: coin.current_price, change_24h: Math.round(chg * 100) / 100,
          crowd_sentiment: chg > 0 ? 'bullish' : 'bearish',
        });
      }
      return {
        items,
        summary: `${bull} of top 10 coins bullish, ${bear} bearish in last 24h`,
      };
    } catch (e: any) {
      log.warn('news', `CoinGecko community: ${e.message}`);
      return { items, summary: null };
    }
  }

  private async fetchStockTwitsTrending(): Promise<{ items: StockTwitSymbol[]; summary: string | null }> {
    const items: StockTwitSymbol[] = [];
    try {
      const res = await this.withRetry('stocktwits_trending', () =>
        axios.get('https://api.stocktwits.com/api/2/trending/symbols.json', {
          headers: {
            ...this.headers,
            Accept: 'application/json',
            Referer: 'https://stocktwits.com/',
            Origin: 'https://stocktwits.com',
          },
          timeout: 5000,
        }),
      );
      const symbols = res.data?.symbols ?? [];
      for (const sym of symbols.slice(0, 15)) {
        items.push({ symbol: sym.symbol, title: sym.title, watchlist_count: sym.watchlist_count });
      }
      const top5 = symbols.slice(0, 5).map((s: any) => s.symbol);
      return {
        items,
        summary: top5.length > 0 ? `Top trending: ${top5.join(', ')}` : null,
      };
    } catch (e: any) {
      log.warn('news', `StockTwits: ${e.message}`);
      return { items, summary: null };
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────

  public collectNewsBlob(data: AllNewsData, assetFilter = ''): string {
    const filter = assetFilter.trim().toUpperCase();
    return data.all
      .filter(n => !filter || `${n.title ?? ''} ${n.details ?? ''}`.toUpperCase().includes(filter))
      .map(n => `${n.title ?? ''} ${n.details ?? ''}`)
      .join(' ')
      .toLowerCase();
  }
}

export const newsFetchService = new NewsFetchService();

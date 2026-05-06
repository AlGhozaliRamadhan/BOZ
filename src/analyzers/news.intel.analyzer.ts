import OpenAI from 'openai';
import axios from 'axios';
import Parser from 'rss-parser';
import { log, clr } from '../utils/logger.js';
import { config } from '../config/config.js';
import { yahooFinance } from '../services/yahoo.service.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewsItem {
  category: string;
  type:      string;
  title:     string;
  details:   string;
  source:    string;
  timestamp: string;
  impact:    'high' | 'medium' | 'low';
  assets?:   string[];
  url?:      string;
  sentiment?: string;
}

interface TradeLevel {
  action:      'BUY' | 'SELL' | 'WATCH';
  entryRange:  string;
  targetRange: string;
  stopLoss:    string;
  lateSignal:  string;
  spotPrice?:  number;
}

interface Opportunity {
  asset:        string;
  asset_type:   string;
  action:       string;
  confidence:   number;
  reasoning:    string;
  entry_range:  string;
  target_range: string;
  stop_loss:    string;
  late_signal:  string;
  invalidation: string;
  risks:        string;
  spot_price?:  number;
}

interface AnalysisResult {
  market_regime:            string;
  market_summary:           string;
  overall_market_sentiment: string;
  cross_asset_themes:       string[];
  high_impact_events:       any[];
  opportunities:            Opportunity[];
  contrarian_signals:       string[];
  risk_warnings:            string[];
  recommended_actions:      string[];
  parse_warnings:           string[];
  ai_reasoning_chain:       string;
  error?:                   string;
  warning?:                 string;
  raw?:                     string;
}

// ─── Symbol map (asset name to Yahoo Finance ticker) ─────────────────────────

const SYMBOL_MAP: Record<string, string> = {
  // Indices
  'SP500': '^GSPC', 'S&P500': '^GSPC', 'S&P 500': '^GSPC', 'SPX': '^GSPC', 'SPY': 'SPY',
  'NASDAQ': '^IXIC', 'QQQ': 'QQQ', 'DOW': '^DJI', 'DJI': '^DJI',
  // Forex / macro
  'DXY': 'DX-Y.NYB', 'DOLLAR': 'DX-Y.NYB',
  'EURUSD': 'EURUSD=X', 'USDJPY': 'JPY=X', 'GBPUSD': 'GBPUSD=X',
  'AUDUSD': 'AUDUSD=X', 'USDCAD': 'CAD=X', 'USDCHF': 'CHF=X',
  // Bonds
  'TLT': 'TLT', 'TNX': '^TNX', '10Y': '^TNX', 'US10Y': '^TNX',
  // Commodities
  'GOLD': 'GC=F', 'XAU': 'GC=F', 'XAUUSD': 'GC=F',
  'SILVER': 'SI=F', 'XAG': 'SI=F',
  'OIL': 'CL=F', 'WTI': 'CL=F', 'USOIL': 'CL=F', 'CRUDE': 'CL=F',
  'BRENT': 'BZ=F', 'NATGAS': 'NG=F',
  'COPPER': 'HG=F', 'WHEAT': 'ZW=F', 'CORN': 'ZC=F',
  // Crypto (Yahoo Finance proxies — real-time)
  'BTC': 'BTC-USD', 'BITCOIN': 'BTC-USD',
  'ETH': 'ETH-USD', 'ETHEREUM': 'ETH-USD',
  'SOL': 'SOL-USD', 'SOLANA': 'SOL-USD',
  'XRP': 'XRP-USD', 'RIPPLE': 'XRP-USD',
  'BNB': 'BNB-USD', 'ADA': 'ADA-USD',
  'DOGE': 'DOGE-USD', 'DOGECOIN': 'DOGE-USD',
  'AVAX': 'AVAX-USD', 'DOT': 'DOT-USD',
  'MATIC': 'MATIC-USD', 'LINK': 'LINK-USD',
  'UNI': 'UNI-USD', 'ATOM': 'ATOM-USD',
  // Mega-cap stocks
  'NVDA': 'NVDA', 'NVIDIA': 'NVDA',
  'AAPL': 'AAPL', 'APPLE': 'AAPL',
  'MSFT': 'MSFT', 'MICROSOFT': 'MSFT',
  'GOOGL': 'GOOGL', 'GOOGLE': 'GOOGL', 'ALPHABET': 'GOOGL',
  'META': 'META', 'AMZN': 'AMZN', 'AMAZON': 'AMZN',
  'TSLA': 'TSLA', 'TESLA': 'TSLA',
  'AMD': 'AMD', 'INTC': 'INTC', 'INTEL': 'INTC',
  'NFLX': 'NFLX', 'NETFLIX': 'NFLX',
  'JPM': 'JPM', 'BAC': 'BAC', 'GS': 'GS',
};

const LATE_KEYWORDS = [
  'already surged', 'soared', 'spiked', 'record high', 'all-time high',
  'all time high', 'ath', 'parabolic', 'overbought', 'extended move',
  'blew past', 'blew through', 'broke out', 'exploded higher',
];

// ─── Main class ───────────────────────────────────────────────────────────────

export class NewsIntelAnalyzer {
  private readonly parser   = new Parser();
  private readonly headers  = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  };

  // ── Cache ────────────────────────────────────────────────────────────────
  private cache: Record<string, { time: number; data: any }> = {};
  private readonly cacheTTL: Record<string, number> = {
    crypto_news:        300,
    stock_news:         300,
    macro_news:         600,
    news_broad_market:  300,
    crowd_sentiment:    600,
  };

  // ── RSS feeds ────────────────────────────────────────────────────────────
  private readonly marketRssFeeds: Record<string, string[]> = {
    stocks: [
      'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^IXIC,AAPL,MSFT,NVDA&region=US&lang=en-US',
      'https://www.marketwatch.com/rss/topstories',
    ],
    commodities: [
      'https://feeds.feedburner.com/CommodityHQ',
      'https://www.kitco.com/rss/kitconews.xml',
    ],
    oil: [
      'https://www.investing.com/rss/news_95.rss',
      'https://oilprice.com/rss/main',
    ],
    forex: [
      'https://www.investing.com/rss/news_1.rss',
      'https://www.fxstreet.com/rss/news',
    ],
    economy: [
      'https://www.cnbc.com/id/100003114/device/rss/rss.html',
      'https://feeds.reuters.com/reuters/businessNews',
    ],
  };

  // ─── Cache helper ─────────────────────────────────────────────────────────

  private async getCached<T>(key: string, fetchFn: () => Promise<T>, defaultTTL = 300): Promise<T> {
    const now = Date.now();
    const ttl = (this.cacheTTL[key] ?? defaultTTL) * 1000;
    if (this.cache[key] && (now - this.cache[key].time) < ttl) {
      log.info('cache', `HIT  ${clr.dim(key)}`);
      return this.cache[key].data as T;
    }
    const data = await fetchFn();
    this.cache[key] = { time: now, data };
    return data;
  }

  // ─── Entry point ──────────────────────────────────────────────────────────

  public async runAnalysis(): Promise<void> {
    log.info('news', 'Starting Universal News Intelligence Analyzer...');

    const newsData = await this.fetchAllNews();
    log.info('news', 'Sending data to AI for analysis...');
    const result = await this.analyzeWithAI(newsData);

    console.log('\n' + clr.dim('━'.repeat(80)));
    console.log(clr.cyan('                      NEWS INTEL ANALYSIS'));
    console.log(clr.dim('━'.repeat(80)) + '\n');
    this.renderResult(result);
    console.log('\n' + clr.dim('━'.repeat(80)) + '\n');
  }

  // ─── Live price fetching ──────────────────────────────────────────────────

  private resolveSymbol(raw: string): string | null {
    const upper = raw.trim().toUpperCase();
    if (SYMBOL_MAP[upper]) return SYMBOL_MAP[upper];
    if (/^[A-Z]{1,5}$/.test(upper)) return upper;
    if (/^[A-Z]{2,8}-USD$/.test(upper)) return upper;
    return null;
  }

  private async getLivePrice(asset: string): Promise<number | null> {
    const symbol = this.resolveSymbol(asset);
    if (!symbol) return null;
    try {
      const quote = await yahooFinance.quote(symbol);
      return (quote as any).regularMarketPrice ?? null;
    } catch {
      return null;
    }
  }

  private buildTradeLevels(
    spot: number | null,
    action: 'BUY' | 'SELL' | 'WATCH',
    confidence: number,
    blob: string,
  ): TradeLevel {
    const isLate = LATE_KEYWORDS.some(k => blob.includes(k));
    const resolvedAction: 'BUY' | 'SELL' | 'WATCH' = isLate && action !== 'WATCH' ? 'WATCH' : action;
    const lateSignal = isLate
      ? 'YES — momentum looks extended; avoid chasing'
      : 'NO — timing still looks reasonable';

    if (spot == null) {
      return {
        action: resolvedAction,
        entryRange:  action === 'BUY'  ? 'from support retest to confirmed breakout'     : action === 'SELL' ? 'from resistance test to breakdown confirmation' : 'wait for clearer setup',
        targetRange: action === 'BUY'  ? 'from first resistance to next resistance'       : action === 'SELL' ? 'from first support to next support'              : 'monitor',
        stopLoss:    action === 'BUY'  ? 'below invalidation level'                       : action === 'SELL' ? 'above invalidation level'                         : 'n/a',
        lateSignal,
      };
    }

    const tight  = confidence >= 75 ? 0.006 : 0.01;
    const tgtLow = confidence >= 70 ? 0.035 : 0.025;
    const tgtHi  = confidence >= 70 ? 0.08  : 0.05;

    let entryLow: number, entryHigh: number, tgt1: number, tgt2: number, stop: number;

    if (resolvedAction === 'BUY') {
      entryLow = spot * (1 - tight); entryHigh = spot * (1 + tight);
      tgt1     = spot * (1 + tgtLow); tgt2 = spot * (1 + tgtHi);
      stop     = spot * 0.97;
    } else if (resolvedAction === 'SELL') {
      entryLow = spot * (1 - tight); entryHigh = spot * (1 + tight);
      tgt1     = spot * (1 - tgtHi); tgt2 = spot * (1 - tgtLow);
      stop     = spot * 1.03;
    } else {
      entryLow = spot * (1 - tight); entryHigh = spot * (1 + tight);
      tgt1     = spot * 0.97;        tgt2      = spot * 1.03;
      stop     = spot * 0.97;
    }

    const fmt = (n: number) => spot > 1000 ? n.toFixed(2) : spot > 10 ? n.toFixed(3) : n.toFixed(5);

    return {
      action: resolvedAction, spotPrice: spot,
      entryRange:  `from ${fmt(entryLow)} to ${fmt(entryHigh)}`,
      targetRange: `from ${fmt(tgt1)} to ${fmt(tgt2)}`,
      stopLoss:    fmt(stop),
      lateSignal,
    };
  }

  // ─── News fetching ────────────────────────────────────────────────────────

  private async fetchCryptoNews(): Promise<NewsItem[]> {
    return this.getCached('crypto_news', async () => {
      const items: NewsItem[] = [];

      try {
        const res = await axios.get('https://api.coingecko.com/api/v3/search/trending', { headers: this.headers, timeout: 5000 });
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
        const res = await axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN', { headers: this.headers, timeout: 5000 });
        const highKw = ['regulation', 'sec', 'etf', 'approved', 'banned', 'hack', 'lawsuit', 'crash', 'surge', 'billion', 'fed', 'rate'];
        const medKw  = ['partnership', 'launch', 'update', 'upgrade', 'adoption', 'institutional', 'integration'];
        const ccData = Array.isArray(res.data?.Data) ? res.data.Data : [];
        for (const art of ccData.slice(0, 15)) {
          const blob   = `${art.title ?? ''} ${art.body ?? ''}`.toLowerCase();
          const impact: 'high' | 'medium' | 'low' =
            highKw.some(k => blob.includes(k)) ? 'high' :
            medKw.some(k => blob.includes(k))  ? 'medium' : 'low';
          const cats = (art.categories ?? '').toUpperCase().split('|').filter((c: string) => c.trim().length <= 5 && c.trim().length > 0);
          items.push({
            category: 'cryptocurrency', type: 'news',
            title:    art.title ?? '',
            details:  (art.body ?? '').substring(0, 500),
            source:   art.source ?? 'CryptoCompare',
            url:      art.url,
            timestamp: new Date((art.published_on ?? 0) * 1000).toISOString(),
            impact,
            assets:   cats.length > 0 ? cats.slice(0, 5) : ['BTC', 'ETH'],
          });
        }
      } catch (e: any) { log.warn('news', `CryptoCompare: ${e.message}`); }

      return items;
    });
  }

  private async fetchStockNews(): Promise<NewsItem[]> {
    return this.getCached('stock_news', async () => {
      const items: NewsItem[] = [];
      const macroKw = ['fed', 'rate', 'inflation', 'recession', 'earnings', 'ipo', 'fomc', 'cpi', 'gdp', 'nfp'];

      if (process.env.ALPHA_VANTAGE_API_KEY) {
        try {
          const res = await axios.get(
            `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`,
            { headers: this.headers, timeout: 5000 },
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
          const res = await axios.get(
            `https://finnhub.io/api/v1/news?category=general&token=${process.env.FINNHUB_API_KEY}`,
            { headers: this.headers, timeout: 5000 },
          );
          for (const art of (res.data ?? []).slice(0, 10)) {
            const title  = (art.headline ?? '').toLowerCase();
            const impact: 'high' | 'medium' | 'low' = macroKw.some(w => title.includes(w)) ? 'high' : 'medium';
            items.push({
              category: 'stocks', type: 'news',
              title:    art.headline ?? '',
              details:  (art.summary ?? '').substring(0, 500),
              source:   art.source ?? 'Finnhub',
              url:      art.url,
              timestamp: new Date((art.datetime ?? 0) * 1000).toISOString(),
              impact,
              assets:   (art.related ?? '').split(',').slice(0, 5).filter(Boolean),
            });
          }
        } catch (e: any) { log.warn('news', `Finnhub: ${e.message}`); }
      }

      return items;
    });
  }

  private async fetchMacroNews(): Promise<NewsItem[]> {
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
              category: 'economy', type: 'economic_release',
              title:    r.name ?? '',
              details:  `Economic data release: ${r.name}`,
              source:   'Federal Reserve (FRED)',
              timestamp: new Date().toISOString(),
              impact:   'high',
              assets:   ['SPY', 'DXY', 'TLT', 'GLD'],
            });
          }
        } catch (e: any) { log.warn('news', `FRED API: ${e.message}`); }
      }
      return items;
    });
  }

  private async fetchBroadMarketNews(): Promise<NewsItem[]> {
    return this.getCached('news_broad_market', async () => {
      const items: NewsItem[] = [];
      const highKw = ['breaking', 'urgent', 'crash', 'surge', 'billion', 'regulation', 'approved', 'banned', 'record', 'historic'];
      const medKw  = ['announces', 'launches', 'partnership', 'update', 'report', 'forecasts', 'warns'];

      for (const [category, feeds] of Object.entries(this.marketRssFeeds)) {
        for (const url of feeds) {
          try {
            const feed = await this.parser.parseURL(url);
            for (const entry of (feed.items ?? []).slice(0, 10)) {
              const title  = (entry.title ?? '').toLowerCase();
              const impact: 'high' | 'medium' | 'low' =
                highKw.some(k => title.includes(k)) ? 'high' :
                medKw.some(k => title.includes(k))  ? 'medium' : 'low';
              items.push({
                category, type: 'news',
                title:    entry.title ?? '',
                details:  (entry.contentSnippet ?? '').substring(0, 500),
                source:   feed.title ?? 'RSS Feed',
                url:      entry.link,
                timestamp: entry.pubDate ?? new Date().toISOString(),
                impact,
              });
            }
          } catch (e: any) {
            const status = (e?.response?.status as number | undefined);
            if (status === 503 || status === 429) log.info('news', `RSS unavailable for ${category} (${status})`);
            else log.warn('news', `RSS ${category}: ${e.message}`);
          }
        }
      }
      return items;
    });
  }

  private async fetchCrowdSentiment(): Promise<any> {
    return this.getCached('crowd_sentiment', async () => {
      const crowd: any = { fear_greed: null, coingecko_community: [], stocktwits_trending: [], summary: {} };

      // Primary: alternative.me with 7-day trend
      try {
        const res = await axios.get('https://api.alternative.me/fng/?limit=7', { headers: this.headers, timeout: 5000 });
        const data = res.data?.data ?? [];
        if (data.length > 0) {
          const latest = data[0];
          const values: number[] = data.map((d: any) => parseInt(d.value ?? '50', 10));
          const avg7d  = values.reduce((a: number, b: number) => a + b, 0) / values.length;
          crowd.fear_greed = {
            value:    parseInt(latest.value ?? '50', 10),
            label:    latest.value_classification ?? 'Neutral',
            avg_7d:   Math.round(avg7d * 10) / 10,
            trend_7d: values,
            momentum: values[0] > avg7d + 5 ? 'RISING_GREED' : values[0] < avg7d - 5 ? 'RISING_FEAR' : 'STABLE',
          };
        }
      } catch (e: any) { log.warn('news', `Fear & Greed alt.me: ${e.message}`); }

      // Fallback: CNN F&G
      if (!crowd.fear_greed) {
        try {
          const res = await axios.get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', { headers: this.headers, timeout: 5000 });
          const score  = res.data?.fear_and_greed?.score;
          const rating = res.data?.fear_and_greed?.rating;
          if (score !== undefined) {
            crowd.fear_greed = { value: Math.round(score), label: rating ?? 'Unknown', momentum: 'N/A', avg_7d: null, trend_7d: [] };
          }
        } catch { /* silent */ }
      }

      // CoinGecko top-10 community sentiment
      try {
        const res = await axios.get(
          'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h',
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
        crowd.summary.crypto_crowd = `${bull} of top 10 coins bullish, ${bear} bearish in last 24h`;
      } catch (e: any) { log.warn('news', `CoinGecko community: ${e.message}`); }

      // StockTwits trending
      try {
        const res = await axios.get('https://api.stocktwits.com/api/2/trending/symbols.json', { headers: this.headers, timeout: 5000 });
        for (const sym of (res.data?.symbols ?? []).slice(0, 15)) {
          crowd.stocktwits_trending.push({ symbol: sym.symbol, title: sym.title, watchlist_count: sym.watchlist_count });
        }
        const top5 = (res.data?.symbols ?? []).slice(0, 5).map((s: any) => s.symbol);
        if (top5.length > 0) crowd.summary.stocktwits_hot = `Top trending: ${top5.join(', ')}`;
      } catch (e: any) { log.warn('news', `StockTwits: ${e.message}`); }

      // Crowd consensus label
      const fg = crowd.fear_greed;
      if (fg) {
        const v = fg.value;
        crowd.summary.overall =
          v <= 25 ? 'EXTREME_FEAR — crowd panicking (contrarian BUY signal)' :
          v <= 40 ? 'FEAR — crowd cautious' :
          v <= 60 ? 'NEUTRAL — crowd undecided' :
          v <= 75 ? 'GREED — crowd optimistic' :
                    'EXTREME_GREED — crowd euphoric (contrarian SELL signal)';
      }

      return crowd;
    });
  }

  private async fetchAllNews(): Promise<Record<string, any>> {
    const allNews: Record<string, any> = {
      cryptocurrency: [], stocks: [], commodities: [], oil: [], forex: [], economy: [], all: [],
    };

    log.info('news', 'Fetching crypto news...');
    allNews.cryptocurrency = await this.fetchCryptoNews();

    log.info('news', 'Fetching stock news...');
    allNews.stocks = await this.fetchStockNews();

    log.info('news', 'Fetching macro news...');
    allNews.economy = await this.fetchMacroNews();

    log.info('news', 'Fetching broad market RSS...');
    const broad = await this.fetchBroadMarketNews();
    for (const item of broad) {
      const cat = item.category.toLowerCase();
      if (allNews[cat]) allNews[cat].push(item);
      else if (cat === 'macro') allNews.economy.push(item);
      else allNews.stocks.push(item);
    }

    log.info('news', 'Fetching crowd sentiment...');
    allNews.crowd_sentiment = await this.fetchCrowdSentiment();

    allNews.all = [
      ...allNews.cryptocurrency, ...allNews.stocks, ...allNews.commodities,
      ...allNews.oil, ...allNews.forex, ...allNews.economy,
    ];

    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    allNews.all.sort((a: any, b: any) => (order[a.impact ?? 'low'] ?? 2) - (order[b.impact ?? 'low'] ?? 2));

    log.ok('news', `Total: ${allNews.all.length} items  (crypto ${allNews.cryptocurrency.length} · stocks ${allNews.stocks.length} · economy ${allNews.economy.length} · commodities ${allNews.commodities.length} · oil ${allNews.oil.length} · forex ${allNews.forex.length})`);
    return allNews;
  }

  // ─── AI system prompt ────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    return `You are an elite cross-asset macro strategist with 25 years at top-tier hedge funds. You combine fundamental macro analysis, technical market structure, and crowd psychology into precise, actionable intelligence.

You are NOT a chatbot summarising headlines. You are a researcher conducting a thorough investigation into what the data actually means for markets — not what it says on the surface.

─── ANALYTICAL FRAMEWORK ──────────────────────────────────────────────────────

MULTI-LAYER PROPAGATION — trace every significant event through all three levels:
  FIRST-ORDER:  Direct asset/sector impact (what it hits immediately)
  SECOND-ORDER: Correlated assets that move in sympathy or opposition
  THIRD-ORDER:  Macro regime shift (does this change the risk-on / risk-off environment?)

Examples of proper propagation reasoning:
  - Oil +5% [then] energy stocks up [then] airline/transport stocks down [then] inflation expectations rise [then] USD strengthens [then] gold pressured [then] EM currencies weaker
  - Fed stays hawkish [then] bond yields rise [then] growth stocks pressured [then] value/financials outperform [then] DXY strengthens [then] BTC/gold sell off as real yields rise
  - Regulatory crackdown on crypto [then] BTC dumps [then] altcoins dump harder [then] stablecoin flows spike [then] DeFi TVL drops [then] mining stocks fall

─── BIAS ELIMINATION CHECKLIST (run this before every conclusion) ──────────────

□ Am I defaulting to bullish just because "markets usually go up"? Reconsider.
□ Am I repeating what the headline says instead of interpreting it? Rewrite.
□ Have I stated the strongest BEAR case even if my conclusion is bullish? Required.
□ Is my confidence justified by multiple INDEPENDENT signals, not one loud story? Be honest.
□ Is this move ALREADY PRICED IN? If consensus already expects it, the trade is crowded.
□ Am I ignoring crowd sentiment as a contrarian indicator? Crowd is rarely right at extremes.
□ Would a sophisticated short-seller agree with my thesis? If not, what are they seeing that I'm not?

─── CROWD SENTIMENT RULES (MANDATORY application) ────────────────────────────

Fear & Greed > 80: EXTREME GREED [REDUCE conviction on longs, look for fade setups]
Fear & Greed 65–80: GREED [Be selective, tighten stops on long ideas]
Fear & Greed 40–60: NEUTRAL [Follow the dominant technical trend]
Fear & Greed 25–40: FEAR [Favour buy-the-dip setups with confirmation]
Fear & Greed < 25: EXTREME FEAR [INCREASE conviction on long ideas, contrarian]

CRITICAL: Crowd consensus NEVER confirms a trade. At extremes it is a REVERSAL WARNING.
If StockTwits shows >70% bullish on a ticker, treat it as a BEARISH signal, not a tailwind.

─── SIGNAL QUALITY STANDARDS ──────────────────────────────────────────────────

Confidence > 80%:  Minimum 3 independent confirming signals from different data sources — state each explicitly
Confidence 65–80%: 2 confirming signals with clear directional bias
Confidence 50–65%: Conflicting signals — use WATCH with a specific trigger condition
Confidence < 50%:  Do not output as an opportunity — mention in risk warnings instead

NEVER inflate confidence to sound decisive. Honest uncertainty is more valuable than false precision.

─── LATE-ENTRY RULE ───────────────────────────────────────────────────────────

If a move has ALREADY happened (price spiked, asset surged, ATH reached):
  - Mark action as WATCH, not BUY/SELL
  - Explain what would create a fresh entry (pullback level, consolidation signal)
  - Do not recommend chasing extended moves under any circumstances

─── INVALIDATION REQUIREMENT ──────────────────────────────────────────────────

Every BUY or SELL thesis MUST include a specific invalidation condition:
  BUY invalidates if: [specific price level or event that would flip the thesis]
  SELL invalidates if: [specific price level or event that would flip the thesis]
Vague invalidations ("if sentiment changes") are not acceptable.`;
  }

  // ─── Format news for AI prompt ────────────────────────────────────────────

  private buildNewsPrompt(newsData: Record<string, any>): string {
    const lines: string[] = [];

    const high = (newsData.all as NewsItem[]).filter(n => n.impact === 'high');
    if (high.length > 0) {
      lines.push('═══ HIGH IMPACT EVENTS ════════════════════════════════════════');
      high.slice(0, 12).forEach((n, i) => {
        lines.push(`${i + 1}. [${n.category.toUpperCase()}] ${n.title}`);
        if (n.details)          lines.push(`   [DETAILS] ${n.details.substring(0, 200)}`);
        if (n.assets?.length)   lines.push(`   [ASSETS] ${n.assets.join(', ')}`);
        if (n.sentiment)        lines.push(`   [SENTIMENT] ${n.sentiment}`);
      });
    }

    const med = (newsData.all as NewsItem[]).filter(n => n.impact === 'medium');
    if (med.length > 0) {
      lines.push('\n═══ MEDIUM IMPACT ══════════════════════════════════════════════');
      med.slice(0, 10).forEach((n, i) => {
        lines.push(`${i + 1}. [${n.category.toUpperCase()}] ${n.title}`);
        if (n.assets?.length) lines.push(`   [ASSETS] ${n.assets.join(', ')}`);
      });
    }

    const trending = (newsData.cryptocurrency as NewsItem[]).filter(n => n.type === 'trending');
    if (trending.length > 0) {
      lines.push('\n═══ TRENDING CRYPTO (CoinGecko) ════════════════════════════════');
      trending.slice(0, 8).forEach(n => lines.push(`[TREND] ${n.title}  -  ${n.details}`));
    }

    for (const sector of ['stocks', 'commodities', 'oil', 'forex', 'economy']) {
      const items = (newsData[sector] as NewsItem[] | undefined) ?? [];
      if (items.length > 0) {
        lines.push(`\n═══ ${sector.toUpperCase()} ════════════════════════════════════════════`);
        items.slice(0, 6).forEach((n, i) => lines.push(`${i + 1}. [${n.impact.toUpperCase()}] ${n.title}`));
      }
    }

    const crowd = newsData.crowd_sentiment;
    if (crowd) {
      lines.push('\n═══ WISDOM OF THE CROWD ════════════════════════════════════════');
      const fg = crowd.fear_greed;
      if (fg) {
        lines.push(`Fear & Greed: ${fg.value}/100 (${fg.label})   7d avg: ${fg.avg_7d ?? 'n/a'}   momentum: ${fg.momentum ?? 'n/a'}`);
        if (fg.trend_7d?.length > 0) lines.push(`7-day values: ${(fg.trend_7d as number[]).join(', ')}`);
      }
      if ((crowd.coingecko_community as any[]).length > 0) {
        lines.push('Top-10 crypto 24h price action:');
        (crowd.coingecko_community as any[]).forEach((c: any) => {
          const prefix = c.change_24h > 0 ? '[UP]' : '[DOWN]';
          lines.push(`  ${c.symbol.padEnd(6)} ${prefix} ${c.change_24h}%  (${c.crowd_sentiment})`);
        });
      }
      if ((crowd.stocktwits_trending as any[]).length > 0) {
        const top = (crowd.stocktwits_trending as any[]).slice(0, 5).map((s: any) => s.symbol).join(', ');
        lines.push(`StockTwits most-watched: ${top}`);
      }
      for (const [, v] of Object.entries(crowd.summary ?? {})) {
        lines.push(`CROWD CONSENSUS: ${v}`);
      }
    }

    return lines.join('\n');
  }

  // ─── AI analysis ──────────────────────────────────────────────────────────

  private async analyzeWithAI(newsData: Record<string, any>): Promise<AnalysisResult> {
    const systemPrompt = this.buildSystemPrompt();
    const newsBlock    = this.buildNewsPrompt(newsData);

    const userPrompt = `Analyze the following market intelligence. Total items: ${(newsData.all as any[]).length}.
Date/time: ${new Date().toISOString()}

${newsBlock}

═══ REQUIRED ANALYSIS STAGES ═══════════════════════════════════════════════════

STAGE 1 — REGIME: Is the market RISK_ON, RISK_OFF, or TRANSITION? Cite at least 2 specific data points.
STAGE 2 — PROPAGATION MAP: For the top 3–5 events, trace the full first [second] [third] order effects.
STAGE 3 — CONSENSUS vs SURPRISE: What is the market already pricing in? What could catch it off-guard?
STAGE 4 — CROWD ANALYSIS: Apply the crowd sentiment rules. Is the crowd at an extreme that signals a fade?
STAGE 5 — TIMING: For each opportunity, is the move fresh or already extended? Be explicit.
STAGE 6 — CONVICTION RANKING: Apply the signal quality standards. Assign confidence honestly.

═══ OUTPUT FORMAT (use EXACT headers, no extra text between sections) ══════════

MARKET_REGIME: [RISK_ON / RISK_OFF / TRANSITION] | [2-3 sentence evidence citing specific data points]
MARKET_SUMMARY: [2-3 sentence synthesis of the dominant cross-asset theme]
SENTIMENT: [RISK_ON / RISK_OFF / NEUTRAL]

CROSS_ASSET_THEMES:
- [Theme 1: show the propagation chain explicitly, e.g. "X causes Y which causes Z"]
- [Theme 2]
- [Theme 3]

EVENTS:
1. [EVENT NAME] | [AFFECTED ASSETS] | [BULL/BEAR/NEUTRAL] | [HIGH/MEDIUM/LOW] | [IMMEDIATE/SHORT_TERM/MEDIUM_TERM] | [first-order reasoning] | [second-order effect]
(list up to 8 events, prioritise HIGH impact)

OPPORTUNITIES:
1. [ASSET] | [crypto/stock/commodity/forex/index] | [BUY/SELL/WATCH] | [confidence 0-100] | [bull vs bear case reasoning] | [ENTRY from X to Y] | [TARGET from A to B] | [STOP Z] | [LATE YES/NO — reason] | [specific invalidation condition] | [risk1, risk2, risk3]
(list 4–7 opportunities across different asset classes)

CONTRARIAN_SIGNALS:
- [Something the consensus is wrong about — cite specific crowd data point]

RISK_WARNINGS:
- [Specific actionable risk]
- [Risk 2]
- [Risk 3]

RECOMMENDED_ACTIONS:
- [Specific action with timeframe]
- [Action 2]
- [Action 3]

RULES:
- Confidence > 80 requires 3+ independent confirming signals — state them explicitly in reasoning
- Use WATCH when signals conflict or move is already extended
- Include specific price levels or events in every invalidation condition
- Use "from X to Y" format for all price ranges
- If crowd sentiment is at an extreme, it MUST appear in contrarian signals`;

    log.ai('ai', `Sending to ${config.aiProvider} (${config.aiModel || 'default'})...`);

    let content = '';
    try {
      if (config.aiProvider === 'github') {
        if (!config.github.token) throw new Error('No GitHub token — set GITHUB_TOKEN in .env');
        const res = await axios.post(
          `${config.github.endpoint}/chat/completions`,
          {
            model:       config.github.model ?? 'openai/gpt-4o',
            messages:    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            temperature: 0.35,
            max_tokens:  8000,
          },
          { headers: { Authorization: `Bearer ${config.github.token}` }, timeout: 90_000 },
        );
        content = res.data.choices[0].message.content ?? '';

      } else if (config.aiProvider === 'nvidia') {
        if (!config.nvidia.apiKey) throw new Error('No NVIDIA API key — set NVIDIA_API_KEY in .env');
        const client = new OpenAI({ apiKey: config.nvidia.apiKey, baseURL: config.nvidia.baseURL });
        const res = await client.chat.completions.create({
          model:       config.nvidia.model,
          messages:    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          temperature: 0.35,
          max_tokens:  8000,
        });
        content = res.choices[0].message.content ?? '';

      } else {
        const res = await axios.post(
          `${config.aiEndpoint}/api/chat`,
          {
            model:    config.aiModel,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            stream:   false,
          },
          { timeout: 120_000 },
        );
        content = res.data.message?.content ?? res.data.response ?? '';
      }

      log.ok('ai', `Response received (${content.length.toLocaleString()} chars)`);

      // Strip chain-of-thought if present (DeepSeek / reasoning models)
      let reasoning = '';
      if (content.includes('</think>')) {
        const parts = content.split('</think>');
        reasoning = parts[0].replace('<think>', '').trim();
        content   = parts[parts.length - 1].trim();
        log.info('ai', `Reasoning chain extracted (${reasoning.length} chars)`);
      }

      const parsed = this.parseResponse(content, reasoning);
      if (parsed) return await this.enrichWithLivePrices(parsed, newsData);

      const fallback = this.buildFallback(content, newsData);
      if (fallback) return { ...fallback, warning: 'Parser fell back to keyword extraction' };

      return { ...this.emptyResult(), error: 'Unable to parse AI response', raw: content };

    } catch (err: any) {
      log.error('ai', err.message);
      const fallback = this.buildFallback(content, newsData);
      if (fallback) return { ...fallback, warning: err.message };
      return { ...this.emptyResult(), error: err.message, raw: content };
    }
  }

  // ─── Response parser ──────────────────────────────────────────────────────

  private parseResponse(text: string, reasoning = ''): AnalysisResult | null {
    const result = this.emptyResult();
    result.ai_reasoning_chain = reasoning;

    const lines = text.trim().split('\n');
    let section: string | null = null;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line.startsWith('MARKET_REGIME:'))      { result.market_regime = line.replace('MARKET_REGIME:', '').trim(); continue; }
      if (line.startsWith('MARKET_SUMMARY:'))      { result.market_summary = line.replace('MARKET_SUMMARY:', '').trim(); continue; }
      if (line.startsWith('SENTIMENT:')) {
        const s = line.replace('SENTIMENT:', '').trim().toUpperCase();
        result.overall_market_sentiment = s.includes('RISK_ON') ? 'RISK_ON' : s.includes('RISK_OFF') ? 'RISK_OFF' : 'NEUTRAL';
        continue;
      }

      if (line.startsWith('EVENTS:'))             { section = 'events';     continue; }
      if (line.startsWith('OPPORTUNITIES:'))       { section = 'opps';       continue; }
      if (line.startsWith('RISK_WARNINGS:'))       { section = 'risks';      continue; }
      if (line.startsWith('CROSS_ASSET_THEMES:'))  { section = 'themes';     continue; }
      if (line.startsWith('CONTRARIAN_SIGNALS:'))  { section = 'contrarian'; continue; }
      if (line.startsWith('RECOMMENDED_ACTIONS:')) { section = 'actions';    continue; }
      if (line.startsWith('RULES:'))               { section = null;         continue; }

      if (section === 'events' && line.includes('|')) {
        const p = line.split('|').map(x => x.trim());
        if (p.length >= 4) {
          result.high_impact_events.push({
            event:           p[0].replace(/^\d+\.\s*/, ''),
            affected_assets: p[1].split(',').map((a: string) => a.trim()),
            direction:       p[2],
            impact_level:    p[3],
            time_horizon:    p[4] ?? 'SHORT_TERM',
            reasoning:       p[5] ?? '',
            second_order:    p[6] ?? '',
          });
        }
      } else if (section === 'opps' && line.includes('|')) {
        const p = line.split('|').map(x => x.trim());
        if (p.length >= 4) {
          const confMatch = p[3].match(/\d+/);
          result.opportunities.push({
            asset:        p[0].replace(/^\d+\.\s*/, ''),
            asset_type:   p[1] ?? 'unknown',
            action:       p[2].toUpperCase().includes('BUY') ? 'BUY' : p[2].toUpperCase().includes('SELL') ? 'SELL' : 'WATCH',
            confidence:   confMatch ? parseInt(confMatch[0], 10) : 60,
            reasoning:    p[4] ?? '',
            entry_range:  p[5] ?? '',
            target_range: p[6] ?? '',
            stop_loss:    p[7] ?? '',
            late_signal:  p[8] ?? '',
            invalidation: p[9] ?? '',
            risks:        p[10] ?? '',
          });
        }
      } else if (line.startsWith('-')) {
        const val = line.substring(1).trim();
        if (!val) continue;
        if (section === 'themes')     result.cross_asset_themes.push(val);
        if (section === 'risks')      result.risk_warnings.push(val);
        if (section === 'contrarian') result.contrarian_signals.push(val);
        if (section === 'actions')    result.recommended_actions.push(val);
      }
    }

    if (!result.market_summary && result.high_impact_events.length === 0 && result.opportunities.length === 0) return null;
    return result;
  }

  // ─── Enrich with live prices ──────────────────────────────────────────────

  private async enrichWithLivePrices(result: AnalysisResult, newsData: Record<string, any>): Promise<AnalysisResult> {
    if (result.risk_warnings.length === 0)      result.risk_warnings = this.generateRiskWarnings(newsData);
    if (result.recommended_actions.length === 0) {
      result.recommended_actions = [
        'Monitor high-impact headlines for follow-through confirmation before sizing up',
        'Use smaller position sizes when signals conflict or confidence is below 65%',
        'Set price alerts at key levels — avoid market orders into news-driven moves',
      ];
    }

    result.opportunities = await Promise.all(result.opportunities.map(async (opp) => {
      const blob   = this.collectNewsBlob(newsData, opp.asset);
      const spot   = await this.getLivePrice(opp.asset);
      const action = (opp.action ?? 'WATCH') as 'BUY' | 'SELL' | 'WATCH';
      const levels = this.buildTradeLevels(spot, action, opp.confidence, blob);

      const lateSignal  = levels.lateSignal.startsWith('YES') ? levels.lateSignal : (opp.late_signal || levels.lateSignal);
      const finalAction = levels.action;

      return {
        ...opp,
        action:       finalAction,
        entry_range:  opp.entry_range  || levels.entryRange,
        target_range: opp.target_range || levels.targetRange,
        stop_loss:    opp.stop_loss    || levels.stopLoss,
        late_signal:  lateSignal,
        spot_price:   spot ?? undefined,
        reasoning: lateSignal.startsWith('YES') && !opp.reasoning.toLowerCase().includes('late')
          ? `${opp.reasoning} [Late-entry warning: move may be extended — wait for a setup.]`.trim()
          : opp.reasoning,
      };
    }));

    return result;
  }

  // ─── Fallback analysis ────────────────────────────────────────────────────

  private buildFallback(text: string, newsData: Record<string, any>): AnalysisResult | null {
    const blob   = (text + ' ' + this.collectNewsBlob(newsData)).toLowerCase();
    const bullKw = ['bullish', 'buy', 'long', 'positive', 'rally', 'surge', 'breakout', 'upside', 'recovery'];
    const bearKw = ['bearish', 'sell', 'short', 'negative', 'crash', 'dump', 'drop', 'hack', 'decline'];
    const bull   = bullKw.filter(w => blob.includes(w)).length;
    const bear   = bearKw.filter(w => blob.includes(w)).length;
    const sentiment = bull > bear + 1 ? 'RISK_ON' : bear > bull + 1 ? 'RISK_OFF' : 'NEUTRAL';

    const assets = new Set<string>();
    for (const item of ((newsData.all ?? []) as any[])) {
      for (const a of ((item.assets ?? []) as string[])) {
        if (typeof a === 'string' && a.trim()) assets.add(a.trim().toUpperCase());
      }
    }

    const topAssets = Array.from(assets).slice(0, 5);
    const highNews  = ((newsData.all ?? []) as any[]).filter(n => n.impact === 'high').slice(0, 5);

    const events = highNews.map((n: any) => {
      const nb  = `${n.title ?? ''} ${n.details ?? ''}`.toLowerCase();
      const dir = bullKw.some(w => nb.includes(w)) ? 'BULL' : bearKw.some(w => nb.includes(w)) ? 'BEAR' : 'NEUTRAL';
      return {
        event: String(n.title ?? '').slice(0, 100),
        affected_assets: Array.isArray(n.assets) && n.assets.length > 0 ? n.assets.slice(0, 3) : ['BTC'],
        direction: dir, impact_level: 'HIGH', time_horizon: 'SHORT_TERM',
        reasoning: String(n.details ?? '').slice(0, 150),
      };
    });

    const opps: Opportunity[] = topAssets.slice(0, 3).map(asset => ({
      asset, asset_type: 'crypto',
      action:      sentiment === 'RISK_ON' ? 'BUY' : sentiment === 'RISK_OFF' ? 'SELL' : 'WATCH',
      confidence:  sentiment === 'NEUTRAL' ? 50 : 60,
      reasoning:   `${asset} appears across news items — aggregate tone: ${sentiment.toLowerCase().replace('_', ' ')}`,
      entry_range: '', target_range: '', stop_loss: '', late_signal: '', invalidation: '',
      risks:       'news volatility, confirmation risk',
    }));

    if (events.length === 0 && opps.length === 0) return null;

    return {
      ...this.emptyResult(),
      market_regime:            sentiment,
      market_summary:           `Fallback: ${(newsData.all ?? []).length} items scanned. ${bull} bullish / ${bear} bearish signals.`,
      overall_market_sentiment: sentiment,
      high_impact_events:       events,
      opportunities:            opps,
      risk_warnings:            this.generateRiskWarnings(newsData),
      recommended_actions: [
        'Review headlines that triggered the strongest signals',
        'Wait for price confirmation before sizing up',
        'Treat this output as a watchlist — not a direct signal',
      ],
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private collectNewsBlob(newsData: Record<string, any>, assetFilter = ''): string {
    const filter = assetFilter.trim().toUpperCase();
    return ((newsData.all ?? []) as any[])
      .filter((n: any) => !filter || `${n.title ?? ''} ${n.details ?? ''}`.toUpperCase().includes(filter))
      .map((n: any) => `${n.title ?? ''} ${n.details ?? ''}`)
      .join(' ')
      .toLowerCase();
  }

  private generateRiskWarnings(newsData: Record<string, any>): string[] {
    const blob  = this.collectNewsBlob(newsData);
    const warns: string[] = [];
    if (/(regulation|sec|ban|lawsuit|crackdown)/.test(blob)) warns.push('Regulatory headlines present — sudden repricing risk, especially in crypto');
    if (/(hack|exploit|breach|rug)/.test(blob))              warns.push('Security incidents in news — verify custody and venue safety before trading');
    if (/(crash|dump|selloff|rout)/.test(blob))              warns.push('Bearish language elevated — long positions need tighter risk management');
    if (/(surge|rally|spike|explode)/.test(blob))            warns.push('Recent upside looks fast — late entries carry poor risk/reward');
    if (/(fomc|fed|rate decision|cpi|nfp)/.test(blob))       warns.push('Macro event risk — avoid sizing up into major data releases');
    if (warns.length === 0) warns.push('Market conditions can change rapidly', 'Cross-check headlines before acting');
    return warns.slice(0, 4);
  }

  private emptyResult(): AnalysisResult {
    return {
      market_regime: '', market_summary: '', overall_market_sentiment: 'NEUTRAL',
      cross_asset_themes: [], high_impact_events: [], opportunities: [],
      contrarian_signals: [], risk_warnings: [], recommended_actions: [],
      parse_warnings: [], ai_reasoning_chain: '',
    };
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  private wrapText(text: string, width = 90): string[] {
    const words = (text ?? '').trim().split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (!cur) { cur = w; continue; }
      if ((cur + ' ' + w).length <= width) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  private norm(v: string, prefixes: string[]): string {
    let s = (v ?? '').trim();
    for (const p of prefixes) s = s.replace(new RegExp(`^${p}[:\\s\\-]*`, 'i'), '').trim();
    return s;
  }

  public renderResult(result: AnalysisResult): void {
    const W     = 78;
    const heavy = clr.dim('━'.repeat(W));
    const light = clr.dim('─'.repeat(W));
    const br    = () => console.log('');

    if (result.error) {
      br();
      console.log(clr.red('  [ERROR] Analysis failed'));
      console.log(clr.dim('  ' + result.error));
      if (result.raw) console.log(clr.dim('\n' + result.raw.substring(0, 800)));
      return;
    }

    if (result.warning) console.log(clr.yellow(`  [WARNING] ${result.warning}`));

    br();
    console.log(heavy);
    console.log(clr.yellow('  [ANALYSIS] NEWS INTEL ANALYSIS'));
    console.log(heavy);

    // Regime + sentiment
    const regime  = (result.market_regime ?? 'UNKNOWN').toUpperCase();
    const sent    = (result.overall_market_sentiment ?? 'NEUTRAL').toUpperCase();
    const rClr    = regime.includes('RISK_ON') ? clr.green : regime.includes('RISK_OFF') ? clr.red : clr.yellow;
    const sClr    = sent === 'RISK_ON' ? clr.green : sent === 'RISK_OFF' ? clr.red : clr.yellow;

    br();
    console.log(`  ${rClr('REGIME')}    ${rClr(regime)}`);
    console.log(`  ${clr.dim('SENTIMENT')}  ${sClr(sent)}`);
    br();

    if (result.market_summary) {
      console.log(light);
      console.log(clr.white('  MARKET SUMMARY'));
      console.log(light);
      br();
      this.wrapText(result.market_summary, W - 4).forEach(l => console.log(`  ${clr.dim(l)}`));
      br();
    }

    if (result.cross_asset_themes.length > 0) {
      console.log(light);
      console.log(clr.cyan('  CROSS-ASSET THEMES'));
      console.log(light);
      br();
      for (const t of result.cross_asset_themes) {
        this.wrapText(t, W - 6).forEach((l, i) => console.log(`  ${i === 0 ? clr.cyan('[THEME]') : ' '}  ${l}`));
        br();
      }
    }

    if (result.high_impact_events.length > 0) {
      console.log(light);
      console.log(clr.yellow('  HIGH IMPACT EVENTS'));
      console.log(light);
      result.high_impact_events.forEach((e: any, idx: number) => {
        const assets = Array.isArray(e.affected_assets) ? e.affected_assets.join(' · ') : String(e.affected_assets ?? '');
        const dClr   = String(e.direction).toUpperCase().includes('BULL') ? clr.green : String(e.direction).toUpperCase().includes('BEAR') ? clr.red : clr.dim;
        const iClr   = String(e.impact_level).toUpperCase() === 'HIGH' ? clr.red : String(e.impact_level).toUpperCase() === 'MEDIUM' ? clr.yellow : clr.dim;
        br();
        console.log(`  ${clr.dim(String(idx + 1).padStart(2, '0'))}  ${clr.white(e.event ?? '')}`);
        console.log(`      ${clr.dim('assets')}  ${clr.cyan(assets)}   ${clr.dim('dir')}  ${dClr(e.direction ?? '?')}   ${clr.dim('impact')}  ${iClr(e.impact_level ?? '?')}`);
        if (e.time_horizon)  console.log(`      ${clr.dim('horizon')}  ${clr.dim(e.time_horizon)}`);
        if (e.reasoning)     this.wrapText(e.reasoning,    W - 8).forEach(l => console.log(`      ${clr.dim(l)}`));
        if (e.second_order)  this.wrapText(`2nd-order: ${e.second_order}`, W - 8).forEach(l => console.log(`      ${clr.dim(l)}`));
      });
      br();
    }

    if (result.opportunities.length > 0) {
      console.log(light);
      console.log(clr.white('  OPPORTUNITIES'));
      console.log(light);

      for (const [idx, o] of result.opportunities.entries()) {
        const action  = String(o.action ?? 'WATCH').toUpperCase() as 'BUY' | 'SELL' | 'WATCH';
        const aClr    = action === 'BUY' ? clr.green : action === 'SELL' ? clr.red : clr.yellow;
        const conf    = Number(o.confidence ?? 0);
        const confStr = conf >= 75 ? clr.green(conf + '%') : conf >= 50 ? clr.yellow(conf + '%') : clr.red(conf + '%');
        const spot    = (o as any).spot_price as number | undefined;

        const reasoning    = this.norm(String(o.reasoning    ?? ''), ['Reason', 'Reasoning']);
        const entry        = this.norm(String(o.entry_range  ?? ''), ['Entry',  'ENTRY']);
        const target       = this.norm(String(o.target_range ?? ''), ['Target', 'TARGET']);
        const stop         = this.norm(String(o.stop_loss    ?? ''), ['Stop',   'STOP']);
        const late         = this.norm(String(o.late_signal  ?? ''), ['Late',   'LATE']);
        const invalidation = this.norm(String(o.invalidation ?? ''), ['Invalidation']);
        const risks        = this.norm(String(o.risks        ?? ''), ['Risks',  'Risk']);

        br();
        const spotStr = spot != null
          ? clr.dim(`  spot $${spot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`)
          : '';
        console.log(`  ${clr.dim(String(idx + 1).padStart(2, '0'))}  [OPP] ${clr.white(o.asset ?? '?')} ${clr.dim('[' + (o.asset_type ?? '?') + ']')}  ${aClr(action)}  ${confStr}${spotStr}`);

        if (reasoning) this.wrapText(reasoning, W - 8).forEach(l => console.log(`      ${clr.dim(l)}`));

        const levels = [
          entry  ? `entry  ${entry}`  : '',
          target ? `target ${target}` : '',
          stop   ? `stop   ${stop}`   : '',
        ].filter(Boolean);
        if (levels.length > 0) console.log(`      ${clr.dim(levels.join('   '))}`);

        if (late) {
          const lClr = late.toUpperCase().startsWith('YES') ? clr.red : clr.green;
          console.log(`      ${clr.dim('[LATE]')}    ${lClr(late)}`);
        }
        if (invalidation) this.wrapText(`invalidates if: ${invalidation}`, W - 8).forEach(l => console.log(`      ${clr.dim(l)}`));
        if (risks)        this.wrapText(`risks: ${risks}`, W - 8).forEach(l => console.log(`      ${clr.dim(l)}`));
      }
      br();
    }

    if (result.contrarian_signals.length > 0) {
      console.log(light);
      console.log(clr.magenta('  CONTRARIAN SIGNALS'));
      console.log(light);
      br();
      for (const s of result.contrarian_signals) {
        this.wrapText(s, W - 6).forEach((l, i) => console.log(`  ${i === 0 ? clr.magenta('[CONTRARIAN]') : ' '}  ${l}`));
        br();
      }
    }

    if (result.ai_reasoning_chain) {
      console.log(light);
      console.log(clr.dim('  AI REASONING (first 600 chars)'));
      console.log(light);
      br();
      this.wrapText(result.ai_reasoning_chain.substring(0, 600), W - 4).forEach(l => console.log(`  ${clr.dim(l)}`));
      br();
    }

    if (result.risk_warnings.length > 0) {
      console.log(light);
      console.log(clr.red('  [RISK WARNINGS]'));
      console.log(light);
      br();
      for (const r of result.risk_warnings) {
        this.wrapText(r, W - 6).forEach((l, i) => console.log(`  ${i === 0 ? clr.red('[RISK]') : ' '}  ${clr.red(l)}`));
        br();
      }
    }

    if (result.recommended_actions.length > 0) {
      console.log(light);
      console.log(clr.green('  RECOMMENDED ACTIONS'));
      console.log(light);
      br();
      for (const a of result.recommended_actions) {
        this.wrapText(a, W - 6).forEach((l, i) => console.log(`  ${i === 0 ? clr.green('[ACTION]') : ' '}  ${l}`));
        br();
      }
    }

    console.log(heavy);
    br();
  }
}

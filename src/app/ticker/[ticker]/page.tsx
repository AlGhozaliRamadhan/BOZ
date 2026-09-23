'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TradingViewChart from '@/app/components/ui/TradingViewChart';
import TechnicalStrip from '@/app/components/ui/TechnicalStrip';
import { buildStocktwitsPulse, stocktwitsContrarianNote } from '@/shared/crowd-pulse';
import ExternalAiBriefButton from '@/app/components/ui/ExternalAiBriefButton';

interface QuoteData {
  ticker: string;
  name?: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  averageVolume: number | null;
  high: number;
  low: number;
  open: number;
  previousClose: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  marketState: string | null;
  quoteType: string | null;
  exchange: string | null;
  currency: string | null;
  trailingPE: number | null;
  regularMarketTime: string | number | Date | null;
}

interface MacroData {
  regime: string | null;
  vix: number | null;
  vixLevel: string | null;
  spyCorrelation: number | null;
  qqqCorrelation: number | null;
  spyBeta: number | null;
  qqqBeta: number | null;
  tenYearYield: number | null;
  riskSentiment: string | null;
}

interface SentimentData {
  fearGreedIndex: number | null;
  fearGreedLabel: string | null;
  stocktwits: {
    bullish: number;
    bearish: number;
    total: number;
    totalMessages?: number;
    watchlistCount?: number | null;
    sampleMessages?: { body: string; sentiment?: string | null; username?: string }[];
  };
  reddit: {
    buzzCount: number;
    sentiment: string;
    capped: boolean;
    topPosts?: string[];
  };
  overallSignals: string[];
  overallSignal: string;
}

interface AnalysisSignal {
  key: string;
  label: string;
  bias: string;
  weight: number;
  detail: string;
}

interface AnalysisData {
  assetClass: string;
  exchangeLabel: string;
  currency: string;
  bias: 'BULL' | 'BEAR' | 'NEUTRAL';
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;
  scoreLabel: string;
  signals: AnalysisSignal[];
  structure: {
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    rsi: number | null;
    atr: number | null;
    atrPercent: number | null;
    volumeRatio: number | null;
    smaStack: string;
    from52wHighPct: number | null;
    from52wLowPct: number | null;
    range52wPos: number | null;
    high52w: number | null;
    low52w: number | null;
  };
  plan: {
    action: string;
    status: string;
    setup: string;
    entry: number | null;
    entryLabel: string;
    stop: number | null;
    target1: number | null;
    target2: number | null;
    riskReward: number | null;
    atr: number | null;
    notes: string;
    extended: boolean;
  };
  insights: string[];
  patterns: string[];
  candleBias: string;
  support: number | null;
  resistance: number | null;
}

interface NewsData {
  headlines: string[];
  sentiment: string;
  hits: number;
}

/* ── Chart block (TradingView-native candles/lines handled here) ────────── */
type ChartStyle = '1' | '4' | '5';

const CHART_STYLE_KEY = 'boz_dashboard_chart_style';
const DEFAULT_STYLE: ChartStyle = '1';
const DASHBOARD_CHART_HEIGHT = 700;

const STYLE_LABELS: Record<ChartStyle, string> = {
  '1': 'CANDLES',
  '4': 'LINE',
  '5': 'AREA',
};

function getGaugeColor(value: number): string {
  if (value < 45) return '#d50000';
  if (value < 55) return '#ffffff';
  return '#00c853';
}

function getVixColor(level: string): string {
  switch (level?.toLowerCase()) {
    case 'low': return '#00c853';
    case 'moderate': return '#ffffff';
    case 'high': return '#d50000';
    case 'extreme': return '#d50000';
    default: return '#555555';
  }
}

export default function DashboardPage() {
  const params = useParams();
  const router = useRouter();
  
  const rawTicker = params?.ticker as string | undefined;
  const ticker = rawTicker ? decodeURIComponent(rawTicker).toUpperCase() : '';

  const [tickerInput, setTickerInput] = useState(ticker);
  
  // Autocomplete state
  const [searchResults, setSearchResults] = useState<{symbol: string, name: string, exchange: string}[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Chart style state (per-ticker, persisted to localStorage)
  const [chartStyle, setChartStyle] = useState<ChartStyle>(DEFAULT_STYLE);
  const [chartMenuOpen, setChartMenuOpen] = useState(false);

  // Watchlist / Favorites logic
  const [isFavorite, setIsFavorite] = useState(false);
  // Two-step removal: first click arms the confirm state so an accidental
  // tap on the star can't silently drop the ticker from the watchlist.
  const [confirmUnfavorite, setConfirmUnfavorite] = useState(false);

  // Sync tickerInput, chart style, and favorite status when ticker changes
  useEffect(() => {
    if (ticker) {
      setTickerInput(ticker);
      setChartStyle(loadChartStyle(ticker));
      setConfirmUnfavorite(false);

      try {
        const favs = JSON.parse(localStorage.getItem('boz_favorites') || '[]');
        setIsFavorite(favs.includes(ticker));
      } catch(e) {}
    }
  }, [ticker]);

  const addFavorite = () => {
    if (!ticker) return;
    try {
      const favs: string[] = JSON.parse(localStorage.getItem('boz_favorites') || '[]');
      if (!favs.includes(ticker)) {
        const newFavs = [...favs, ticker];
        localStorage.setItem('boz_favorites', JSON.stringify(newFavs));
        window.dispatchEvent(new Event('boz_favorites_changed'));
      }
      setIsFavorite(true);
    } catch(e) {}
  };

  const removeFavorite = () => {
    if (!ticker) return;
    try {
      const favs: string[] = JSON.parse(localStorage.getItem('boz_favorites') || '[]');
      const newFavs = favs.filter((t: string) => t !== ticker);
      localStorage.setItem('boz_favorites', JSON.stringify(newFavs));
      window.dispatchEvent(new Event('boz_favorites_changed'));
      setIsFavorite(false);
      setConfirmUnfavorite(false);
    } catch(e) {}
  };

  const toggleFavorite = () => {
    if (!ticker) return;
    if (isFavorite && !confirmUnfavorite) {
      // Arm an explicit "Remove?" confirm instead of unfavoriting on one tap.
      setConfirmUnfavorite(true);
      return;
    }
    if (isFavorite) {
      removeFavorite();
    } else {
      addFavorite();
    }
  };

  // Auto-disarm the remove confirm if the user hesitates — it should never
  // sit armed long enough to surprise them on a later accidental click.
  useEffect(() => {
    if (!confirmUnfavorite) return;
    const timer = setTimeout(() => setConfirmUnfavorite(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmUnfavorite, ticker]);

  /** Load saved chart style for a ticker, falling back to defaults. */
  function loadChartStyle(t: string): ChartStyle {
    try {
      const stored = localStorage.getItem(CHART_STYLE_KEY);
      if (stored) {
        const map = JSON.parse(stored);
        const saved = map?.[t];
        if (saved === '4' || saved === '5') return saved;
      }
    } catch (e) {
      // Corrupt storage — fall through to defaults
    }
    return DEFAULT_STYLE;
  }

  /** Persist chart style for the current ticker (write-through on change). */
  useEffect(() => {
    if (!ticker) return;
    try {
      const stored = localStorage.getItem(CHART_STYLE_KEY);
      const map = stored ? JSON.parse(stored) : {};
      map[ticker] = chartStyle;
      localStorage.setItem(CHART_STYLE_KEY, JSON.stringify(map));
    } catch (e) {
      // localStorage unavailable — prefs just won't persist
    }
  }, [ticker, chartStyle]);

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [macro, setMacro] = useState<MacroData | null>(null);
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [news, setNews] = useState<NewsData | null>(null);
  const [briefingData, setBriefingData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<Date | null>(null);

  const fetchData = useCallback(async (t: string, background = false) => {
    if (!t) {
      setLoading(false);
      return;
    }
    if (!background) {
      setLoading(true);
      setError(null);
      setBriefingData(null);
    }
    try {
      const res = await fetch(`/api/market/analysis?ticker=${encodeURIComponent(t)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to analyze ${t}`);
      }
      const payload = await res.json();
      const rawQuote = payload.quote || {};
      const rawMacro = payload.macro || {};
      const rawSentiment = payload.sentiment || {};

      const quoteData: QuoteData = {
        ticker: rawQuote.symbol || t,
        name: rawQuote.name || rawQuote.symbol || t,
        price: rawQuote.price ?? 0,
        change: rawQuote.change ?? 0,
        changePercent: rawQuote.changePercent ?? 0,
        volume: rawQuote.volume ?? 0,
        averageVolume: rawQuote.averageVolume ?? null,
        high: rawQuote.dayHigh ?? 0,
        low: rawQuote.dayLow ?? 0,
        open: rawQuote.open ?? 0,
        previousClose: rawQuote.previousClose ?? null,
        marketCap: rawQuote.marketCap ?? null,
        fiftyTwoWeekHigh: rawQuote.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: rawQuote.fiftyTwoWeekLow ?? null,
        marketState: rawQuote.marketState ?? null,
        quoteType: rawQuote.quoteType ?? null,
        exchange: rawQuote.exchange ?? null,
        currency: rawQuote.currency ?? null,
        trailingPE: rawQuote.trailingPE ?? null,
        regularMarketTime: rawQuote.regularMarketTime ?? null,
      };

      let vixLevelStr: string | null = null;
      if (typeof rawMacro.vix_level === 'number') {
        if (rawMacro.vix_level < 15) vixLevelStr = 'Low';
        else if (rawMacro.vix_level < 20) vixLevelStr = 'Moderate';
        else if (rawMacro.vix_level < 30) vixLevelStr = 'High';
        else vixLevelStr = 'Extreme';
      }

      const macroData: MacroData = {
        regime: rawMacro.market_regime && rawMacro.market_regime !== 'UNKNOWN' ? rawMacro.market_regime : null,
        vix: typeof rawMacro.vix_level === 'number' ? rawMacro.vix_level : null,
        vixLevel: vixLevelStr,
        spyCorrelation: typeof rawMacro.sp500_corr === 'number' ? rawMacro.sp500_corr : null,
        qqqCorrelation: typeof rawMacro.nasdaq_corr === 'number' ? rawMacro.nasdaq_corr : null,
        spyBeta: typeof rawMacro.sp500_beta === 'number' ? rawMacro.sp500_beta : null,
        qqqBeta: typeof rawMacro.nasdaq_beta === 'number' ? rawMacro.nasdaq_beta : null,
        tenYearYield: typeof rawMacro.tnx_yield === 'number' ? rawMacro.tnx_yield : null,
        riskSentiment: rawMacro.risk_sentiment || null,
      };

      const redditBuzz = rawSentiment.social_buzz?.find((b: any) => b.source === 'Reddit');
      const signals: string[] = rawSentiment.summary?.overall_signals || [];

      const sentimentData: SentimentData = {
        fearGreedIndex: typeof rawSentiment.fear_greed?.value === 'number' ? rawSentiment.fear_greed.value : null,
        fearGreedLabel: rawSentiment.fear_greed?.label || null,
        stocktwits: {
          bullish: rawSentiment.stocktwits_data?.bullish || 0,
          bearish: rawSentiment.stocktwits_data?.bearish || 0,
          total: rawSentiment.stocktwits_data?.total_with_sentiment || 0,
          totalMessages: rawSentiment.stocktwits_data?.total_messages || 0,
          watchlistCount: rawSentiment.stocktwits_data?.watchlist_count || null,
          sampleMessages: rawSentiment.stocktwits_data?.sample_messages || [],
        },
        reddit: {
          buzzCount: redditBuzz?.mentions || 0,
          sentiment: payload.news?.sentiment || 'Neutral',
          capped: !!redditBuzz?.capped,
          topPosts: redditBuzz?.top_posts || [],
        },
        overallSignals: signals,
        overallSignal: signals[0] || 'NEUTRAL',
      };

      setQuote(quoteData);
      setMacro(macroData);
      setSentiment(sentimentData);
      setAnalysis(payload.analysis || null);
      setNews(payload.news || null);
      setBriefingData(payload);
      setAsOf(payload.timestamp ? new Date(payload.timestamp) : new Date());
    } catch (err) {
      if (!background) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } else {
        console.warn('Background fetch failed:', err);
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {

    fetchData(ticker);
    const intervalId = setInterval(() => {
      // Prevent API overload: only fetch if the user is actually looking at the page
      if (document.visibilityState === 'visible') {
        fetchData(ticker, true);
      }
    }, 30000); // Increased polling interval to 30s to reduce backend load
    return () => clearInterval(intervalId);
  }, [ticker, fetchData]);

  // Audited crowd pulse � one shared read for bull/bear split, sample depth, and contrarian note.
  const pulse = useMemo(() => buildStocktwitsPulse(sentiment?.stocktwits ? {
    bullish: sentiment.stocktwits.bullish,
    bearish: sentiment.stocktwits.bearish,
    total_with_sentiment: sentiment.stocktwits.total,
    total_messages: sentiment.stocktwits.totalMessages ?? null,
  } : null), [sentiment]);
  const contrarianNote = useMemo(() => stocktwitsContrarianNote(pulse), [pulse]);


  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (tickerInput.trim() && showDropdown) {
        setIsSearching(true);
        try {
          const res = await fetch(`/api/market/search?q=${encodeURIComponent(tickerInput.trim())}`);
          if (res.ok) {
            const data = await res.json();
            setSearchResults(data.slice(0, 6)); // Top 6 results
          }
        } catch (err) {
          console.error('Search failed', err);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [tickerInput, showDropdown, ticker]);

  const handleTickerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tickerInput.trim()) {
      let newTicker = tickerInput.trim().toUpperCase();
      if (showDropdown && searchResults.length > 0) {
        newTicker = searchResults[0].symbol.toUpperCase();
        setTickerInput(newTicker);
      }
      setShowDropdown(false);
      router.push(`/ticker/${encodeURIComponent(newTicker)}`);
    }
  };

  const formatNum = (num: number | null | undefined) => {
    if (num == null || !Number.isFinite(num)) return '—';
    const a = Math.abs(num);
    if (a >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
  };

  const formatPx = (num: number | null | undefined) => {
    if (num == null || !Number.isFinite(num)) return '—';
    const a = Math.abs(num);
    if (a >= 1000) return num.toFixed(2);
    if (a >= 1) return num.toFixed(2);
    if (a >= 0.01) return num.toFixed(4);
    return num.toFixed(6);
  };

  const formatClock = (d: Date | null) => {
    if (!d) return '—';
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  };

  const marketStateMeta = (state?: string | null) => {
    switch ((state || '').toUpperCase()) {
      case 'REGULAR': return { label: 'REGULAR SESSION', live: true };
      case 'PRE':
      case 'PREPRE': return { label: 'PRE-MARKET', live: false };
      case 'POST':
      case 'POSTPOST': return { label: 'AFTER-HOURS', live: false };
      case 'CLOSED': return { label: 'CLOSED', live: false };
      default: return { label: state ? state.toUpperCase() : 'UNKNOWN', live: false };
    }
  };

  const getPnlColor = (val: number) => val >= 0 ? 'var(--success)' : 'var(--danger)';
  const biasColor = (bias?: string) => {
    if (!bias) return '#888888';
    const b = bias.toUpperCase();
    if (b.includes('BULL') || b.includes('GREED') || b.includes('POSITIVE') || b.includes('BUY') || b.includes('UP')) return '#00c853';
    if (b.includes('BEAR') || b.includes('FEAR') || b.includes('NEGATIVE') || b.includes('SELL') || b.includes('DOWN')) return '#d50000';
    return '#888888';
  };
  const dash = '—';


  return (
    <div className="bbg-page" style={{ padding: '0', background: 'transparent' }}>
      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <header className="bbg-header ticker-page-header">
        <div>
          <h1 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-violet)', fontSize: '14px', fontWeight: 700, margin: 0, letterSpacing: '0.05em' }}>INTELLIGENCE DASHBOARD</h1>
          <p style={{ fontFamily: 'var(--font-mono)', color: '#555', fontSize: '10px', marginTop: '2px', textTransform: 'uppercase' }}>REAL-TIME MARKET OVERVIEW</p>
        </div>
        <div className="ticker-toolbar">
          <div className="ticker-search">
          <form onSubmit={handleTickerSubmit} className="ticker-search__form" role="search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input
              type="text"
              aria-label="Search ticker or asset"
              placeholder="Search ticker or asset"
              value={tickerInput}
              onChange={(e) => {
                setTickerInput(e.target.value);
                setShowDropdown(e.target.value.trim().toUpperCase() !== ticker.toUpperCase());
              }}
              onFocus={() => {
                if (tickerInput.trim().toUpperCase() !== ticker.toUpperCase()) setShowDropdown(true);
              }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              className="ticker-search__input"
            />
            <button type="submit" className="ticker-search__submit">GO <span aria-hidden="true">↗</span></button>
          </form>

          {showDropdown && (tickerInput.trim() !== '') && (
            <div className="ticker-search__results">
              {isSearching ? (
                <div className="ticker-search__message">SEARCHING...</div>
              ) : searchResults.length > 0 ? (
                searchResults.map((result, i) => (
                  <button
                    type="button"
                    key={result.symbol + i}
                    className="ticker-search__result"
                    onClick={() => {
                      const newTicker = result.symbol.toUpperCase();
                      setTickerInput(newTicker);
                      setShowDropdown(false);
                      router.push(`/ticker/${encodeURIComponent(newTicker)}`);
                    }}
                  >
                    <span className="ticker-search__symbol">{result.symbol}</span>
                    <span className="ticker-search__name">{result.name}</span>
                    <span className="ticker-search__exchange">{result.exchange}</span>
                  </button>
                ))
              ) : (
                <div className="ticker-search__message">NO RESULTS</div>
              )}
            </div>
          )}
          </div>
          <ExternalAiBriefButton
            ticker={quote?.ticker || ticker}
            source="BOZ ticker intelligence dashboard"
            data={briefingData}
            dataTimestamp={asOf?.toISOString()}
            disabled={!briefingData}
          />
        </div>
      </header>

      {!ticker ? (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <h2 style={{ fontSize: '18px', color: '#fff', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>[ SEARCH ASSET ]</h2>
          <p style={{ color: '#888', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>{'>'} TYPE A STOCK SYMBOL, CRYPTO, OR INDEX TO GENERATE A REAL-TIME INTELLIGENCE DASHBOARD.</p>
        </div>
      ) : loading ? (
        <div className="loading-overlay" style={{ padding: '120px 0' }}>
          <div className="spinner spinner-lg" style={{ marginBottom: 'var(--space-4)' }}></div>
          <p style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
            Loading {ticker}…
          </p>
          <p className="page-subtitle" style={{ margin: 0 }}>
            Fetching quotes, macro, and sentiment data
          </p>
        </div>
      ) : error ? (
        <div style={{ padding: '20px', border: '1px solid #d50000', color: '#d50000', marginTop: '20px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
          <strong>[ ERROR ]</strong> {error}
        </div>
      ) : (
        <div className="bbg-dashboard ticker-dashboard animate-fadeIn" style={{ fontFamily: 'var(--font-mono)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

          <section className="ticker-overview" aria-label={`${ticker} quote overview`}>
            <div className="ticker-overview__main">
              <div className="ticker-overview__identity">
                <div className="ticker-overview__symbol-line">
                  <h2>{quote?.ticker}</h2>
                  <button
                    type="button"
                    onClick={toggleFavorite}
                    className={`favorite-toggle${isFavorite ? ' is-saved' : ''}${confirmUnfavorite ? ' is-confirming' : ''}`}
                    title={confirmUnfavorite ? 'Click again to remove from watchlist' : isFavorite ? 'Remove from watchlist' : 'Add to watchlist'}
                    aria-label={confirmUnfavorite ? `Confirm remove ${quote?.ticker} from watchlist` : isFavorite ? `Remove ${quote?.ticker} from watchlist` : `Add ${quote?.ticker} to watchlist`}
                    aria-pressed={isFavorite}
                  >
                    <i className={`${isFavorite ? 'fa-solid' : 'fa-regular'} fa-star`} aria-hidden="true"></i>
                  </button>
                  <span className="ticker-overview__asset">{analysis?.assetClass || quote?.quoteType || 'ASSET'}</span>
                </div>
                <p>{quote?.name}{quote?.exchange ? ` · ${quote.exchange}` : ''}</p>
                <span className="ticker-overview__session">
                  <i className={marketStateMeta(quote?.marketState).live ? 'is-live' : ''} aria-hidden="true" />
                  {marketStateMeta(quote?.marketState).label} · {formatClock(asOf)}
                </span>
              </div>
              <div className="ticker-overview__price">
                <span className="ticker-overview__label">LAST PRICE</span>
                <strong>{quote?.currency && quote.currency !== 'USD' ? `${quote.currency} ` : '$'}{formatPx(quote?.price)}</strong>
                <span className="ticker-overview__change" style={{ color: getPnlColor(quote?.change ?? 0) }}>
                  {(quote?.change ?? 0) >= 0 ? '+' : ''}{formatPx(quote?.change)}
                  <span>({(quote?.changePercent ?? 0) >= 0 ? '+' : ''}{quote?.changePercent?.toFixed(2)}%)</span>
                </span>
              </div>
            </div>

            <dl className="ticker-overview__stats">
              <div><dt>VOLUME</dt><dd>{formatNum(quote?.volume)}</dd></div>
              <div><dt>DAY RANGE</dt><dd>{formatPx(quote?.low)} <span>–</span> {formatPx(quote?.high)}</dd></div>
              <div><dt>52W RANGE</dt><dd>{formatPx(quote?.fiftyTwoWeekLow)} <span>–</span> {formatPx(quote?.fiftyTwoWeekHigh)}</dd></div>
              <div><dt>MARKET CAP</dt><dd>{formatNum(quote?.marketCap)}</dd></div>
            </dl>
          </section>

          <section className="ticker-market" aria-label="Market context">
            <div className="ticker-market__item">
              <span>VIX</span><strong style={{ color: getVixColor(macro?.vixLevel || '') }}>{macro?.vix != null ? macro.vix.toFixed(2) : dash}</strong>
              <small>{macro?.vixLevel?.toUpperCase() || 'UNAVAILABLE'}</small>
            </div>
            <div className="ticker-market__item">
              <span>FEAR & GREED</span><strong style={{ color: sentiment?.fearGreedIndex == null ? '#888' : (sentiment.fearGreedIndex > 60 ? '#00c853' : sentiment.fearGreedIndex < 40 ? '#d50000' : '#fff') }}>{sentiment?.fearGreedIndex ?? dash}</strong>
              <small>{sentiment?.fearGreedLabel?.toUpperCase() || 'MARKET-WIDE'}</small>
            </div>
            <div className="ticker-market__item">
              <span>REGIME</span><strong style={{ color: biasColor(macro?.regime || '') }}>{macro?.regime || dash}</strong>
              <small>{macro?.riskSentiment || 'SPY REGIME'}</small>
            </div>
            <details className="ticker-market__details">
              <summary>MORE CONTEXT</summary>
              <div className="ticker-market__extra">
                <div><span>10Y YIELD</span><strong>{macro?.tenYearYield != null ? `${macro.tenYearYield.toFixed(2)}%` : dash}</strong></div>
                <div><span>SPY CORR</span><strong>{macro?.spyCorrelation != null ? macro.spyCorrelation.toFixed(3) : dash}</strong><small>{macro?.spyBeta != null ? `β ${macro.spyBeta.toFixed(2)} · 60D` : '60D ROLLING'}</small></div>
                <div><span>QQQ CORR</span><strong>{macro?.qqqCorrelation != null ? macro.qqqCorrelation.toFixed(3) : dash}</strong><small>{macro?.qqqBeta != null ? `β ${macro.qqqBeta.toFixed(2)} · 60D` : '60D ROLLING'}</small></div>
              </div>
            </details>
          </section>

          {/* ── LOWER SECTION: chart and intelligence blocks share the page surface ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* 1. Chart Section */}
            <div style={{ background: 'transparent', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {/* Chart Header */}
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#00c853', fontSize: '8px' }}>●</span>
                  <span style={{ color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em' }}>MARKET ANALYSIS</span>
                  <span style={{ color: '#444', fontSize: '10px' }}>•</span>
                  <span style={{ color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em' }}>{quote?.ticker}</span>
                  {quote?.exchange && (
                    <span style={{ color: '#555', fontSize: '9px', fontWeight: 600 }}>({quote.exchange})</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ color: '#555', fontSize: '9px', letterSpacing: '0.05em' }}>TRADINGVIEW INTERACTIVE</span>
                </div>
              </div>

              {/* Chart Container */}
              <div style={{ height: `${DASHBOARD_CHART_HEIGHT}px`, position: 'relative' }}>
                <TradingViewChart symbol={quote?.ticker || 'AAPL'} style={chartStyle} height={DASHBOARD_CHART_HEIGHT} />
              </div>
            </div>

            {/* 2. Technical Indicators Board (Full Width Strip) */}
            <TechnicalStrip ticker={quote?.ticker || 'AAPL'} />

            {/* Verdict, plan, and signals share a simple editorial grid. */}
            <div className="ticker-intel ticker-intel--three">
              {/* Card 1: Ticker Verdict & Structure */}
              <section className="ticker-intel__section" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{quote?.ticker} VERDICT</span>
                    <span style={{ 
                      color: biasColor(analysis?.bias), 
                      fontSize: '9px', 
                      padding: '2px 6px', 
                      border: `1px solid ${biasColor(analysis?.bias)}`,
                      letterSpacing: '0.05em'
                    }}>
                      {analysis?.scoreLabel || 'CALCULATING'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                    <span style={{ color: biasColor(analysis?.bias), fontSize: '24px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {analysis ? `${analysis.score >= 0 ? '+' : ''}${analysis.score}` : dash}
                    </span>
                    <span style={{ color: '#888', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em' }}>
                      {analysis?.bias || 'NEUTRAL'} · {analysis?.conviction || 'LOW'} CONVICTION
                    </span>
                  </div>
                  <div style={{ color: '#888', fontSize: '11px', lineHeight: 1.6, marginBottom: '16px' }}>
                    {analysis?.insights?.[0] || `${quote?.name || quote?.ticker} analysis is still loading.`}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--border-glass)' }}>
                  <div>
                    <div style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em' }}>52W HIGH</div>
                    <div style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{formatPx(analysis?.structure.high52w ?? quote?.fiftyTwoWeekHigh)}</div>
                    <div style={{ color: '#555', fontSize: '9px' }}>{analysis?.structure.from52wHighPct != null ? `${analysis.structure.from52wHighPct.toFixed(1)}%` : dash}</div>
                  </div>
                  <div>
                    <div style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em' }}>52W LOW</div>
                    <div style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{formatPx(analysis?.structure.low52w ?? quote?.fiftyTwoWeekLow)}</div>
                    <div style={{ color: '#555', fontSize: '9px' }}>{analysis?.structure.from52wLowPct != null ? `+${analysis.structure.from52wLowPct.toFixed(1)}%` : dash}</div>
                  </div>
                  <div>
                    <div style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em' }}>MKT CAP</div>
                    <div style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{formatNum(quote?.marketCap)}</div>
                  </div>
                  <div>
                    <div style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em' }}>AVG VOL</div>
                    <div style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{formatNum(quote?.averageVolume)}</div>
                  </div>
                </div>
              </section>

              {/* Card 2: Trading Plan */}
              <section className="ticker-intel__section" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>TRADING PLAN</span>
                    <span style={{ 
                      color: analysis?.plan.status === 'SETUP' ? '#00c853' : '#888',
                      fontSize: '9px',
                      padding: '2px 6px',
                      border: `1px solid ${analysis?.plan.status === 'SETUP' ? '#00c853' : '#333'}`,
                      letterSpacing: '0.05em'
                    }}>
                      {analysis?.plan.status || 'WATCH'}
                    </span>
                  </div>
                  <div style={{ color: '#888', fontSize: '10px', marginBottom: '12px', lineHeight: 1.5 }}>
                    {analysis?.plan.setup || 'Waiting for a defined setup.'}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid var(--border-glass)' }}>
                      <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>ACTION</span>
                      <span style={{ fontSize: '12px', color: biasColor(analysis?.plan.action === 'BUY' ? 'BULL' : analysis?.plan.action === 'SELL' ? 'BEAR' : 'NEUTRAL'), fontWeight: 700 }}>
                        {analysis?.plan.action || 'WATCH'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid var(--border-glass)' }}>
                      <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>ENTRY</span>
                      <span style={{ fontSize: '12px', color: '#fff', fontWeight: 700 }}>{analysis?.plan.entryLabel || dash}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid var(--border-glass)' }}>
                      <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>STOP LOSS</span>
                      <span style={{ fontSize: '12px', color: '#d50000', fontWeight: 700 }}>{formatPx(analysis?.plan.stop)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid var(--border-glass)' }}>
                      <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>TARGET 1</span>
                      <span style={{ fontSize: '12px', color: '#00c853', fontWeight: 700 }}>{formatPx(analysis?.plan.target1)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid var(--border-glass)' }}>
                      <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>TARGET 2</span>
                      <span style={{ fontSize: '12px', color: '#00c853', fontWeight: 700 }}>{formatPx(analysis?.plan.target2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>R/R TO T1</span>
                      <span style={{ fontSize: '12px', color: '#fff', fontWeight: 700 }}>
                        {analysis?.plan.riskReward != null ? `${analysis.plan.riskReward.toFixed(2)}R` : dash}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '12px', color: '#555', fontSize: '9px', lineHeight: 1.4, borderTop: '1px solid var(--border-glass)', paddingTop: '8px' }}>
                  {analysis?.plan.notes || 'Levels are derived from ATR and nearby structure.'}
                </div>
              </section>

              {/* Card 3: Confluence Signals */}
              <section className="ticker-intel__section">
                <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>CONFLUENCE SIGNALS</span>
                  <span style={{ color: '#555', fontSize: '9px', letterSpacing: '0.05em' }}>
                    {analysis?.signals?.length || 0} FACTORS
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                  {(analysis?.signals || []).slice(0, 8).map(sig => (
                    <div key={sig.key} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', paddingBottom: '6px', borderBottom: '1px solid var(--border-glass)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: '#fff', fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em' }}>{sig.label}</div>
                        <div style={{ color: '#888', fontSize: '10px', lineHeight: 1.4, marginTop: '2px' }}>{sig.detail}</div>
                      </div>
                      <span style={{ 
                        color: biasColor(sig.bias), 
                        fontSize: '9px', 
                        fontWeight: 700, 
                        whiteSpace: 'nowrap',
                        padding: '1px 5px',
                        border: `1px solid ${biasColor(sig.bias)}`,
                        flexShrink: 0
                      }}>
                        {sig.bias}
                      </span>
                    </div>
                  ))}
                  {(!analysis?.signals || analysis.signals.length === 0) && (
                    <div style={{ color: '#555', fontSize: '11px' }}>No confluence signals yet.</div>
                  )}
                </div>
              </section>
            </div>

            {/* Crowd and catalysts */}
            <div className="ticker-intel ticker-intel--two">
              {/* Card 4: Social Sentiment */}
              <section className="ticker-intel__section" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  {/* Card Header */}
                  <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>CROWD & SOCIAL SENTIMENT</span>
                    <span style={{ 
                      color: biasColor(sentiment?.overallSignal), 
                      fontSize: '9px', 
                      padding: '2px 6px', 
                      border: `1px solid ${biasColor(sentiment?.overallSignal)}`,
                      letterSpacing: '0.05em' 
                    }}>
                      {sentiment?.overallSignal?.replace('_', ' ') ?? 'NEUTRAL'}
                    </span>
                  </div>

                  {/* ── 1. Stocktwits Section ────────────────────── */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '10px', color: '#888', fontWeight: 700, letterSpacing: '0.05em' }}>STOCKTWITS PULSE</span>
                      <span style={{ fontSize: '9px', color: '#555', fontWeight: 700 }}>
                        {sentiment?.stocktwits?.watchlistCount ? `${formatNum(sentiment.stocktwits.watchlistCount)} WATCHERS · ` : ''}
                        {pulse.totalMessages != null
                          ? `${pulse.totalMessages} POSTS · ${pulse.labelled} LABELED`
                          : pulse.labelled > 0
                            ? `${pulse.labelled} LABELED`
                            : 'LIVE STREAM'}
                        {pulse.confidence !== 'EMPTY' ? ` · ${pulse.confidence}` : ''}
                      </span>
                    </div>

                    {/* Green (Bull) + Red (Bear) Progress Bar */}
                    <div style={{ height: '7px', display: 'flex', marginBottom: '8px', background: 'var(--border-glass)', borderRadius: '1px', overflow: 'hidden' }}>
                      {pulse.labelled > 0 ? (
                        <>
                          <div 
                            style={{ 
                              width: `${pulse.bullRatio ?? 0}%`,
                              background: '#00c853',
                              transition: 'width 0.3s ease'
                            }} 
                            title={`Bullish: ${pulse.bullRatio != null ? Math.round(pulse.bullRatio) : 0}% (${pulse.bullish}/${pulse.labelled} labelled)`}
                          />
                          <div 
                            style={{ 
                              width: `${pulse.bearRatio ?? 0}%`,
                              background: '#d50000',
                              transition: 'width 0.3s ease'
                            }} 
                            title={`Bearish: ${pulse.bearRatio != null ? Math.round(pulse.bearRatio) : 0}% (${pulse.bearish}/${pulse.labelled} labelled)`}
                          />
                        </>
                      ) : (
                        <div style={{ width: '100%', background: '#222' }} />
                      )}
                    </div>

                    {/* Bull / Bear Readouts with Colored Dots and Percentages */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 700 }}>
                      <span style={{ color: '#00c853', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '6px', height: '6px', background: '#00c853', borderRadius: '50%', display: 'inline-block' }} />
                        {pulse.bullish} BULL {pulse.bullRatio != null ? `(${Math.round(pulse.bullRatio)}%)` : ''}
                      </span>
                      <span style={{ color: '#d50000', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {pulse.bearRatio != null ? `(${Math.round(pulse.bearRatio)}%)` : ''} {pulse.bearish} BEAR
                        <span style={{ width: '6px', height: '6px', background: '#d50000', borderRadius: '50%', display: 'inline-block' }} />
                      </span>
                    </div>

                    {/* Audited read: sample depth + contrarian note */}
                    <div style={{ marginTop: '6px', fontSize: '9px', color: '#888', lineHeight: 1.5 }}>
                      <div title={pulse.confidenceNote}>
                        {pulse.labelled > 0
                          ? `${pulse.labelled} LABELLED OF ${pulse.totalMessages ?? pulse.labelled} SAMPLED`
                          : 'NO LABELLED MESSAGES'}
                        {pulse.neutralShare != null && pulse.totalMessages != null && pulse.totalMessages > 0
                          ? ` · ${Math.round(pulse.neutralShare)}% UNLABELLED`
                          : ''}
                      </div>
                      <div style={{ color: '#aaa' }}>{contrarianNote}</div>
                    </div>

                    {/* Concrete StockTwits Message Snippet */}
                    {sentiment?.stocktwits?.sampleMessages && sentiment.stocktwits.sampleMessages.length > 0 && (
                      <div style={{ marginTop: '8px', padding: '6px 10px', background: 'var(--bg-tertiary)', borderLeft: '2px solid var(--border-glass-hover)', fontSize: '9px', color: '#aaa', lineHeight: 1.35 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: '8px', fontWeight: 700, marginBottom: '2px' }}>
                          <span>@{sentiment.stocktwits.sampleMessages[0].username || 'trader'}</span>
                          <span style={{ color: biasColor(sentiment.stocktwits.sampleMessages[0].sentiment || '') }}>
                            {sentiment.stocktwits.sampleMessages[0].sentiment ? sentiment.stocktwits.sampleMessages[0].sentiment.toUpperCase() : 'COMMUNITY'}
                          </span>
                        </div>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          &ldquo;{sentiment.stocktwits.sampleMessages[0].body}&rdquo;
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── 2. Reddit Community Discussions ────────────── */}
                  <div style={{ marginBottom: '14px', paddingTop: '10px', borderTop: '1px solid var(--border-glass)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '10px', color: '#888', fontWeight: 700, letterSpacing: '0.05em' }}>REDDIT DISCUSSIONS</span>
                      <span style={{ fontSize: '9px', color: sentiment?.reddit?.buzzCount && sentiment.reddit.buzzCount >= 50 ? '#00c853' : '#888', fontWeight: 700 }}>
                        {sentiment?.reddit?.buzzCount ? `${sentiment.reddit.buzzCount}${sentiment.reddit.capped ? '+' : ''} THREADS` : 'TRACKING'}
                        {sentiment?.reddit?.buzzCount && sentiment.reddit.buzzCount >= 50 ? ' · HIGH BUZZ' : ''}
                      </span>
                    </div>

                    {sentiment?.reddit?.topPosts && sentiment.reddit.topPosts.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {sentiment.reddit.topPosts.slice(0, 2).map((post, idx) => (
                          <div key={idx} style={{ color: '#aaa', fontSize: '9.5px', lineHeight: 1.35, display: 'flex', gap: '6px' }}>
                            <span style={{ color: '#555', flexShrink: 0 }}>›</span>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{post}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#555', fontSize: '9px', lineHeight: 1.4 }}>
                        {sentiment?.reddit?.buzzCount ? `${sentiment.reddit.buzzCount} active discussions tracked across market subreddits.` : 'Scanning retail discussion boards.'}
                      </div>
                    )}
                  </div>

                  {/* ── 3. News Tone ─────────────────────────────── */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--border-glass)' }}>
                    <span style={{ fontSize: '10px', color: '#888', fontWeight: 700, letterSpacing: '0.05em' }}>NEWS SENTIMENT</span>
                    <span style={{
                      fontSize: '10px', fontWeight: 700, padding: '2px 8px', border: '1px solid currentColor',
                      color: biasColor(news?.sentiment)
                    }}>
                      {news?.sentiment ? `${news.sentiment.toUpperCase()}${news.hits ? ` (${news.hits} HITS)` : ''}` : 'NEUTRAL'}
                    </span>
                  </div>
                </div>

                {/* Fear & Greed Context Footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid var(--border-glass)', marginTop: '12px' }}>
                  <span style={{ fontSize: '9px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>FEAR & GREED INDEX</span>
                  <span style={{ fontSize: '10px', color: biasColor(sentiment?.fearGreedLabel || ''), fontWeight: 700 }}>
                    {sentiment?.fearGreedIndex != null ? `${sentiment.fearGreedIndex} · ${sentiment?.fearGreedLabel?.toUpperCase() || ''}` : dash}
                  </span>
                </div>
              </section>

              {/* Card 5: What Ticker Is Doing & News Catalysts */}
              <section className="ticker-intel__section">
                <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '14px' }}>
                  WHAT {quote?.ticker} IS DOING & CATALYSTS
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {(analysis?.insights || []).slice(1).map((line, i) => (
                    <div key={i} style={{ color: '#aaa', fontSize: '11px', lineHeight: 1.55, display: 'flex', gap: '8px' }}>
                      <span style={{ color: '#555' }}>›</span>
                      <span>{line}</span>
                    </div>
                  ))}
                  {news?.headlines?.filter(h => h && !h.startsWith('No significant')).slice(0, 3).map((h, i) => (
                    <div key={`n-${i}`} style={{ color: '#888', fontSize: '11px', lineHeight: 1.45, padding: '4px 0', borderTop: '1px solid var(--border-glass)' }}>
                      <span style={{ color: '#00c853', fontWeight: 700, marginRight: '6px', fontSize: '9px', border: '1px solid #00c853', padding: '1px 4px' }}>NEWS</span>
                      {h}
                    </div>
                  ))}
                </div>
              </section>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

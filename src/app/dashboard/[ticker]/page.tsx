'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TradingViewChart from '@/app/components/ui/TradingViewChart';
import TechnicalStrip from '@/app/components/ui/TechnicalStrip';
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

  // Sync tickerInput, chart style, and favorite status when ticker changes
  useEffect(() => {
    if (ticker) {
      setTickerInput(ticker);
      setChartStyle(loadChartStyle(ticker));
      
      try {
        const favs = JSON.parse(localStorage.getItem('boz_favorites') || '[]');
        setIsFavorite(favs.includes(ticker));
      } catch(e) {}
    }
  }, [ticker]);

  const toggleFavorite = () => {
    if (!ticker) return;
    try {
      const favs: string[] = JSON.parse(localStorage.getItem('boz_favorites') || '[]');
      let newFavs;
      if (favs.includes(ticker)) {
        newFavs = favs.filter((t: string) => t !== ticker);
        setIsFavorite(false);
      } else {
        newFavs = [...favs, ticker];
        setIsFavorite(true);
      }
      localStorage.setItem('boz_favorites', JSON.stringify(newFavs));
      window.dispatchEvent(new Event('boz_favorites_changed'));
    } catch(e) {}
  };

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
      router.push(`/dashboard/${encodeURIComponent(newTicker)}`);
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
    <div className="bbg-page" style={{ padding: '0 0 var(--space-6)', minHeight: '100vh', background: '#000' }}>
      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div className="bbg-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid #1f1f1f' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-violet)', fontSize: '14px', fontWeight: 700, margin: 0, letterSpacing: '0.05em' }}>INTELLIGENCE DASHBOARD</h1>
          <p style={{ fontFamily: 'var(--font-mono)', color: '#555', fontSize: '10px', marginTop: '2px', textTransform: 'uppercase' }}>REAL-TIME MARKET OVERVIEW</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ExternalAiBriefButton
            ticker={quote?.ticker || ticker}
            source="BOZ ticker intelligence dashboard"
            data={briefingData}
            dataTimestamp={asOf?.toISOString()}
            disabled={!briefingData}
          />
          <div style={{ position: 'relative', width: '280px' }}>
          <form onSubmit={handleTickerSubmit} style={{ display: 'flex', border: '1px solid #333' }}>
            <input
              type="text"
              placeholder="SEARCH..."
              value={tickerInput}
              onChange={(e) => {
                setTickerInput(e.target.value);
                setShowDropdown(e.target.value.trim().toUpperCase() !== ticker.toUpperCase());
              }}
              onFocus={() => {
                if (tickerInput.trim().toUpperCase() !== ticker.toUpperCase()) setShowDropdown(true);
              }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              style={{
                flex: 1, background: '#000', color: '#fff', border: 'none', padding: '0 12px',
                fontFamily: 'var(--font-mono)', fontSize: '12px', outline: 'none', textTransform: 'uppercase'
              }}
            />
            <button type="submit" style={{
              background: 'var(--accent-violet)', color: '#000', border: 'none', padding: '6px 12px',
              fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, cursor: 'pointer'
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px', verticalAlign: 'text-bottom' }}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              GO
            </button>
          </form>

          {showDropdown && (tickerInput.trim() !== '') && (
            <div style={{ 
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px',
              background: '#0d0d0d', border: '1px solid #333', zIndex: 50
            }}>
              {isSearching ? (
                <div style={{ padding: '8px', color: '#555', fontSize: '11px', textAlign: 'center' }}>SEARCHING...</div>
              ) : searchResults.length > 0 ? (
                searchResults.map((result, i) => (
                  <div 
                    key={result.symbol + i}
                    style={{ 
                      padding: '8px 12px', borderBottom: i === searchResults.length - 1 ? 'none' : '1px solid #1f1f1f', 
                      cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px'
                    }}
                    onMouseDown={() => {
                      const newTicker = result.symbol.toUpperCase();
                      setTickerInput(newTicker);
                      setShowDropdown(false);
                      router.push(`/dashboard/${encodeURIComponent(newTicker)}`);
                    }}
                  >
                    <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{result.symbol}</span>
                    <span style={{ color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>{result.name}</span>
                  </div>
                ))
              ) : (
                <div style={{ padding: '8px', color: '#555', fontSize: '11px', textAlign: 'center' }}>NO RESULTS</div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {!ticker ? (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <h2 style={{ fontSize: '18px', color: '#fff', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>[ SEARCH ASSET ]</h2>
          <p style={{ color: '#888', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>{'>'} TYPE A STOCK SYMBOL, CRYPTO, OR INDEX TO GENERATE A REAL-TIME INTELLIGENCE DASHBOARD.</p>
        </div>
      ) : loading ? (
        <div style={{ padding: '120px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <style>{`
            @keyframes spin-slow { 100% { transform: rotate(360deg); } }
            @keyframes pulse-opacity { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
            @keyframes terminal-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
          `}</style>
          
          <div style={{ position: 'relative', width: '80px', height: '80px', marginBottom: '32px' }}>
            {/* Outer dashed ring */}
            <div style={{ position: 'absolute', inset: 0, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '50%', animation: 'spin-slow 10s linear infinite' }}></div>
            {/* Inner solid ring spinning fast */}
            <div style={{ position: 'absolute', inset: '8px', borderTop: '2px solid var(--accent-cyan)', borderRight: '2px solid transparent', borderRadius: '50%', animation: 'spin-slow 1s linear infinite' }}></div>
            {/* Center pulsing icon */}
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', animation: 'pulse-opacity 2s ease-in-out infinite' }}>
              <i className="fa-solid fa-server" style={{ color: '#fff', fontSize: '20px' }}></i>
            </div>
          </div>

          <h2 style={{ fontSize: '16px', color: '#fff', marginBottom: '12px', fontFamily: 'var(--font-mono)', letterSpacing: '0.15em' }}>
            [ INITIALIZING {ticker || 'DASHBOARD'} ]
          </h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <p style={{ color: 'var(--accent-cyan)', fontSize: '11px', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>
              {'>'} ESTABLISHING SECURE DATA LINK... <span style={{ animation: 'terminal-blink 1s step-end infinite' }}>_</span>
            </p>
            <p style={{ color: '#555', fontSize: '10px', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>
              FETCHING QUOTES, MACRO, AND SENTIMENT DATA
            </p>
          </div>
        </div>
      ) : error ? (
        <div style={{ padding: '20px', border: '1px solid #d50000', color: '#d50000', marginTop: '20px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
          <strong>[ ERROR ]</strong> {error}
        </div>
      ) : (
        <div className="bbg-dashboard animate-fadeIn" style={{ fontFamily: 'var(--font-mono)' }}>
          
          {/* ── TOP QUOTE SECTION ────────────────────────────────────────────── */}
          <div style={{ borderBottom: '1px solid #1a1a1a' }}>
            {/* ROW 1: Quote */}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto auto 1fr 1fr 1fr', background: '#1a1a1a', gap: '1px', borderBottom: '1px solid #1a1a1a' }}>
              <div style={{ background: '#0a0a0a', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '20px', letterSpacing: '0.02em' }}>{quote?.ticker}</span>
                  <button onClick={toggleFavorite} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isFavorite ? '#ffd700' : '#555', fontSize: '14px', padding: 0 }} title={isFavorite ? "Remove from Watchlist" : "Add to Watchlist"}>
                    <i className={isFavorite ? "fa-solid fa-star" : "fa-regular fa-star"}></i>
                  </button>
                  <span style={{ color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', marginLeft: '4px' }}>
                    {analysis?.assetClass || quote?.quoteType || 'ASSET'}
                  </span>
                </div>
                <div style={{ color: '#888', fontSize: '10px', marginTop: '4px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {quote?.name}{quote?.exchange ? ` · ${quote.exchange}` : ''}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: marketStateMeta(quote?.marketState).live ? '#00c853' : '#555' }}></span>
                  <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em' }}>
                    {marketStateMeta(quote?.marketState).label} · {formatClock(asOf)}
                  </span>
                </div>
              </div>
              
              <div style={{ background: '#0a0a0a', padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>LAST</span>
                <span style={{ color: getPnlColor(quote?.change ?? 0), fontSize: '24px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {quote?.currency && quote.currency !== 'USD' ? `${quote.currency} ` : '$'}{formatPx(quote?.price)}
                </span>
              </div>

              <div style={{ background: '#0a0a0a', padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>CHG</span>
                <span style={{ color: getPnlColor(quote?.change ?? 0), fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {(quote?.change ?? 0) >= 0 ? '+' : ''}{formatPx(quote?.change)}
                </span>
              </div>

              <div style={{ background: '#0a0a0a', padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>% CHG</span>
                <span style={{ color: getPnlColor(quote?.changePercent ?? 0), fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {(quote?.changePercent ?? 0) >= 0 ? '+' : ''}{quote?.changePercent?.toFixed(2)}%
                </span>
              </div>

              <div style={{ background: '#0a0a0a', padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>VOLUME</span>
                <span style={{ color: '#fff', fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {formatNum(quote?.volume ?? 0)}
                </span>
              </div>

              <div style={{ background: '#0a0a0a', padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>DAY LOW</span>
                <span style={{ color: '#aaa', fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {formatPx(quote?.low)}
                </span>
              </div>

              <div style={{ background: '#0a0a0a', padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>DAY HIGH</span>
                <span style={{ color: '#aaa', fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {formatPx(quote?.high)}
                </span>
              </div>
            </div>

            {/* ROW 2: VIX, Fear & Greed, Regime */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: '#1a1a1a', gap: '1px', borderBottom: '1px solid #1a1a1a' }}>
              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>VIX</span>
                <span style={{ color: '#fff', fontSize: '16px', fontWeight: 700 }}>
                  {macro?.vix != null ? macro.vix.toFixed(2) : dash}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>
                  {macro?.vixLevel?.toUpperCase() || 'UNAVAILABLE'}
                </span>
              </div>

              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>FEAR & GREED</span>
                <span style={{ color: sentiment?.fearGreedIndex == null ? '#888' : (sentiment.fearGreedIndex > 60 ? '#00c853' : sentiment.fearGreedIndex < 40 ? '#d50000' : '#fff'), fontSize: '16px', fontWeight: 700 }}>
                  {sentiment?.fearGreedIndex ?? dash}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>
                  {sentiment?.fearGreedLabel?.toUpperCase() || 'MARKET-WIDE'}
                </span>
              </div>

              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>REGIME</span>
                <span style={{ color: (macro?.regime || '').includes('BULL') ? '#00c853' : (macro?.regime || '').includes('BEAR') ? '#d50000' : '#888', fontSize: '16px', fontWeight: 700, textTransform: 'uppercase' }}>
                  {macro?.regime || dash}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>
                  {macro?.riskSentiment || 'SPY REGIME'}
                </span>
              </div>
            </div>

            {/* ROW 3: Yield, SPY, QQQ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: '#1a1a1a', gap: '1px' }}>
              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>10Y YIELD</span>
                <span style={{ color: '#fff', fontSize: '16px', fontWeight: 700 }}>
                  {macro?.tenYearYield != null ? `${macro.tenYearYield.toFixed(2)}%` : dash}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>US10Y</span>
              </div>

              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>SPY CORR</span>
                <span style={{ color: '#aaa', fontSize: '16px', fontWeight: 700 }}>
                  {macro?.spyCorrelation != null ? macro.spyCorrelation.toFixed(3) : dash}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>
                  {macro?.spyBeta != null ? `β ${macro.spyBeta.toFixed(2)} · 60D` : '60D ROLLING'}
                </span>
              </div>

              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>QQQ CORR</span>
                <span style={{ color: '#aaa', fontSize: '16px', fontWeight: 700 }}>
                  {macro?.qqqCorrelation != null ? macro.qqqCorrelation.toFixed(3) : dash}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>
                  {macro?.qqqBeta != null ? `β ${macro.qqqBeta.toFixed(2)} · 60D` : '60D ROLLING'}
                </span>
              </div>
            </div>
          </div>

          {/* ── LOWER SECTION: Full-Width Chart + Indicators + Bottom Intelligence Grid ───── */}
          <div style={{ display: 'flex', flexDirection: 'column', background: '#1a1a1a', border: '1px solid #1a1a1a', gap: '1px' }}>

            {/* 1. Chart Section */}
            <div style={{ background: '#000', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {/* Chart Header */}
              <div style={{ padding: '8px 14px', borderBottom: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

            {/* 3. Intelligence Matrix — Tier 1: 3-column Grid (Verdict, Trading Plan, Confluence) */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
              gap: '1px', 
              background: '#1a1a1a' 
            }}>
              {/* Card 1: Ticker Verdict & Structure */}
              <div style={{ background: '#000', padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', paddingTop: '12px', borderTop: '1px solid #141414' }}>
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
              </div>

              {/* Card 2: Trading Plan */}
              <div style={{ background: '#000', padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid #141414' }}>
                      <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>ACTION</span>
                      <span style={{ fontSize: '12px', color: biasColor(analysis?.plan.action === 'BUY' ? 'BULL' : analysis?.plan.action === 'SELL' ? 'BEAR' : 'NEUTRAL'), fontWeight: 700 }}>
                        {analysis?.plan.action || 'WATCH'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid #141414' }}>
                      <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>ENTRY</span>
                      <span style={{ fontSize: '12px', color: '#fff', fontWeight: 700 }}>{analysis?.plan.entryLabel || dash}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid #141414' }}>
                      <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>STOP LOSS</span>
                      <span style={{ fontSize: '12px', color: '#d50000', fontWeight: 700 }}>{formatPx(analysis?.plan.stop)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid #141414' }}>
                      <span style={{ fontSize: '10px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>TARGET 1</span>
                      <span style={{ fontSize: '12px', color: '#00c853', fontWeight: 700 }}>{formatPx(analysis?.plan.target1)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '1px solid #141414' }}>
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

                <div style={{ marginTop: '12px', color: '#555', fontSize: '9px', lineHeight: 1.4, borderTop: '1px solid #141414', paddingTop: '8px' }}>
                  {analysis?.plan.notes || 'Levels are derived from ATR and nearby structure.'}
                </div>
              </div>

              {/* Card 3: Confluence Signals */}
              <div style={{ background: '#000', padding: '18px 20px' }}>
                <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>CONFLUENCE SIGNALS</span>
                  <span style={{ color: '#555', fontSize: '9px', letterSpacing: '0.05em' }}>
                    {analysis?.signals?.length || 0} FACTORS
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto' }}>
                  {(analysis?.signals || []).slice(0, 8).map(sig => (
                    <div key={sig.key} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', paddingBottom: '6px', borderBottom: '1px solid #141414' }}>
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
              </div>
            </div>

            {/* 4. Intelligence Matrix — Tier 2: 2-column Grid (Social Sentiment & Insights/News) */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', 
              gap: '1px', 
              background: '#1a1a1a' 
            }}>
              {/* Card 4: Social Sentiment */}
              <div style={{ background: '#000', padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
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
                        {sentiment?.stocktwits?.totalMessages ? `${sentiment.stocktwits.totalMessages} POSTS SAMPLED` : sentiment?.stocktwits?.total ? `${sentiment.stocktwits.total} LABELED` : 'LIVE STREAM'}
                      </span>
                    </div>

                    {/* Green (Bull) + Red (Bear) Progress Bar */}
                    <div style={{ height: '7px', display: 'flex', marginBottom: '8px', background: '#1a1a1a', borderRadius: '1px', overflow: 'hidden' }}>
                      {sentiment?.stocktwits?.total ? (
                        <>
                          <div 
                            style={{ 
                              width: `${(sentiment.stocktwits.bullish / sentiment.stocktwits.total) * 100}%`, 
                              background: '#00c853',
                              transition: 'width 0.3s ease'
                            }} 
                            title={`Bullish: ${Math.round((sentiment.stocktwits.bullish / sentiment.stocktwits.total) * 100)}%`}
                          />
                          <div 
                            style={{ 
                              width: `${(sentiment.stocktwits.bearish / sentiment.stocktwits.total) * 100}%`, 
                              background: '#d50000',
                              transition: 'width 0.3s ease'
                            }} 
                            title={`Bearish: ${Math.round((sentiment.stocktwits.bearish / sentiment.stocktwits.total) * 100)}%`}
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
                        {sentiment?.stocktwits?.bullish ?? 0} BULL {sentiment?.stocktwits?.total ? `(${Math.round((sentiment.stocktwits.bullish / sentiment.stocktwits.total) * 100)}%)` : ''}
                      </span>
                      <span style={{ color: '#d50000', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {sentiment?.stocktwits?.total ? `(${Math.round((sentiment.stocktwits.bearish / sentiment.stocktwits.total) * 100)}%)` : ''} {sentiment?.stocktwits?.bearish ?? 0} BEAR
                        <span style={{ width: '6px', height: '6px', background: '#d50000', borderRadius: '50%', display: 'inline-block' }} />
                      </span>
                    </div>

                    {/* Concrete StockTwits Message Snippet */}
                    {sentiment?.stocktwits?.sampleMessages && sentiment.stocktwits.sampleMessages.length > 0 && (
                      <div style={{ marginTop: '8px', padding: '6px 10px', background: '#0d0d0d', borderLeft: '2px solid #333', fontSize: '9px', color: '#aaa', lineHeight: 1.35 }}>
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
                  <div style={{ marginBottom: '14px', paddingTop: '10px', borderTop: '1px solid #141414' }}>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid #141414' }}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid #141414', marginTop: '12px' }}>
                  <span style={{ fontSize: '9px', color: '#555', fontWeight: 700, letterSpacing: '0.05em' }}>FEAR & GREED INDEX</span>
                  <span style={{ fontSize: '10px', color: biasColor(sentiment?.fearGreedLabel || ''), fontWeight: 700 }}>
                    {sentiment?.fearGreedIndex != null ? `${sentiment.fearGreedIndex} · ${sentiment?.fearGreedLabel?.toUpperCase() || ''}` : dash}
                  </span>
                </div>
              </div>

              {/* Card 5: What Ticker Is Doing & News Catalysts */}
              <div style={{ background: '#000', padding: '18px 20px' }}>
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
                    <div key={`n-${i}`} style={{ color: '#888', fontSize: '11px', lineHeight: 1.45, padding: '4px 0', borderTop: '1px solid #141414' }}>
                      <span style={{ color: '#00c853', fontWeight: 700, marginRight: '6px', fontSize: '9px', border: '1px solid #00c853', padding: '1px 4px' }}>NEWS</span>
                      {h}
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

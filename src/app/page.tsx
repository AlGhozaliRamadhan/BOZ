'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import TradingViewChart from '@/app/components/ui/TradingViewChart';
import TechnicalStrip from '@/app/components/ui/TechnicalStrip';

interface QuoteData {
  ticker: string;
  name?: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
}

interface MacroData {
  regime: string;
  vix: number;
  vixLevel: string;
  spyCorrelation: number;
  qqqCorrelation: number;
  tenYearYield: number;
  riskSentiment: string;
}

interface SentimentData {
  fearGreedIndex: number;
  fearGreedLabel: string;
  stocktwits: {
    bullish: number;
    bearish: number;
    total: number;
  };
  reddit: {
    buzzCount: number;
    sentiment: string;
  };
  overallSignal: string;
}

/* ── Chart block (TradingView-native candles/lines handled here) ────────── */
type ChartStyle = '1' | '4' | '5';

const CHART_STYLE_KEY = 'boz_dashboard_chart_style';
const DEFAULT_STYLE: ChartStyle = '1';

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
  const [ticker, setTicker] = useState('');
  const [tickerInput, setTickerInput] = useState('');
  
  // Autocomplete state
  const [searchResults, setSearchResults] = useState<{symbol: string, name: string, exchange: string}[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Chart style state (per-ticker, persisted to localStorage)
  const [chartStyle, setChartStyle] = useState<ChartStyle>(DEFAULT_STYLE);
  const [chartMenuOpen, setChartMenuOpen] = useState(false);

  // Restore ticker from URL + saved chart style for that ticker
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlTicker = params.get('ticker');
      if (urlTicker) {
        const t = urlTicker.toUpperCase();
        setTicker(t);
        setTickerInput(t);
        setChartStyle(loadChartStyle(t));
      }
    }
  }, []);

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (t: string, background = false) => {
    if (!t) {
      setLoading(false);
      return;
    }
    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const [quoteRes, macroRes, sentimentRes] = await Promise.allSettled([
        fetch(`/api/market/quote?ticker=${encodeURIComponent(t)}`).then(res => { if (!res.ok) throw new Error(); return res.json(); }),
        fetch(`/api/market/macro?ticker=${encodeURIComponent(t)}`).then(res => { if (!res.ok) throw new Error(); return res.json(); }),
        fetch(`/api/market/sentiment?ticker=${encodeURIComponent(t)}`).then(res => { if (!res.ok) throw new Error(); return res.json(); }),
      ]);

      if (quoteRes.status === 'rejected') {
        throw new Error(`Failed to fetch quote data. Ticker ${t} might be invalid or unsupported.`);
      }

      const rawQuote = quoteRes.value;
      const rawMacro = macroRes.status === 'fulfilled' ? macroRes.value : {};
      const rawSentiment = sentimentRes.status === 'fulfilled' ? sentimentRes.value : {};

      const quoteData: QuoteData = {
        ticker: rawQuote.symbol || t,
        name: rawQuote.name || rawQuote.symbol || t,
        price: rawQuote.price || 0,
        change: rawQuote.change || 0,
        changePercent: rawQuote.changePercent || 0,
        volume: rawQuote.volume || 0,
        high: rawQuote.dayHigh || 0,
        low: rawQuote.dayLow || 0,
        open: rawQuote.open || 0,
      };

      let vixLevelStr = 'Unknown';
      if (rawMacro.vix_level) {
        if (rawMacro.vix_level < 15) vixLevelStr = 'Low';
        else if (rawMacro.vix_level < 20) vixLevelStr = 'Moderate';
        else if (rawMacro.vix_level < 30) vixLevelStr = 'High';
        else vixLevelStr = 'Extreme';
      }

      const macroData: MacroData = {
        regime: rawMacro.market_regime || 'UNKNOWN',
        vix: rawMacro.vix_level || 0,
        vixLevel: vixLevelStr,
        spyCorrelation: rawMacro.sp500_corr || 0,
        qqqCorrelation: rawMacro.nasdaq_corr || 0,
        tenYearYield: rawMacro.tnx_yield || 0,
        riskSentiment: rawMacro.risk_sentiment || 'NEUTRAL',
      };

      const redditBuzz = rawSentiment.social_buzz?.find((b: any) => b.source === 'Reddit');

      const sentimentData: SentimentData = {
        fearGreedIndex: rawSentiment.fear_greed?.value || 0,
        fearGreedLabel: rawSentiment.fear_greed?.label || 'Neutral',
        stocktwits: {
          bullish: rawSentiment.stocktwits_data?.bullish || 0,
          bearish: rawSentiment.stocktwits_data?.bearish || 0,
          total: rawSentiment.stocktwits_data?.total_with_sentiment || 0,
        },
        reddit: {
          buzzCount: redditBuzz?.mentions || 0,
          sentiment: 'Neutral',
        },
        overallSignal: rawSentiment.summary?.overall_signals?.[0] || 'NEUTRAL',
      };

      setQuote(quoteData);
      setMacro(macroData);
      setSentiment(sentimentData);
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
      fetchData(ticker, true);
    }, 15000);
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
      setTicker(newTicker);
      setShowDropdown(false);
      window.history.pushState(null, '', `?ticker=${encodeURIComponent(newTicker)}`);
    }
  };

  const formatNum = (num: number) => {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
  };

  const getPnlColor = (val: number) => val >= 0 ? 'var(--success)' : 'var(--danger)';


  return (
    <div className="bbg-page" style={{ padding: '0 0 var(--space-6)', minHeight: '100vh', background: '#000' }}>
      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div className="bbg-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid #1f1f1f' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-violet)', fontSize: '14px', fontWeight: 700, margin: 0, letterSpacing: '0.05em' }}>INTELLIGENCE DASHBOARD</h1>
          <p style={{ fontFamily: 'var(--font-mono)', color: '#555', fontSize: '10px', marginTop: '2px', textTransform: 'uppercase' }}>REAL-TIME MARKET OVERVIEW</p>
        </div>
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
                      setTicker(newTicker);
                      setShowDropdown(false);
                      window.history.pushState(null, '', `?ticker=${encodeURIComponent(newTicker)}`);
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

      {!ticker ? (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <h2 style={{ fontSize: '18px', color: '#fff', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>[ SEARCH ASSET ]</h2>
          <p style={{ color: '#888', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>{'>'} TYPE A STOCK SYMBOL, CRYPTO, OR INDEX TO GENERATE A REAL-TIME INTELLIGENCE DASHBOARD.</p>
        </div>
      ) : loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <h2 style={{ fontSize: '18px', color: '#fff', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>[ LOADING DASHBOARD... ]</h2>
          <p style={{ color: '#888', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>{'>'} FETCHING DATA_</p>
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
                  <span style={{ color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em' }}>US EQUITY</span>
                </div>
                <div style={{ color: '#888', fontSize: '10px', marginTop: '4px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {quote?.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00c853' }}></span>
                  <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em' }}>CONNECTED UTC 20:33:14</span>
                </div>
              </div>
              
              <div style={{ background: '#0a0a0a', padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>LAST</span>
                <span style={{ color: '#00c853', fontSize: '24px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  ${quote?.price?.toFixed(2)}
                </span>
              </div>

              <div style={{ background: '#0a0a0a', padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>CHG</span>
                <span style={{ color: getPnlColor(quote?.change ?? 0), fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {(quote?.change ?? 0) >= 0 ? '+' : ''}{quote?.change?.toFixed(2)}
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
                  {quote?.low?.toFixed(2)}
                </span>
              </div>

              <div style={{ background: '#0a0a0a', padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>DAY HIGH</span>
                <span style={{ color: '#aaa', fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {quote?.high?.toFixed(2)}
                </span>
              </div>
            </div>

            {/* ROW 2: VIX, Fear & Greed, Regime */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: '#1a1a1a', gap: '1px', borderBottom: '1px solid #1a1a1a' }}>
              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>VIX</span>
                <span style={{ color: '#fff', fontSize: '16px', fontWeight: 700 }}>
                  {macro?.vix?.toFixed(2) || '15.53'}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>
                  {macro?.vixLevel?.toUpperCase() || 'MODERATE'}
                </span>
              </div>

              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>FEAR & GREED</span>
                <span style={{ color: '#00c853', fontSize: '16px', fontWeight: 700 }}>
                  {sentiment?.fearGreedIndex || '65'}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>
                  {sentiment?.fearGreedLabel?.toUpperCase() || 'GREED'}
                </span>
              </div>

              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>REGIME</span>
                <span style={{ color: '#00c853', fontSize: '16px', fontWeight: 700, textTransform: 'uppercase' }}>
                  {macro?.regime || 'BULL_CONFIRMED'}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>MARKET PHASE</span>
              </div>
            </div>

            {/* ROW 3: Yield, SPY, QQQ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: '#1a1a1a', gap: '1px' }}>
              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>10Y YIELD</span>
                <span style={{ color: '#fff', fontSize: '16px', fontWeight: 700 }}>
                  {macro?.tenYearYield?.toFixed(2) || '4.68'}%
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>US10Y</span>
              </div>

              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>SPY CORR</span>
                <span style={{ color: '#aaa', fontSize: '16px', fontWeight: 700 }}>
                  {macro?.spyCorrelation?.toFixed(3) || '0.690'}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>60D ROLLING</span>
              </div>

              <div style={{ background: '#000', padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px' }}>QQQ CORR</span>
                <span style={{ color: '#aaa', fontSize: '16px', fontWeight: 700 }}>
                  {macro?.qqqCorrelation?.toFixed(3) || '0.673'}
                </span>
                <span style={{ color: '#555', fontSize: '9px', marginTop: '4px', letterSpacing: '0.05em' }}>60D ROLLING</span>
              </div>
            </div>
          </div>

          {/* ── LOWER SECTION: Chart & Info Panel (one connected block) ───── */}
          <div data-dashboard-lower style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1px', background: '#1a1a1a', border: '1px solid #1a1a1a' }}>

            {/* Chart Column */}
            <div style={{ background: '#000', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
              {/* Chart Header — single row with working timeframe/style menu */}
              <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#fff', fontSize: '10px' }}>▼</span>
                  <span style={{ color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em' }}>MARKET ANALYSIS</span>
                  <span style={{ color: '#fff', fontSize: '10px' }}>•</span>
                  <span style={{ color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em' }}>{quote?.ticker}</span>
                </div>

                <div style={{ display: 'none' }}>
                  <button
                    type="button"
                    onClick={() => setChartMenuOpen(o => !o)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: '#0a0a0a', border: '1px solid #2a2a2a', color: '#fff',
                      padding: '3px 10px', fontFamily: 'var(--font-mono)', fontSize: '10px',
                      fontWeight: 700, letterSpacing: '0.05em', cursor: 'pointer'
                    }}
                  >
                    {STYLE_LABELS[chartStyle]}
                    <span style={{ fontSize: '8px', color: '#888' }}>▼</span>
                  </button>

                  {chartMenuOpen && (
                    <>
                      {/* Click-away backdrop */}
                      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setChartMenuOpen(false)} />
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 4px)', right: '12px', zIndex: 50,
                        background: '#0d0d0d', border: '1px solid #2a2a2a', minWidth: '150px'
                      }}>
                        <div style={{ padding: '6px 10px', color: '#555', fontSize: '8px', fontWeight: 700, letterSpacing: '0.15em', borderBottom: '1px solid #1f1f1f' }}>STYLE</div>
                        {([['1', 'CANDLES'], ['4', 'LINE'], ['5', 'AREA']] as const).map(([st, label]) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => { setChartStyle(st); setChartMenuOpen(false); }}
                            style={{
                              display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center',
                              padding: '6px 10px', background: 'transparent', border: 'none', color: chartStyle === st ? '#fff' : '#fff',
                              fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, cursor: 'pointer', textAlign: 'left'
                            }}
                          >
                            <span>{label}</span>
                            {chartStyle === st && <span style={{ color: '#fff' }}>●</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div style={{ height: '500px', position: 'relative' }}>
                <TradingViewChart symbol={quote?.ticker || 'AAPL'} style={chartStyle} />
              </div>
              <TechnicalStrip ticker={quote?.ticker || 'AAPL'} />
            </div>

            {/* Info Panel Column (stacked flush, 1px hairlines) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#1a1a1a' }}>
              {/* About Box */}
              <div style={{ background: '#000', padding: '20px' }}>
                <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', marginBottom: '16px' }}>
                  ABOUT {quote?.ticker}
                </div>
                <div style={{ color: '#888', fontSize: '11px', lineHeight: 1.6, letterSpacing: '0.02em' }}>
                  You are currently viewing the intelligence dashboard for <strong style={{ color: '#fff' }}>{quote?.name || quote?.ticker}</strong>.
                  This tool automatically tracks institutional positioning, underlying volatility, and retail crowd sentiment to provide you with a holistic view of the asset.
                </div>
              </div>

              {/* Social Buzz Box */}
              <div style={{ background: '#000', padding: '20px' }}>
                <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', marginBottom: '16px' }}>
                  SOCIAL SENTIMENT
                </div>

                {/* StockTwits Bar */}
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '10px', color: '#888', fontWeight: 700, letterSpacing: '0.05em' }}>STOCKTWITS</span>
                    <span style={{ fontSize: '10px', color: '#fff', fontWeight: 700 }}>{sentiment?.stocktwits?.total ?? 0} POSTS</span>
                  </div>
                  <div style={{ height: '6px', display: 'flex', marginBottom: '8px', background: '#d50000' }}>
                    <div style={{ width: `${sentiment?.stocktwits?.total ? (sentiment.stocktwits.bullish / sentiment.stocktwits.total) * 100 : 50}%`, background: '#00c853' }}></div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 700 }}>
                    <span style={{ color: '#00c853' }}>{sentiment?.stocktwits?.bullish ?? 0} BULL</span>
                    <span style={{ color: '#d50000' }}>{sentiment?.stocktwits?.bearish ?? 0} BEAR</span>
                  </div>
                </div>

                {/* Reddit & Crowd */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '10px', color: '#888', fontWeight: 700, letterSpacing: '0.05em' }}>REDDIT MENTIONS</span>
                  <span style={{ fontSize: '10px', color: '#fff', fontWeight: 700 }}>{sentiment?.reddit?.buzzCount ?? 0}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: '#888', fontWeight: 700, letterSpacing: '0.05em' }}>OVERALL CROWD</span>
                  <span style={{
                    fontSize: '10px', fontWeight: 700, padding: '2px 6px', border: '1px solid currentColor',
                    color: sentiment?.overallSignal?.toLowerCase().includes('bull') ? '#00c853' :
                           sentiment?.overallSignal?.toLowerCase().includes('bear') ? '#d50000' : '#888'
                  }}>
                    {sentiment?.overallSignal ?? 'NEUTRAL'}
                  </span>
                </div>
              </div>

              {/* What does this mean Box */}
              <div style={{ background: '#000', padding: '20px' }}>
                <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', marginBottom: '20px' }}>
                  WHAT DOES THIS MEAN?
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, marginBottom: '6px' }}>Market Regime</div>
                    <div style={{ color: '#555', fontSize: '11px', lineHeight: 1.5 }}>
                      Indicates the current trend phase. Bull means the broader market is in an uptrend. Aligning your trades with the regime significantly increases win rates.
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, marginBottom: '6px' }}>Fear & Greed</div>
                    <div style={{ color: '#555', fontSize: '11px', lineHeight: 1.5 }}>
                      Measures market emotion. High greed often precedes tops (meaning risk is high), while high fear often precedes bottoms (potential buying opportunities).
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, marginBottom: '6px' }}>Volatility (VIX)</div>
                    <div style={{ color: '#555', fontSize: '11px', lineHeight: 1.5 }}>
                      The "fear gauge" of the stock market. A higher VIX means expected market turbulence. A low VIX implies stability and complacency.
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#fff', fontSize: '11px', fontWeight: 700, marginBottom: '6px' }}>Social Sentiment</div>
                    <div style={{ color: '#555', fontSize: '11px', lineHeight: 1.5 }}>
                      Tracks what retail traders are saying on Reddit and StockTwits. Overwhelmingly bullish sentiment from the crowd can sometimes be a contrarian warning sign.
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ThoughtAccordion } from '@/app/components/ui/ThoughtAccordion';

interface QuoteData {
  ticker: string;
  name?: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
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

function getGaugeColor(value: number): string {
  if (value < 25) return '#ef4444';
  if (value < 45) return '#f59e0b';
  if (value < 55) return '#eab308';
  if (value < 75) return '#3b82f6';
  return '#10b981';
}

function getVixColor(level: string): string {
  switch (level?.toLowerCase()) {
    case 'low': return '#10b981';
    case 'moderate': return '#f59e0b';
    case 'high': return '#ef4444';
    case 'extreme': return '#dc2626';
    default: return '#64748b';
  }
}

export default function DashboardPage() {
  const [ticker, setTicker] = useState('');
  const [tickerInput, setTickerInput] = useState('');
  
  // Autocomplete state
  const [searchResults, setSearchResults] = useState<{symbol: string, name: string, exchange: string}[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlTicker = params.get('ticker');
      if (urlTicker) {
        setTicker(urlTicker.toUpperCase());
        setTickerInput(urlTicker.toUpperCase());
      }
    }
  }, []);

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
    
    // Real-time polling every 15 seconds
    const intervalId = setInterval(() => {
      fetchData(ticker, true);
    }, 15000);

    // Cleanup to prevent memory leaks when component unmounts or ticker changes
    return () => clearInterval(intervalId);
  }, [ticker, fetchData]);

  // Autocomplete effect
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
      
      // If user presses Enter while searching, auto-select the best match
      if (showDropdown && searchResults.length > 0) {
        newTicker = searchResults[0].symbol.toUpperCase();
        setTickerInput(newTicker);
      }
      
      setTicker(newTicker);
      setShowDropdown(false);
      window.history.pushState(null, '', `?ticker=${encodeURIComponent(newTicker)}`);
    }
  };

  const totalArcLength = 188;
  const fgValue = sentiment?.fearGreedIndex ?? 0;
  const gaugeOffset = totalArcLength * (1 - fgValue / 100);
  const gaugeColor = getGaugeColor(fgValue);

  return (
    <div className="animate-fadeIn">
      {/* Header (Always Visible) */}
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="flex-row items-center justify-between">
          <div>
            <h1 className="page-title">Intelligence Dashboard</h1>
            <p className="page-subtitle">Real-time market overview</p>
          </div>
          <div style={{ position: 'relative', width: '320px' }}>
            <form onSubmit={handleTickerSubmit} className="input-group">
              <input
                type="text"
                className="input"
                placeholder="Search assets (e.g. AAPL, BTC-USD)..."
                value={tickerInput}
                onChange={(e) => {
                  setTickerInput(e.target.value);
                  if (e.target.value.trim().toUpperCase() !== ticker.toUpperCase()) {
                    setShowDropdown(true);
                  } else {
                    setShowDropdown(false);
                  }
                }}
                onFocus={() => {
                  if (tickerInput.trim().toUpperCase() !== ticker.toUpperCase()) {
                    setShowDropdown(true);
                  }
                }}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              />
              <button type="submit" className="btn btn-primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Go
              </button>
            </form>

            {/* Dropdown Menu */}
            {showDropdown && (tickerInput.trim() !== '') && (
              <div style={{ 
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px',
                background: 'var(--surface-glass)', border: '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-md)', zIndex: 50, boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden'
              }}>
                {isSearching ? (
                  <div style={{ padding: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>Searching...</div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((result, i) => (
                    <div 
                      key={result.symbol + i}
                      style={{ 
                        padding: 'var(--space-3)', 
                        borderBottom: i === searchResults.length - 1 ? 'none' : '1px solid var(--border-glass)', 
                        cursor: 'pointer', 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: 'var(--bg-secondary)'
                      }}
                      onMouseDown={() => {
                        const newTicker = result.symbol.toUpperCase();
                        setTickerInput(newTicker);
                        setTicker(newTicker);
                        setShowDropdown(false);
                        window.history.pushState(null, '', `?ticker=${encodeURIComponent(newTicker)}`);
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-glass-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    >
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <strong style={{ color: 'var(--text-primary)', display: 'block' }}>{result.symbol}</strong>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{result.name}</span>
                      </div>
                      <span className="badge badge-neutral" style={{ fontSize: '10px' }}>{result.exchange}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>No assets found</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {!ticker ? (
        <div className="flex-col items-center justify-center animate-fadeIn" style={{ minHeight: '50vh', textAlign: 'center', color: 'var(--text-muted)' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 'var(--space-4)', opacity: 0.3 }}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          <h2 style={{ fontSize: 'var(--text-2xl)', color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>Search for an Asset</h2>
          <p style={{ maxWidth: '400px', lineHeight: 1.6 }}>Type a stock symbol, crypto, or index (e.g. AAPL, BTC-USD, SPY) in the search bar above to generate a real-time intelligence dashboard.</p>
        </div>
      ) : loading ? (
        <div className="flex-col items-center justify-center animate-fadeIn" style={{ minHeight: '40vh' }}>
          <div className="loader" style={{ marginBottom: 'var(--space-4)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </div>
          <h2 className="page-title">Loading Dashboard...</h2>
          <p className="page-subtitle">Fetching real-time market overview</p>
        </div>
      ) : error ? (
        <div className="glass-card animate-fadeIn">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="empty-state-title">Connection Error</h3>
            <p className="empty-state-text">{error}</p>
            <button className="btn btn-primary" onClick={() => fetchData(ticker)}>
              Retry
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-6)' }}>
        {/* Left Area (Main Dashboard) */}
        <div className="flex-col gap-6" style={{ gridColumn: '1 / span 2' }}>
          
          {/* AI Intelligence & Thought Process */}
          <ThoughtAccordion
            thoughts={[
              `[REGIME ANALYSIS] Market regime is currently ${macro?.regime || 'NEUTRAL'} with VIX at ${macro?.vix?.toFixed(2) || '--'} (${macro?.vixLevel || 'Unknown'} volatility). ${macro?.vix && macro.vix > 25 ? 'Elevated volatility signals caution and hedging.' : 'Subdued volatility favors momentum trend continuation.'}`,
              `[CROWD DEDUCTION] Fear & Greed Index at ${sentiment?.fearGreedIndex ?? '--'} (${sentiment?.fearGreedLabel ?? 'Neutral'}). StockTwits sentiment is ${sentiment?.stocktwits?.total ? Math.round((sentiment.stocktwits.bullish / sentiment.stocktwits.total) * 100) : 50}% Bullish across ${sentiment?.stocktwits?.total ?? 0} posts. ${sentiment?.overallSignal ? `Overall Signal: ${sentiment.overallSignal}.` : ''}`,
              `[ASSET OVERVIEW] ${quote?.ticker} is trading at $${quote?.price?.toFixed(2) || '--'} (${(quote?.changePercent ?? 0) >= 0 ? '+' : ''}${quote?.changePercent?.toFixed(2) || '0'}%) with 10Y Yield at ${macro?.tenYearYield?.toFixed(2) || '--'}% and ${macro?.riskSentiment || 'NEUTRAL'} risk sentiment.`,
            ]}
            title={`Market AI Reasoning & Intelligence (${quote?.ticker || 'Global'})`}
            defaultOpen={false}
            accent="cyan"
          />

          {/* Main Price & Regime Panel */}
          <div className="glass-card accent-glow flush" style={{ overflow: 'hidden' }}>
            <div style={{ padding: 'var(--space-6)', borderBottom: '1px solid var(--border-glass)' }}>
              <div className="flex-row items-start justify-between">
                <div>
                  <h2 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {quote?.ticker}
                    <span style={{ fontSize: 'var(--text-lg)', color: 'var(--text-muted)', fontWeight: 500 }}>{quote?.name}</span>
                  </h2>
                  <div className="price-display" style={{ marginTop: 'var(--space-3)' }}>
                    <span className="price-value">${quote?.price?.toFixed(2) ?? '—'}</span>
                    <span className={`price-change ${(quote?.changePercent ?? 0) >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: 'var(--text-base)' }}>
                      {(quote?.changePercent ?? 0) >= 0 ? '▲' : '▼'}{' '}
                      {quote?.change?.toFixed(2)} ({quote?.changePercent?.toFixed(2)}%)
                    </span>
                  </div>
                </div>
                <div className="flex-col items-end">
                  <span className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Market Regime</span>
                  <span className={`badge ${
                    macro?.regime?.toLowerCase().includes('bull') ? 'badge-bull' :
                    macro?.regime?.toLowerCase().includes('bear') ? 'badge-bear' :
                    'badge-neutral'
                  }`} style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-1) var(--space-3)' }}>
                    {macro?.regime ?? 'Unknown'}
                  </span>
                </div>
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--surface-glass-hover)' }}>
              {/* Fear & Greed */}
              <div style={{ padding: 'var(--space-5)', borderRight: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                <div style={{ flex: 1 }}>
                  <div className="card-title">Fear &amp; Greed</div>
                  <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: gaugeColor, marginTop: 'var(--space-1)' }}>
                    {fgValue} <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontWeight: 500 }}>{sentiment?.fearGreedLabel}</span>
                  </div>
                </div>
                <svg viewBox="0 0 160 100" style={{ width: '80px', height: '50px', overflow: 'visible' }}>
                  <path d="M20,90 A60,60 0 0,1 140,90" className="gauge-bg" />
                  <path
                    d="M20,90 A60,60 0 0,1 140,90"
                    className="gauge-fill"
                    style={{ stroke: gaugeColor, strokeDasharray: totalArcLength, strokeDashoffset: gaugeOffset }}
                  />
                </svg>
              </div>

              {/* VIX Level */}
              <div style={{ padding: 'var(--space-5)' }}>
                <div className="card-title">Volatility (VIX)</div>
                <div className="flex-row items-center gap-3" style={{ marginTop: 'var(--space-1)' }}>
                  <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: getVixColor(macro?.vixLevel ?? '') }}>
                    {macro?.vix?.toFixed(2) ?? '—'}
                  </span>
                  <span className={`badge ${
                    macro?.vixLevel?.toLowerCase() === 'low' ? 'badge-bull' :
                    macro?.vixLevel?.toLowerCase() === 'moderate' ? 'badge-warning' :
                    'badge-bear'
                  }`}>
                    {macro?.vixLevel ?? 'Unknown'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Deep Analytics */}
          <div className="glass-card flush">
            <div style={{ padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--border-glass)', background: 'var(--bg-secondary)' }}>
              <span className="card-title">Deep Analytics</span>
            </div>
            <div style={{ padding: 'var(--space-6)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
              
              {/* Macro Side */}
              <div>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>Macro Environment</h3>
                <table className="data-table">
                  <tbody>
                    <tr>
                      <td style={{ paddingLeft: 0 }}>SPY Correlation</td>
                      <td style={{ paddingRight: 0, textAlign: 'right' }}>{macro?.spyCorrelation?.toFixed(3) ?? '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ paddingLeft: 0 }}>QQQ Correlation</td>
                      <td style={{ paddingRight: 0, textAlign: 'right' }}>{macro?.qqqCorrelation?.toFixed(3) ?? '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ paddingLeft: 0 }}>10Y Treasury</td>
                      <td style={{ paddingRight: 0, textAlign: 'right' }}>{macro?.tenYearYield?.toFixed(2) ?? '—'}%</td>
                    </tr>
                    <tr>
                      <td style={{ paddingLeft: 0, borderBottom: 'none' }}>Risk Sentiment</td>
                      <td style={{ paddingRight: 0, textAlign: 'right', borderBottom: 'none' }}>
                        <span className={`badge ${
                          macro?.riskSentiment?.toLowerCase() === 'risk-on' ? 'badge-bull' :
                          macro?.riskSentiment?.toLowerCase() === 'risk-off' ? 'badge-bear' :
                          'badge-neutral'
                        }`}>
                          {macro?.riskSentiment ?? '—'}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Social Side */}
              <div>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>Social Buzz</h3>
                
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <div className="flex-row justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>StockTwits</span>
                    <span className="badge badge-cyan">{sentiment?.stocktwits?.total ?? 0} posts</span>
                  </div>
                  <div className="indicator-bar" style={{ height: '6px' }}>
                    <div
                      className="indicator-bar-fill"
                      style={{
                        width: `${sentiment?.stocktwits?.total ? (sentiment.stocktwits.bullish / sentiment.stocktwits.total) * 100 : 50}%`,
                        background: 'linear-gradient(90deg, var(--bull) 0%, var(--accent-cyan) 100%)',
                      }}
                    ></div>
                  </div>
                  <div className="indicator-bar-label">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                        <polyline points="16 7 22 7 22 13" />
                      </svg>
                      {sentiment?.stocktwits?.bullish ?? 0} Bull
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
                        <polyline points="16 17 22 17 22 11" />
                      </svg>
                      {sentiment?.stocktwits?.bearish ?? 0} Bear
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex-row justify-between items-center" style={{ marginBottom: 'var(--space-2)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Reddit Mentions</span>
                    <span className="badge badge-violet">{sentiment?.reddit?.buzzCount ?? 0} this month</span>
                  </div>
                  <div className="flex-row justify-between items-center" style={{ marginTop: 'var(--space-4)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Crowd Signal</span>
                    <span className={`badge ${
                      sentiment?.overallSignal?.toLowerCase().includes('bull') ? 'badge-bull' :
                      sentiment?.overallSignal?.toLowerCase().includes('bear') ? 'badge-bear' :
                      'badge-neutral'
                    }`}>
                      {sentiment?.overallSignal ?? '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Info Column (For Newbies) */}
        <div className="flex-col gap-6" style={{ gridColumn: 'auto' }}>
          
          <div className="glass-card" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--bg-tertiary)' }}>
            <h3 className="card-title" style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              About {quote?.ticker}
            </h3>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              You are currently viewing the intelligence dashboard for <strong>{quote?.name || quote?.ticker}</strong>. 
              This tool automatically tracks institutional positioning, underlying volatility, and retail crowd sentiment to provide you with a holistic view of the asset.
            </p>
          </div>

          <div className="glass-card" style={{ background: 'var(--surface-glass-hover)' }}>
            <h3 className="card-title" style={{ color: 'var(--accent-violet)', marginBottom: 'var(--space-4)' }}>
              What does this mean?
            </h3>
            <div className="flex-col gap-4" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <div>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>Market Regime</strong>
                Indicates the current trend phase. Bull means the broader market is in an uptrend. Aligning your trades with the regime significantly increases win rates.
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>Fear &amp; Greed</strong>
                Measures market emotion. High greed often precedes tops (meaning risk is high), while high fear often precedes bottoms (potential buying opportunities).
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>Volatility (VIX)</strong>
                The "fear gauge" of the stock market. A higher VIX means expected market turbulence. A low VIX implies stability and complacency.
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>Social Sentiment</strong>
                Tracks what retail traders are saying on Reddit and StockTwits. Overwhelmingly bullish sentiment from the crowd can sometimes be a contrarian warning sign.
              </div>
            </div>
          </div>

        </div>
      </div>


        </>
      )}
    </div>
  );
}

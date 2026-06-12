'use client';

import { useState, useEffect } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function IntradayAnalysisPage() {
  const [ticker, setTicker] = useState('NVDA');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadingMessages = [
    "Fetching real-time market data...",
    "Scanning social sentiment on Reddit and StockTwits...",
    "Calculating technical indicators and moving averages...",
    "Analyzing macro environment and Treasury yields...",
    "Waiting for AI models to synthesize response...",
    "Finalizing intraday trading strategy..."
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      interval = setInterval(() => {
        setLoadingStep((prev) => Math.min(prev + 1, loadingMessages.length - 1));
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const handleAnalyze = async () => {
    if (!ticker.trim()) return;
    setLoading(true);
    setLoadingStep(0);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/analyze/intraday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: ticker.trim().toUpperCase() }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || 'Analysis failed. Please try again.');
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAnalyze();
  };

  const verdict = result?.verdict;
  const isBull = verdict?.prediction === 'UP';
  const isOk = verdict?.status === 'ok';
  const md = result?.marketData;
  const macro = result?.macro;
  const sent = result?.sentiment;
  const cp = result?.chartPatterns;
  const tl = result?.tradeLevels;

  const fmt = (v: number | null | undefined, d = 2) =>
    v != null ? v.toFixed(d) : '—';

  return (
    <div className="animate-fadeIn">
      {/* Header with Integrated Search */}
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="flex-row items-center justify-between">
          <div>
            <h1 className="page-title">Intraday Analysis</h1>
            <p className="page-subtitle">2–6 hour trading horizon</p>
          </div>
          <div style={{ width: '320px' }}>
            <div className="input-group">
              <input
                type="text"
                className="input"
                placeholder="Enter ticker (e.g. NVDA, AAPL)"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
              />
              <button
                className="btn btn-primary"
                onClick={handleAnalyze}
                disabled={loading || !ticker.trim()}
              >
                {loading ? (
                  <span className="spinner spinner-sm"></span>
                ) : (
                  'Analyze'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="spinner spinner-lg" style={{ marginBottom: 'var(--space-4)' }}></div>
          <p style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
            Analyzing {ticker}…
          </p>
          <p className="page-subtitle animate-fadeIn" key={loadingStep} style={{ height: '24px' }}>
            {loadingMessages[loadingStep]}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="glass-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h3 className="empty-state-title">Analysis Failed</h3>
            <p className="empty-state-text">{error}</p>
            <button className="btn btn-primary" onClick={handleAnalyze}>Retry</button>
          </div>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="flex-col gap-6 animate-slideUp">

          {/* Executive Summary */}
          <div className="glass-card">
            <div className="card-header" style={{ marginBottom: 'var(--space-4)' }}>
              <span className="card-title">Executive Summary</span>
              <span className={`badge ${isOk ? (isBull ? 'badge-bull' : 'badge-bear') : 'badge-neutral'}`}>
                {isOk ? (isBull ? 'Bullish Outlook' : 'Bearish Outlook') : 'Uncertain / Hold'}
              </span>
            </div>
            
            <div className="grid-3 gap-4" style={{ marginBottom: tl ? 'var(--space-6)' : '0' }}>
              <div style={{ padding: 'var(--space-4)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Conviction Score</span>
                <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, color: 'var(--text-primary)', marginTop: 'var(--space-1)' }}>
                  {isOk ? verdict.confidence : '--'}%
                </div>
              </div>
              
              <div style={{ gridColumn: 'span 2', padding: 'var(--space-4)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recommended Action</span>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 500, color: 'var(--text-primary)', marginTop: 'var(--space-1)' }}>
                  {isOk ? (verdict.strategy || 'Maintain current position and monitor technicals.') : (verdict?.reason || 'Analysis returned an uncertain result due to conflicting signals.')}
                </div>
              </div>
            </div>

            {tl && isOk && (
               <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', borderTop: '1px solid var(--border-glass)', paddingTop: 'var(--space-4)' }}>
                 <div style={{ display: 'flex', flexDirection: 'column' }}>
                   <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-1)' }}>Entry Target</span>
                   <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>{tl.entryRange}</div>
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column' }}>
                   <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-1)' }}>Price Target</span>
                   <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--bull)' }}>{tl.targetRange}</div>
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column' }}>
                   <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-1)' }}>Stop Loss</span>
                   <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--bear)' }}>{tl.stopLoss}</div>
                 </div>
               </div>
            )}
          </div>

          {/* Technical + Macro Row */}
          <div className="grid-2 gap-4">
            {/* Technical Indicators */}
            <div className="glass-card">
              <div className="card-header">
                <span className="card-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  {' '}Technical Indicators
                </span>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Indicator</th><th>Value</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>RSI (14)</td>
                    <td className={md?.rsi > 70 ? 'table-cell-negative' : md?.rsi < 30 ? 'table-cell-positive' : ''}>{fmt(md?.rsi, 1)}</td>
                  </tr>
                  <tr>
                    <td>MACD</td>
                    <td className={(md?.macd ?? 0) >= 0 ? 'table-cell-positive' : 'table-cell-negative'}>{fmt(md?.macd, 4)}</td>
                  </tr>
                  <tr><td>SMA 20</td><td>${fmt(md?.sma_20)}</td></tr>
                  <tr><td>SMA 50</td><td>${fmt(md?.sma_50)}</td></tr>
                  <tr><td>SMA 200</td><td>${fmt(md?.sma_200)}</td></tr>
                  <tr><td>ATR</td><td>{fmt(md?.atr, 4)} ({fmt(md?.atr_percent)}%)</td></tr>
                  <tr><td>BB Width</td><td>{fmt(md?.bb_width, 4)}</td></tr>
                  <tr>
                    <td>Volume Ratio</td>
                    <td className={(md?.volume_ratio ?? 0) > 1.5 ? 'table-cell-positive' : ''}>{fmt(md?.volume_ratio)}x</td>
                  </tr>
                  <tr><td>OBV Trend</td><td>{md?.obv_trend ? '🟢 Bullish' : '🔴 Bearish'}</td></tr>
                </tbody>
              </table>
            </div>

            {/* Macro Context */}
            <div className="glass-card">
              <div className="card-header">
                <span className="card-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  {' '}Macro Context
                </span>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Metric</th><th>Value</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Market Regime</td>
                    <td>
                      <span className={`badge ${
                        macro?.market_regime?.toLowerCase().includes('bull') ? 'badge-bull' :
                        macro?.market_regime?.toLowerCase().includes('bear') ? 'badge-bear' :
                        'badge-neutral'
                      }`}>{macro?.market_regime ?? '—'}</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Risk Sentiment</td>
                    <td>
                      <span className={`badge ${
                        macro?.risk_sentiment === 'RISK_ON' ? 'badge-bull' :
                        macro?.risk_sentiment === 'RISK_OFF' ? 'badge-bear' :
                        'badge-neutral'
                      }`}>{macro?.risk_sentiment ?? '—'}</span>
                    </td>
                  </tr>
                  <tr><td>SPY Correlation</td><td>{macro?.sp500_correlation ?? '—'}</td></tr>
                  <tr><td>NASDAQ Correlation</td><td>{macro?.nasdaq_correlation ?? '—'}</td></tr>
                  <tr>
                    <td>VIX Level</td>
                    <td className={(macro?.vix_level ?? 0) > 25 ? 'table-cell-negative' : 'table-cell-positive'}>
                      {fmt(macro?.vix_level)}
                    </td>
                  </tr>
                  <tr><td>10Y Yield</td><td>{fmt(macro?.tnx_yield)}%</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Patterns + Sentiment Row */}
          <div className="grid-2 gap-4">
            {/* Chart Patterns */}
            <div className="glass-card">
              <div className="card-header">
                <span className="card-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18" />
                    <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
                  </svg>
                  {' '}Chart Patterns
                </span>
              </div>
              {cp?.patterns?.length > 0 ? (
                <div className="flex-col gap-2">
                  {cp.patterns.map((p: string, i: number) => (
                    <div key={i} className="flex-row justify-between items-center" style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-glass)' }}>
                      <span>{p}</span>
                      <span className={`badge ${
                        cp.pattern_confidence?.[i] === 'HIGH' ? 'badge-high' :
                        cp.pattern_confidence?.[i] === 'MEDIUM' ? 'badge-medium' : 'badge-low'
                      }`}>{cp.pattern_confidence?.[i] ?? '—'}</span>
                    </div>
                  ))}
                  {cp.candle_patterns?.summary_text && (
                    <div style={{ padding: 'var(--space-3) 0', marginTop: 'var(--space-2)' }}>
                      <span className="card-title">Candle Signal: </span>
                      <span className={`badge ${
                        cp.candle_patterns.overall_bias === 'BULL' ? 'badge-bull' :
                        cp.candle_patterns.overall_bias === 'BEAR' ? 'badge-bear' : 'badge-neutral'
                      }`}>{cp.candle_patterns.overall_bias} ({cp.candle_patterns.bias_strength})</span>
                    </div>
                  )}
                  <div style={{ padding: 'var(--space-2) 0' }}>
                    <span className="card-title">Fibonacci: </span>
                    <span className="badge badge-cyan">{cp.fibonacci_position}</span>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <p className="empty-state-text">No patterns detected</p>
                </div>
              )}
            </div>

            {/* Sentiment */}
            <div className="glass-card">
              <div className="card-header">
                <span className="card-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {' '}Sentiment
                </span>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Signal</th><th>Value</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Fear &amp; Greed</td>
                    <td>
                      <span className={`badge ${
                        (sent?.fear_greed?.value ?? 50) > 60 ? 'badge-bull' :
                        (sent?.fear_greed?.value ?? 50) < 40 ? 'badge-bear' : 'badge-neutral'
                      }`}>{sent?.fear_greed?.value ?? '—'} ({sent?.fear_greed?.label ?? '—'})</span>
                    </td>
                  </tr>
                  <tr>
                    <td>StockTwits</td>
                    <td>
                      <span className={`badge ${
                        (sent?.stocktwits_data?.bull_ratio ?? 50) > 60 ? 'badge-bull' :
                        (sent?.stocktwits_data?.bull_ratio ?? 50) < 40 ? 'badge-bear' : 'badge-neutral'
                      }`}>{fmt(sent?.stocktwits_data?.bull_ratio, 0)}% bullish</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Reddit</td>
                    <td><span className="badge badge-violet">{sent?.social_buzz?.length ?? 0} sources</span></td>
                  </tr>
                  <tr>
                    <td>Overall</td>
                    <td>
                      {sent?.summary?.overall_signals?.map((s: string, i: number) => (
                        <span key={i} className={`badge ${
                          s.includes('BULL') ? 'badge-bull' :
                          s.includes('BEAR') ? 'badge-bear' :
                          s.includes('FEAR') ? 'badge-bear' :
                          s.includes('GREED') ? 'badge-warning' : 'badge-neutral'
                        }`} style={{ marginRight: '4px' }}>{s}</span>
                      )) ?? '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* AI Reasoning */}
          {isOk && verdict.reasons?.length > 0 && (
            <div className="glass-card">
              <div className="card-header">
                <span className="card-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  {' '}AI Reasoning
                </span>
              </div>
              <ul className="reason-list">
                {verdict.reasons.map((r: string, i: number) => (
                  <li key={i} className="reason-item">{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Initial Empty State */}
      {!result && !loading && !error && (
        <div className="glass-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <h3 className="empty-state-title">Ready to Analyze</h3>
            <p className="empty-state-text">Enter a ticker symbol and click Analyze to run an intraday prediction with AI-powered technical, macro, and sentiment analysis.</p>
          </div>
        </div>
      )}
    </div>
  );
}

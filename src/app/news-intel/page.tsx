'use client';

import { useState } from 'react';
import { ThoughtAccordion } from '@/app/components/ui/ThoughtAccordion';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function NewsIntelPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNewsIntel = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/news-intel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) throw new Error('Failed to fetch news intelligence');

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getSourceBadgeClass = (source: string) => {
    const s = source?.toLowerCase();
    if (s?.includes('bloomberg') || s?.includes('reuters')) return 'badge-cyan';
    if (s?.includes('reddit') || s?.includes('social')) return 'badge-violet';
    if (s?.includes('cnbc') || s?.includes('yahoo')) return 'badge-warning';
    return 'badge-neutral';
  };

  const getImpactBadge = (impact: string | null | undefined) => {
    if (!impact) return 'badge-neutral';
    const i = impact.toLowerCase();
    if (i === 'high') return 'badge-high';
    if (i === 'medium') return 'badge-medium';
    return 'badge-low';
  };

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const sent = result?.sentiment;
  const fgValue = sent?.fear_greed?.value;
  const fgLabel = sent?.fear_greed?.label;
  const headlines = result?.headlines ?? [];
  const categories = result?.categories;

  return (
    <div className="animate-fadeIn">
      <div className="page-header">
        <h1 className="page-title">News Intelligence</h1>
        <p className="page-subtitle">AI-powered cross-asset news analysis</p>
      </div>

      <div className="flex-row gap-4 items-center" style={{ marginBottom: 'var(--space-6)' }}>
        <button className="btn btn-primary btn-xl" onClick={fetchNewsIntel} disabled={loading}>
          {loading ? (
            <><span className="spinner spinner-sm"></span> Fetching Intel…</>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              Fetch News Intel
            </>
          )}
        </button>
        {result?.timestamp && (
          <span className="badge badge-neutral">Updated: {formatTimestamp(result.timestamp)}</span>
        )}
      </div>

      {loading && (
        <div className="loading-overlay">
          <div className="spinner spinner-lg"></div>
          <p>Scanning global news sources…</p>
          <p className="page-subtitle">Analyzing sentiment across markets, crypto, and commodities</p>
        </div>
      )}

      {error && (
        <div className="glass-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h3 className="empty-state-title">Intel Fetch Failed</h3>
            <p className="empty-state-text">{error}</p>
            <button className="btn btn-primary" onClick={fetchNewsIntel}>Retry</button>
          </div>
        </div>
      )}

      {result && !loading && (
        <div className="flex-col gap-6 animate-slideUp">

          {/* News Intel AI Synthesis & Thought Process */}
          {(result.thoughts || result.thought || (sent?.summary?.overall_signals && sent.summary.overall_signals.length > 0)) && (
            <ThoughtAccordion
              thoughts={result.thoughts || result.thought || sent?.summary?.overall_signals}
              title="News Intelligence AI Synthesis & Macro Deductions"
              defaultOpen={false}
              accent="violet"
            />
          )}

          {/* Sentiment Overview */}
          <div className="glass-card accent-glow">
            <div className="card-header">
              <span className="card-title">Market Sentiment Overview</span>
            </div>
            <div className="grid-4 gap-4">
              <div className="flex-col items-center gap-2">
                <span className="card-title">Fear &amp; Greed</span>
                <span className="card-value">{fgValue ?? '—'}</span>
                <span className={`badge ${
                  (fgValue ?? 50) > 60 ? 'badge-bull' :
                  (fgValue ?? 50) < 40 ? 'badge-bear' : 'badge-neutral'
                }`}>{fgLabel ?? 'N/A'}</span>
              </div>
              <div className="flex-col items-center gap-2">
                <span className="card-title">StockTwits Bull %</span>
                <span className="card-value">{sent?.stocktwits_data?.bull_ratio != null ? `${sent.stocktwits_data.bull_ratio.toFixed(0)}%` : '—'}</span>
                <span className={`badge ${
                  (sent?.stocktwits_data?.bull_ratio ?? 50) > 60 ? 'badge-bull' :
                  (sent?.stocktwits_data?.bull_ratio ?? 50) < 40 ? 'badge-bear' : 'badge-neutral'
                }`}>{(sent?.stocktwits_data?.bull_ratio ?? 50) > 60 ? 'Bullish' : (sent?.stocktwits_data?.bull_ratio ?? 50) < 40 ? 'Bearish' : 'Neutral'}</span>
              </div>
              <div className="flex-col items-center gap-2">
                <span className="card-title">Headlines</span>
                <span className="card-value">{result.totalHeadlines ?? 0}</span>
                <span className="badge badge-neutral">articles</span>
              </div>
              <div className="flex-col items-center gap-2">
                <span className="card-title">Overall Signals</span>
                <div className="flex-col gap-1 items-center">
                  {sent?.summary?.overall_signals?.map((s: string, i: number) => (
                    <span key={i} className={`badge ${
                      s.includes('BULL') ? 'badge-bull' :
                      s.includes('BEAR') || s.includes('FEAR') ? 'badge-bear' :
                      s.includes('GREED') ? 'badge-warning' : 'badge-neutral'
                    }`}>{s}</span>
                  )) ?? <span className="badge badge-neutral">N/A</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          {categories && (
            <div className="glass-card compact">
              <div className="card-header"><span className="card-title">News by Category</span></div>
              <div className="flex-row flex-wrap gap-3">
                {Object.entries(categories).map(([cat, count]) => (
                  <div key={cat} className="flex-col items-center gap-1">
                    <span className="badge badge-cyan">{String(count)}</span>
                    <span className="card-title">{cat}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* News Headlines */}
          <div className="glass-card">
            <div className="card-header">
              <span className="card-title">News Headlines</span>
              <span className="badge badge-cyan">{headlines.length}</span>
            </div>
            {headlines.length > 0 ? (
              <div className="flex-col gap-3">
                {headlines.map((item: any, i: number) => (
                  <div key={i} className="flex-col gap-2" style={{
                    padding: 'var(--space-3) var(--space-4)',
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    borderLeft: `3px solid ${
                      item.sentiment === 'positive' ? 'var(--bull)' :
                      item.sentiment === 'negative' ? 'var(--bear)' : 'var(--text-muted)'
                    }`,
                  }}>
                    <div className="flex-row justify-between items-center">
                      <div className="flex-row gap-2 items-center">
                        <span className={`badge ${getSourceBadgeClass(item.source)}`}>{item.source}</span>
                        <span className={`badge ${item.category ? 'badge-violet' : 'badge-neutral'}`}>{item.category || '—'}</span>
                        {item.impact && <span className={`badge ${getImpactBadge(item.impact)}`}>{item.impact}</span>}
                      </div>
                      <span className="page-subtitle">{formatTimestamp(item.timestamp)}</span>
                    </div>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
                      ) : item.title}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state"><p className="empty-state-text">No headlines available</p></div>
            )}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="glass-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <h3 className="empty-state-title">News Intelligence</h3>
            <p className="empty-state-text">Click &quot;Fetch News Intel&quot; to scan global news sources and discover sentiment shifts across stocks, crypto, commodities, and Indonesian markets.</p>
          </div>
        </div>
      )}
    </div>
  );
}

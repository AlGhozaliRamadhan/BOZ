'use client';

import { useState } from 'react';
import { ThoughtAccordion } from '@/app/components/ui/ThoughtAccordion';

interface ScanResult {
  ticker: string;
  price: number;
  changePercent: number;
  rsi: number;
  macdSignal: string;
  volumeRatio: number;
  pattern: string;
  score: number;
}

type SortKey = keyof ScanResult;
type SortDirection = 'asc' | 'desc';

export default function IdxScannerPage() {
  const [results, setResults] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [scanThoughts, setScanThoughts] = useState<string[]>([]);

  const handleScan = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/idx/scan');
      if (!res.ok) throw new Error('Scanner failed. Please try again.');

      const data = await res.json();
      // The API returns { buys, watches, avoids } — flatten into a single array
      const allResults: ScanResult[] = [];
      for (const item of [...(data.buys ?? []), ...(data.watches ?? []), ...(data.avoids ?? [])]) {
        allResults.push({
          ticker: item.ticker ?? item.symbol ?? '—',
          price: item.price ?? item.last_price ?? 0,
          changePercent: item.change_pct ?? item.changePercent ?? 0,
          rsi: item.rsi ?? item.RSI ?? 0,
          macdSignal: item.macd_signal ?? item.macdSignal ?? '—',
          volumeRatio: item.volume_ratio ?? item.volumeRatio ?? 0,
          pattern: item.pattern ?? item.setup ?? '—',
          score: item.score ?? item.total_score ?? 0,
        });
      }
      setResults(allResults);

      const generatedThoughts: string[] = [];
      if (data.summary) {
        generatedThoughts.push(`[MARKET BREADTH] Indonesia universe screening complete. Breadth signal: ${data.summary.breadthSignal || 'NEUTRAL'} | Avg momentum score: ${data.summary.avgScore?.toFixed(1) || '--'}/100.`);
        generatedThoughts.push(`[CANDIDATE DISTRIBUTION] Identified ${data.summary.buyCount ?? data.buys?.length ?? 0} high-conviction BUY setups, ${data.summary.watchCount ?? data.watches?.length ?? 0} WATCH candidates, and ${data.summary.avoidCount ?? data.avoids?.length ?? 0} AVOID stocks out of ${data.universeCount || data.totalScanned || 0} scanned.`);
      }
      if (data.buys && data.buys.length > 0) {
        const topBuys = data.buys.slice(0, 3).map((b: any) => `${b.ticker || b.symbol} (${b.setup || b.pattern || 'Momentum'} - Score: ${b.score || b.total_score})`).join(', ');
        generatedThoughts.push(`[TOP SETUP RATIONALE] Prime momentum setups: ${topBuys}. Filtered with strict volume confirmation (Volume Ratio > 1.2x) and healthy RSI levels.`);
      }
      setScanThoughts(generatedThoughts);
      setHasScanned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortedResults = [...results].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    }
    const aStr = String(aVal);
    const bStr = String(bVal);
    return sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
  });

  const getSortIcon = (key: SortKey) => {
    if (sortKey !== key) return '↕';
    return sortDir === 'asc' ? '↑' : '↓';
  };

  const getRsiClass = (rsi: number): string => {
    if (rsi > 70) return 'table-cell-negative';
    if (rsi < 30) return 'table-cell-positive';
    return '';
  };

  const getScoreBadgeClass = (score: number): string => {
    if (score >= 70) return 'badge-high';
    if (score >= 40) return 'badge-medium';
    return 'badge-low';
  };

  return (
    <div className="animate-fadeIn">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">IDX Momentum Scanner</h1>
        <p className="page-subtitle">Indonesia Stock Exchange momentum screening</p>
      </div>

      {/* Controls */}
      <div className="scanner-controls">
        <button
          className="btn btn-primary btn-lg"
          onClick={handleScan}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner spinner-sm"></span>
              Scanning...
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Scan IDX
            </>
          )}
        </button>
        {hasScanned && !loading && (
          <span className="badge badge-cyan">{results.length} stocks found</span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="loading-overlay">
          <div className="spinner spinner-lg"></div>
          <p>Scanning IDX markets...</p>
          <p className="page-subtitle">Analyzing momentum, volume, and technical patterns</p>
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
            <h3 className="empty-state-title">Scan Failed</h3>
            <p className="empty-state-text">{error}</p>
            <button className="btn btn-primary" onClick={handleScan}>Retry</button>
          </div>
        </div>
      )}

      {/* Results Table */}
      {hasScanned && !loading && !error && (
        <>
          {scanThoughts.length > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <ThoughtAccordion
                thoughts={scanThoughts}
                title="IDX Scanner AI Momentum Deductions & Breadth Analysis"
                defaultOpen={false}
                accent="cyan"
              />
            </div>
          )}

          {sortedResults.length > 0 ? (
            <div className="scanner-table-wrapper animate-slideUp">
              <table className="data-table">
                <thead>
                  <tr>
                    <th onClick={() => handleSort('ticker')} style={{ cursor: 'pointer' }}>
                      Ticker {getSortIcon('ticker')}
                    </th>
                    <th onClick={() => handleSort('price')} style={{ cursor: 'pointer' }}>
                      Price {getSortIcon('price')}
                    </th>
                    <th onClick={() => handleSort('changePercent')} style={{ cursor: 'pointer' }}>
                      Change% {getSortIcon('changePercent')}
                    </th>
                    <th onClick={() => handleSort('rsi')} style={{ cursor: 'pointer' }}>
                      RSI {getSortIcon('rsi')}
                    </th>
                    <th onClick={() => handleSort('macdSignal')} style={{ cursor: 'pointer' }}>
                      MACD Signal {getSortIcon('macdSignal')}
                    </th>
                    <th onClick={() => handleSort('volumeRatio')} style={{ cursor: 'pointer' }}>
                      Volume Ratio {getSortIcon('volumeRatio')}
                    </th>
                    <th onClick={() => handleSort('pattern')} style={{ cursor: 'pointer' }}>
                      Pattern {getSortIcon('pattern')}
                    </th>
                    <th onClick={() => handleSort('score')} style={{ cursor: 'pointer' }}>
                      Score {getSortIcon('score')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedResults.map((row, i) => (
                    <tr key={i}>
                      <td>
                        <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>{row.ticker}</span>
                      </td>
                      <td>{row.price?.toLocaleString()}</td>
                      <td className={row.changePercent >= 0 ? 'table-cell-positive' : 'table-cell-negative'}>
                        {row.changePercent >= 0 ? '+' : ''}{row.changePercent?.toFixed(2)}%
                      </td>
                      <td className={getRsiClass(row.rsi)}>
                        {row.rsi?.toFixed(1)}
                      </td>
                      <td>
                        <span className={`badge ${
                          row.macdSignal?.toLowerCase() === 'bullish' ? 'badge-bull' :
                          row.macdSignal?.toLowerCase() === 'bearish' ? 'badge-bear' :
                          'badge-neutral'
                        }`}>
                          {row.macdSignal}
                        </span>
                      </td>
                      <td className={row.volumeRatio > 1.5 ? 'table-cell-positive' : ''}>
                        {row.volumeRatio?.toFixed(2)}x
                      </td>
                      <td>
                        {row.pattern ? (
                          <span className="badge badge-violet">{row.pattern}</span>
                        ) : (
                          <span className="badge badge-neutral">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${getScoreBadgeClass(row.score)}`}>
                          {row.score}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="glass-card">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <h3 className="empty-state-title">No Results</h3>
                <p className="empty-state-text">No momentum stocks found matching the criteria. Try scanning again later.</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Initial Empty State */}
      {!hasScanned && !loading && !error && (
        <div className="glass-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h3 className="empty-state-title">IDX Momentum Scanner</h3>
            <p className="empty-state-text">Click &quot;Scan IDX&quot; to screen Indonesia Stock Exchange stocks for momentum, volume breakouts, and technical patterns.</p>
          </div>
        </div>
      )}
    </div>
  );
}

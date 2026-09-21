'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ScreenerDirection,
  ScreenerMode,
  ScreenerPreset,
  ScreenerResponse,
  ScreenerResult,
} from '@/shared/screener-contract';

type ConvictionFilter = 'LOW' | 'MEDIUM' | 'HIGH';
type SortKey = 'ticker' | 'price' | 'chg1d' | 'rsi' | 'volume' | 'screenScore' | 'expertScore';
type SortDirection = 'asc' | 'desc';

const PRESETS: Array<{ value: ScreenerPreset; label: string; description: string }> = [
  { value: 'momentum', label: 'Momentum', description: 'Sustained price strength with participation' },
  { value: 'breakout', label: 'Breakout', description: 'Price pressing highs with volume confirmation' },
  { value: 'rebound', label: 'Rebound', description: 'Recovery from a recent low or pullback' },
  { value: 'oversold', label: 'Oversold', description: 'Stretched weakness with reversal potential' },
  { value: 'downtrend', label: 'Downtrend', description: 'Deteriorating trend and bearish continuation' },
  { value: 'near_52w_low', label: 'Near 52W Low', description: 'Price trading near its 52-week floor' },
];

const SECTORS = [
  ['all', 'All sectors'],
  ['banking', 'Banking'],
  ['consumer', 'Consumer'],
  ['mining', 'Mining'],
  ['energy', 'Energy'],
  ['tech', 'Technology'],
  ['property', 'Property'],
  ['telecom', 'Telecom'],
  ['healthcare', 'Healthcare'],
  ['industrial', 'Industrial'],
] as const;

function formatNumber(value: number | null | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function formatPrice(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : '—';
}

function signed(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function sortValue(result: ScreenerResult, key: SortKey): string | number {
  switch (key) {
    case 'ticker': return result.ticker;
    case 'price': return result.metrics.price;
    case 'chg1d': return result.metrics.chg1d;
    case 'rsi': return result.metrics.rsi ?? Number.NEGATIVE_INFINITY;
    case 'volume': return result.metrics.volumeRatio ?? Number.NEGATIVE_INFINITY;
    case 'expertScore': return result.expertSignal.score;
    case 'screenScore':
    default: return result.screenScore;
  }
}

export default function IdxScannerPage() {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const [preset, setPreset] = useState<ScreenerPreset>('momentum');
  const [sector, setSector] = useState('all');
  const [direction, setDirection] = useState<ScreenerDirection>('buy');
  const [minimumConviction, setMinimumConviction] = useState<ConvictionFilter>('LOW');
  const [mode, setMode] = useState<ScreenerMode>('fast');
  const [response, setResponse] = useState<ScreenerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('screenScore');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => () => abortRef.current?.abort(), []);

  const selectedPreset = PRESETS.find(item => item.value === preset) ?? PRESETS[0];
  const sortedResults = useMemo(() => {
    if (!response) return [];
    return [...response.results].sort((left, right) => {
      const a = sortValue(left, sortKey);
      const b = sortValue(right, sortKey);
      const comparison = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b));
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [response, sortDirection, sortKey]);

  const handleScan = async () => {
    if (loading) {
      abortRef.current?.abort();
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setExpandedTicker(null);

    try {
      const params = new URLSearchParams({
        preset,
        sector,
        direction,
        minimumConviction,
        mode,
      });
      const apiResponse = await fetch(`/api/idx/scan?${params.toString()}`, {
        signal: controller.signal,
      });
      const data = await apiResponse.json().catch(() => ({}));
      if (!apiResponse.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Scanner failed. Please try again.');
      }
      setResponse(data as ScreenerResponse);
    } catch (scanError) {
      if (controller.signal.aborted) return;
      setError(scanError instanceof Error ? scanError.message : 'Scanner failed. Please try again.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection(current => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const sortIcon = (key: SortKey) => sortKey === key ? (sortDirection === 'asc' ? '↑' : '↓') : '↕';

  return (
    <div className="screeners-page animate-fadeIn">
      <header className="screeners-header">
        <div>
          <div className="screeners-eyebrow">IDX research workspace</div>
          <h1>Screeners</h1>
          <p>Find candidates by setup, then separate screen fit from BOZ&apos;s evidence-based Expert Signal.</p>
        </div>
        <div className="screeners-disclaimer">Research signal · not a forecast</div>
      </header>

      <section className="screeners-presets" aria-label="Screener presets">
        {PRESETS.map(item => (
          <button
            key={item.value}
            type="button"
            className={`screeners-preset${preset === item.value ? ' is-active' : ''}`}
            onClick={() => setPreset(item.value)}
            disabled={loading}
          >
            <span>{item.label}</span>
            <small>{item.description}</small>
          </button>
        ))}
      </section>

      <section className="screeners-control-panel" aria-label="Scan controls">
        <label>
          <span>Sector</span>
          <select value={sector} onChange={event => setSector(event.target.value)} disabled={loading}>
            {SECTORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Direction</span>
          <select value={direction} onChange={event => setDirection(event.target.value as ScreenerDirection)} disabled={loading}>
            <option value="buy">Bullish / buy</option>
            <option value="sell">Bearish / sell</option>
            <option value="any">Any direction</option>
          </select>
        </label>
        <label>
          <span>Minimum conviction</span>
          <select value={minimumConviction} onChange={event => setMinimumConviction(event.target.value as ConvictionFilter)} disabled={loading}>
            <option value="LOW">Low or better</option>
            <option value="MEDIUM">Medium or better</option>
            <option value="HIGH">High only</option>
          </select>
        </label>
        <label>
          <span>Coverage</span>
          <select value={mode} onChange={event => setMode(event.target.value as ScreenerMode)} disabled={loading}>
            <option value="fast">Fast · top 60 enriched</option>
            <option value="deep">Deep · full universe</option>
          </select>
        </label>
        <button type="button" className={`screeners-run${loading ? ' is-cancel' : ''}`} onClick={handleScan}>
          {loading ? 'Cancel scan' : `Run ${selectedPreset.label}`}
        </button>
      </section>

      {mode === 'deep' && !loading && (
        <p className="screeners-mode-note">Deep mode enriches every valid quote and can take several minutes. Only one deep scan runs at a time.</p>
      )}

      {loading && (
        <section className="screeners-loading" aria-live="polite">
          <span className="spinner spinner-lg" />
          <div>
            <strong>Screening IDX equities</strong>
            <p>Quote prefilter → 420-day indicators → chart structure → Expert Signal</p>
          </div>
        </section>
      )}

      {error && (
        <section className="screeners-error" role="alert">
          <strong>Scan failed</strong>
          <span>{error}</span>
          <button type="button" onClick={handleScan}>Retry</button>
        </section>
      )}

      {response && !loading && !error && (
        <>
          <section className="screeners-summary" aria-label="Scan summary">
            <article>
              <span>Matches</span>
              <strong>{response.results.length}</strong>
              <small>{response.query.preset.replaceAll('_', ' ')}</small>
            </article>
            <article>
              <span>Enriched</span>
              <strong>{response.meta.enrichedCount}</strong>
              <small>of {response.meta.universeCount} symbols</small>
            </article>
            <article>
              <span>Active setups</span>
              <strong>{response.summary.buyCount + response.summary.sellCount}</strong>
              <small>{response.summary.buyCount} buy · {response.summary.sellCount} sell across enriched</small>
            </article>
            <article>
              <span>Average signal</span>
              <strong>{signed(response.summary.averageScore, 0)}</strong>
              <small>-100 bearish · +100 bullish</small>
            </article>
          </section>

          <section className="screeners-breadth">
            <div>
              <span>Market breadth</span>
              <strong>{response.summary.breadthSignal}</strong>
            </div>
            <div className="screeners-breadth__meta">
              <span>{response.summary.bullish} bullish</span>
              <span>{response.summary.neutral} neutral</span>
              <span>{response.summary.bearish} bearish</span>
              {response.meta.partial && <span className="is-warning">Partial coverage</span>}
              {response.meta.cacheHit && <span>Cached result</span>}
            </div>
          </section>

          {sortedResults.length > 0 ? (
            <section className="screeners-results" aria-label="Screener results">
              <div className="screeners-table-wrap">
                <table className="screeners-table">
                  <thead>
                    <tr>
                      <th><button onClick={() => handleSort('ticker')}>Ticker {sortIcon('ticker')}</button></th>
                      <th>Expert Signal</th>
                      <th><button onClick={() => handleSort('price')}>Price {sortIcon('price')}</button></th>
                      <th><button onClick={() => handleSort('chg1d')}>1D {sortIcon('chg1d')}</button></th>
                      <th><button onClick={() => handleSort('rsi')}>RSI {sortIcon('rsi')}</button></th>
                      <th><button onClick={() => handleSort('volume')}>Volume {sortIcon('volume')}</button></th>
                      <th><button onClick={() => handleSort('screenScore')}>Match {sortIcon('screenScore')}</button></th>
                      <th><button onClick={() => handleSort('expertScore')}>Signal {sortIcon('expertScore')}</button></th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedResults.map(result => {
                      const isExpanded = expandedTicker === result.ticker;
                      const signal = result.expertSignal;
                      return (
                        <Fragment key={result.ticker}>
                          <tr className={isExpanded ? 'is-expanded' : undefined}>
                            <td>
                              <button className="screeners-ticker" onClick={() => setExpandedTicker(isExpanded ? null : result.ticker)}>
                                <strong>{result.ticker.replace(/\.JK$/i, '')}</strong>
                                <span>{result.sector}</span>
                              </button>
                            </td>
                            <td>
                              <span className={`expert-signal expert-signal--${signal.action.toLowerCase()}`}>{signal.action}</span>
                              <small className="expert-conviction">{signal.conviction}</small>
                            </td>
                            <td>{formatPrice(result.metrics.price)}</td>
                            <td className={result.metrics.chg1d >= 0 ? 'is-positive' : 'is-negative'}>{signed(result.metrics.chg1d)}%</td>
                            <td>{formatNumber(result.metrics.rsi)}</td>
                            <td>{formatNumber(result.metrics.volumeRatio, 2)}{result.metrics.volumeRatio != null ? 'x' : ''}</td>
                            <td><strong>{result.screenScore}</strong><span className="screeners-score-denom">/100</span></td>
                            <td className={signal.score > 0 ? 'is-positive' : signal.score < 0 ? 'is-negative' : undefined}>{signed(signal.score, 0)}</td>
                            <td><button className="screeners-expand" onClick={() => setExpandedTicker(isExpanded ? null : result.ticker)} aria-expanded={isExpanded}>{isExpanded ? '−' : '+'}</button></td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${result.ticker}-details`} className="screeners-detail-row">
                              <td colSpan={9}>
                                <div className="screeners-detail">
                                  <div className="screeners-detail__evidence">
                                    <h3>Why this signal</h3>
                                    <ul>{signal.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
                                  </div>
                                  <div className="screeners-detail__plan">
                                    <h3>Risk-defined plan</h3>
                                    <dl>
                                      <div><dt>Status</dt><dd>{signal.status}</dd></div>
                                      <div><dt>Setup</dt><dd>{signal.plan.setup}</dd></div>
                                      <div><dt>Entry</dt><dd>{signal.plan.entryLabel}</dd></div>
                                      <div><dt>Stop</dt><dd>{formatPrice(signal.plan.stop)}</dd></div>
                                      <div><dt>Targets</dt><dd>{formatPrice(signal.plan.target1)} / {formatPrice(signal.plan.target2)}</dd></div>
                                      <div><dt>R/R</dt><dd>{signal.plan.riskReward != null ? `${signal.plan.riskReward.toFixed(2)}R` : '—'}</dd></div>
                                    </dl>
                                  </div>
                                  <div className="screeners-detail__quality">
                                    <h3>Quality & risk</h3>
                                    <p>Data completeness: <strong>{signal.dataQuality}%</strong></p>
                                    <p>Technical candle: {new Date(signal.asOf).toLocaleString()}</p>
                                    <p>{signal.plan.invalidation}</p>
                                    {signal.warnings.map(warning => <p className="screeners-warning" key={warning}>{warning}</p>)}
                                    <button type="button" onClick={() => router.push(`/dashboard/${encodeURIComponent(result.ticker)}`)}>Open full intelligence brief</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <footer className="screeners-results-footer">
                <span>Completed {new Date(response.meta.completedAt).toLocaleString()}</span>
                <span>{response.meta.skippedCount} unavailable symbols</span>
              </footer>
            </section>
          ) : (
            <section className="screeners-empty">
              <h2>No candidates met every filter</h2>
              <p>Try lowering minimum conviction, selecting any direction, or switching to deep coverage.</p>
            </section>
          )}
        </>
      )}

      {!response && !loading && !error && (
        <section className="screeners-empty screeners-empty--initial">
          <div className="screeners-empty__icon">⌁</div>
          <h2>Choose a screen and run it</h2>
          <p>Fast mode quote-screens the IDX universe and performs full technical enrichment on the strongest 60 candidates.</p>
        </section>
      )}
    </div>
  );
}

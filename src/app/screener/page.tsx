'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ScreenerDirection,
  ScreenerMode,
  ScreenerPreset,
  ScreenerResponse,
  ScreenerResult,
  ScreenerUniverse,
} from '@/shared/screener-contract';

type ConvictionFilter = 'LOW' | 'MEDIUM' | 'HIGH';
type SortKey = 'screenScore' | 'expertScore' | 'chg1d' | 'price' | 'rsi';
type SortDirection = 'asc' | 'desc';
type MarketTab = 'crypto' | 'us' | 'idx';

interface PresetMeta {
  value: ScreenerPreset;
  label: string;
  description: string;
}

const PRESETS: PresetMeta[] = [
  { value: 'momentum', label: 'Momentum', description: 'Sustained strength with participation' },
  { value: 'breakout', label: 'Breakout', description: 'Pressing highs, volume confirmed' },
  { value: 'rebound', label: 'Rebound', description: 'Recovering from a pullback or low' },
  { value: 'oversold', label: 'Oversold', description: 'Stretched weakness, reversal watch' },
  { value: 'downtrend', label: 'Downtrend', description: 'Weak trend, bearish continuation' },
  { value: 'near_52w_low', label: 'Near 52W Low', description: 'Trading near the 52-week floor' },
];

const MARKETS: Array<{ value: MarketTab; label: string; hint: string }> = [
  { value: 'us', label: 'US Stocks', hint: 'NYSE · Nasdaq' },
  { value: 'idx', label: 'ID Stocks', hint: 'IDX · .JK tickers' },
  { value: 'crypto', label: 'Crypto', hint: '24/7 · majors' },
];

const IDX_SECTORS = [
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

const US_SECTORS = [
  ['all', 'All markets'],
  ['technology', 'Technology'],
  ['finance', 'Finance'],
  ['healthcare', 'Healthcare'],
  ['energy', 'Energy'],
  ['consumer', 'Consumer'],
  ['industrial', 'Industrial'],
] as const;

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'screenScore', label: 'Best match' },
  { value: 'expertScore', label: 'Signal score' },
  { value: 'chg1d', label: '1-day change' },
  { value: 'price', label: 'Price' },
  { value: 'rsi', label: 'RSI' },
];

const CONFIG_KEY = 'boz_screeners_config_v1';

function formatNumber(value: number | null | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function formatPrice(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : 'n/a';
}

function signed(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function actionTone(action: string): 'buy' | 'sell' | 'watch' {
  const normalized = action.trim().toLowerCase();
  if (normalized === 'buy') return 'buy';
  if (normalized === 'sell') return 'sell';
  return 'watch';
}

function displayTicker(ticker: string, universe: ScreenerUniverse): string {
  if (universe === 'idx') return ticker.replace(/\.JK$/i, '');
  return ticker.replace(/-USD$/i, '');
}

function sortValue(result: ScreenerResult, key: SortKey): number {
  switch (key) {
    case 'price': return result.metrics.price;
    case 'chg1d': return result.metrics.chg1d;
    case 'rsi': return result.metrics.rsi ?? Number.NEGATIVE_INFINITY;
    case 'expertScore': return result.expertSignal.score;
    case 'screenScore':
    default: return result.screenScore;
  }
}

function toMarketTab(universe: ScreenerUniverse): MarketTab {
  if (universe === 'crypto') return 'crypto';
  if (universe === 'us' || universe === 'global') return 'us';
  return 'idx';
}

export default function ScreenersPage() {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const [market, setMarket] = useState<MarketTab>('us');
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
  const [search, setSearch] = useState('');
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Restore last-used configuration once, so returning feels continuous.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CONFIG_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Record<string, string>>;
      if (saved.market === 'us' || saved.market === 'idx' || saved.market === 'crypto') setMarket(saved.market);
      if (typeof saved.preset === 'string' && PRESETS.some(p => p.value === saved.preset)) {
        setPreset(saved.preset as ScreenerPreset);
      }
      if (typeof saved.sector === 'string') setSector(saved.sector);
      if (saved.direction === 'buy' || saved.direction === 'sell' || saved.direction === 'any') {
        setDirection(saved.direction);
      }
      if (saved.minimumConviction === 'LOW' || saved.minimumConviction === 'MEDIUM' || saved.minimumConviction === 'HIGH') {
        setMinimumConviction(saved.minimumConviction);
      }
      if (saved.mode === 'fast' || saved.mode === 'deep') setMode(saved.mode);
    } catch {
      // Saved preferences are optional.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify({
        market, preset, sector, direction, minimumConviction, mode,
      }));
    } catch {
      // Ignore persistence failures.
    }
  }, [market, preset, sector, direction, minimumConviction, mode]);

  const universe: ScreenerUniverse = market;
  const sectorOptions = market === 'idx' ? IDX_SECTORS : US_SECTORS;
  const activePreset = PRESETS.find(item => item.value === preset) ?? PRESETS[0];

  const switchMarket = (next: MarketTab) => {
    if (next === market || loading) return;
    abortRef.current?.abort();
    setMarket(next);
    setSector('all');
    setResponse(null);
    setError(null);
    setExpandedTicker(null);
  };

  const resetFilters = () => {
    if (loading) return;
    setPreset('momentum');
    setSector('all');
    setDirection('buy');
    setMinimumConviction('LOW');
    setMode('fast');
    setSortKey('screenScore');
    setSortDirection('desc');
    setSearch('');
  };

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
        sector: market === 'crypto' ? 'all' : sector,
        direction,
        minimumConviction,
        mode,
        universe: market,
      });
      const apiResponse = await fetch(`/api/idx/scan?${params.toString()}`, {
        signal: controller.signal,
      });
      const data = await apiResponse.json().catch(() => ({}));
      if (!apiResponse.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Scanner failed. Please try again.');
      }
      setResponse(data as ScreenerResponse);
      setHasRun(true);
    } catch (scanError) {
      if (controller.signal.aborted) return;
      setError(scanError instanceof Error ? scanError.message : 'Scanner failed. Please try again.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  const visibleResults = useMemo(() => {
    if (!response) return [];
    const query = search.trim().toLowerCase();
    const filtered = query
      ? response.results.filter(result =>
        result.ticker.toLowerCase().includes(query) ||
        result.name.toLowerCase().includes(query),
      )
      : [...response.results];
    return filtered.sort((left, right) => {
      const comparison = sortValue(left, sortKey) - sortValue(right, sortKey);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [response, search, sortDirection, sortKey]);

  const responseUniverse = response ? toMarketTab(response.query.universe ?? universe) : market;
  const summary = response?.summary ?? null;
  const isDefaultConfig =
    preset === 'momentum' && sector === 'all' && direction === 'buy' &&
    minimumConviction === 'LOW' && mode === 'fast';

  return (
    <div className="scn-page">
      <header className="scn-header">
        <div>
          <p className="scn-eyebrow">Market screeners</p>
          <h1>Find your next setup</h1>
          <p className="scn-sub">
            Pick a screen, run it against live quotes, and review each match with its evidence and trade plan.
          </p>
        </div>
        <p className="scn-disclaimer" title="Signals are deterministic technical reads, not forecasts">
          <i className="fa-solid fa-circle-info" aria-hidden="true" /> Research signal · not a forecast
        </p>
      </header>

      {/* Market tabs: underline style, no cards */}
      <div className="scn-tabs" role="tablist" aria-label="Market">
        {MARKETS.map(tab => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={market === tab.value}
            title={tab.hint}
            className={`scn-tab${market === tab.value ? ' is-active' : ''}`}
            onClick={() => switchMarket(tab.value)}
            disabled={loading}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Controls: one filter bar, screen dropdown plus segments */}
      <section className="scn-controls" aria-label="Screener controls">
        <div className="scn-controls__group">
          <h2 className="scn-label"><label htmlFor="scn-screen">Screen</label></h2>
          <div className="scn-screenrow">
            <select
              id="scn-screen"
              className="scn-select scn-select--screen"
              value={preset}
              onChange={event => setPreset(event.target.value as ScreenerPreset)}
              disabled={loading}
            >
              {PRESETS.map(item => (
                <option key={item.value} value={item.value}>
                  {item.label} - {item.description}
                </option>
              ))}
            </select>
            <i className="fa-solid fa-chevron-down scn-screenrow__icon" aria-hidden="true" />
          </div>
          <p className="scn-controls__desc">{activePreset.description}</p>
        </div>

        <div className="scn-controls__row">
          <div className="scn-field">
            <h2 className="scn-label" id="scn-direction-label">Direction</h2>
            <div className="scn-segment" role="radiogroup" aria-labelledby="scn-direction-label">
              {([
                { value: 'buy', label: 'Bullish' },
                { value: 'any', label: 'Any' },
                { value: 'sell', label: 'Bearish' },
              ] as Array<{ value: ScreenerDirection; label: string }>).map(option => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={direction === option.value}
                  className={`scn-segment__btn${direction === option.value ? ' is-active' : ''}`}
                  onClick={() => setDirection(option.value)}
                  disabled={loading}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="scn-field">
            <h2 className="scn-label" id="scn-conviction-label">Conviction</h2>
            <div className="scn-segment" role="radiogroup" aria-labelledby="scn-conviction-label">
              {([
                { value: 'LOW', label: 'Low+' },
                { value: 'MEDIUM', label: 'Med+' },
                { value: 'HIGH', label: 'High' },
              ] as Array<{ value: ConvictionFilter; label: string }>).map(option => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={minimumConviction === option.value}
                  className={`scn-segment__btn${minimumConviction === option.value ? ' is-active' : ''}`}
                  onClick={() => setMinimumConviction(option.value)}
                  disabled={loading}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {market !== 'crypto' && (
            <div className="scn-field scn-field--grow">
              <h2 className="scn-label"><label htmlFor="scn-sector">{market === 'idx' ? 'Sector' : 'Market'}</label></h2>
              <select
                id="scn-sector"
                className="scn-select"
                value={sector}
                onChange={event => setSector(event.target.value)}
                disabled={loading}
              >
                {sectorOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          )}

          <div className="scn-field">
            <h2 className="scn-label" id="scn-coverage-label">Coverage</h2>
            <div className="scn-segment scn-segment--split" role="radiogroup" aria-labelledby="scn-coverage-label">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'fast'}
                title="Top 60 candidates"
                className={`scn-segment__btn${mode === 'fast' ? ' is-active' : ''}`}
                onClick={() => setMode('fast')}
                disabled={loading}
              >
                Fast
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'deep'}
                title="Full universe · slower"
                className={`scn-segment__btn${mode === 'deep' ? ' is-active' : ''}`}
                onClick={() => setMode('deep')}
                disabled={loading}
              >
                Deep
              </button>
            </div>
          </div>

          <div className="scn-actions">
            <button
              type="button"
              className={`scn-run${loading ? ' is-cancel' : ''}`}
              onClick={handleScan}
            >
              {loading ? (
                <><span className="scn-spinner" aria-hidden="true" /> Cancel</>
              ) : (
                <><i className="fa-solid fa-magnifying-glass" aria-hidden="true" /> Run scan</>
              )}
            </button>
            <button
              type="button"
              className="scn-reset"
              onClick={resetFilters}
              disabled={loading || isDefaultConfig}
            >
              Reset
            </button>
          </div>
        </div>

        <p className="scn-controls__meta">
          {activePreset.label} · {direction === 'any' ? 'any direction' : direction === 'buy' ? 'bullish' : 'bearish'} ·{' '}
          {minimumConviction === 'LOW' ? 'Low+ conviction' : minimumConviction === 'MEDIUM' ? 'Medium+ conviction' : 'High conviction'}
          {mode === 'deep' ? ' · deep coverage (slower, one scan at a time)' : ' · fast coverage (top 60)'}
        </p>
      </section>

      {/* Results */}
      <section className="scn-results" aria-label="Screener results" aria-live="polite">
        {loading && (
          <div className="scn-status" aria-label="Scanning">
            <span className="scn-spinner scn-spinner--lg" aria-hidden="true" />
            <div>
              <strong>Screening {market === 'crypto' ? 'crypto majors' : market === 'us' ? 'US equities' : 'IDX equities'}…</strong>
              <p>Quote prefilter → 420-day indicators → chart structure → Expert Signal read.</p>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="scn-status scn-status--error" role="alert">
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            <div>
              <strong>Scan failed</strong>
              <p>{error}</p>
            </div>
            <button type="button" className="scn-retry" onClick={handleScan}>Retry</button>
          </div>
        )}

        {response && !loading && !error && summary && (
          <>
            {/* Summary strip: one line, not three cards */}
            <div className="scn-strip" aria-label="Scan summary">
              <strong>{response.results.length} {response.results.length === 1 ? 'match' : 'matches'}</strong>
              <span className="scn-strip__sep" aria-hidden="true">·</span>
              <span>{activePreset.label}</span>
              <span className="scn-strip__sep" aria-hidden="true">·</span>
              <span className="scn-strip__breadth">{summary.breadthSignal}</span>
              <span className="scn-strip__right">
                {summary.bullish} bull / {summary.bearish} bear / {summary.neutral} flat
                {' · '}{response.meta.enrichedCount} enriched · {response.meta.skippedCount} skipped
                {response.meta.cacheHit ? ' · cached' : ''}
                {response.meta.partial ? ' · partial' : ''}
              </span>
            </div>

            <div className="scn-toolbar">
              <div className="scn-search">
                <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Filter by ticker or name…"
                  aria-label="Filter results"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} aria-label="Clear filter">
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="scn-sort">
                <label className="scn-visually-hidden" htmlFor="scn-sort">Sort results</label>
                <select
                  id="scn-sort"
                  className="scn-select scn-select--compact"
                  value={sortKey}
                  onChange={event => setSortKey(event.target.value as SortKey)}
                >
                  {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <button
                  type="button"
                  className="scn-sortdir"
                  onClick={() => setSortDirection(current => current === 'asc' ? 'desc' : 'asc')}
                  title={sortDirection === 'asc' ? 'Ascending (switch to descending)' : 'Descending (switch to ascending)'}
                  aria-label="Toggle sort direction"
                >
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>

            {visibleResults.length > 0 ? (
              <div className="scn-table">
                <div className="scn-thead" aria-hidden="true">
                  <span className="scn-col scn-col--id">Ticker</span>
                  <span className="scn-col scn-col--num">Price</span>
                  <span className="scn-col scn-col--num">1D</span>
                  <span className="scn-col scn-col--num">RSI</span>
                  <span className="scn-col scn-col--num">Vol</span>
                  <span className="scn-col scn-col--num">Match</span>
                  <span className="scn-col scn-col--signal">Signal</span>
                  <span className="scn-col scn-col--num">To T1</span>
                  <span className="scn-col scn-col--go"><span className="scn-visually-hidden">Actions</span></span>
                </div>
                <ol className="scn-rows">
                  {visibleResults.map(result => {
                    const signal = result.expertSignal;
                    const isExpanded = expandedTicker === result.ticker;
                    const tone = actionTone(signal.action);
                    const entry = signal.plan.entry ?? result.metrics.price;
                    const upside = entry > 0 && signal.plan.target1 != null
                      ? ((signal.plan.target1 - entry) / entry) * 100
                      : null;
                    const down1d = result.metrics.chg1d < 0;
                    return (
                      <li key={result.ticker} className={`scn-row scn-row--${tone}${isExpanded ? ' is-open' : ''}`}>
                        <span className="scn-row__rail" aria-hidden="true" />
                        <div className="scn-row__grid">
                          <button
                            type="button"
                            className="scn-row__id"
                            onClick={() => setExpandedTicker(isExpanded ? null : result.ticker)}
                            aria-expanded={isExpanded}
                            aria-label={`${displayTicker(result.ticker, responseUniverse)}, ${isExpanded ? 'hide' : 'show'} evidence`}
                          >
                            <strong>{displayTicker(result.ticker, responseUniverse)}</strong>
                            <span>{result.name}</span>
                          </button>
                          <span className="scn-col scn-col--num">{formatPrice(result.metrics.price)}</span>
                          <span className={`scn-col scn-col--num${down1d ? ' is-negative' : ' is-positive'}`}>
                            {signed(result.metrics.chg1d)}%
                          </span>
                          <span className="scn-col scn-col--num">{formatNumber(result.metrics.rsi, 0)}</span>
                          <span className="scn-col scn-col--num">{formatNumber(result.metrics.volumeRatio, 1)}x</span>
                          <span className="scn-col scn-col--num scn-match" title={`Screen match ${result.screenScore}/100`}>
                            <span className="scn-match__bar" aria-hidden="true">
                              <span style={{ width: `${Math.max(0, Math.min(100, result.screenScore))}%` }} />
                            </span>
                            {result.screenScore}
                          </span>
                          <span className="scn-col scn-col--signal">
                            <span className={`scn-action scn-action--${tone}`}>{signal.action}</span>
                            <span className="scn-signal__sub">{signal.conviction} · {signed(signal.score, 0)}</span>
                          </span>
                          <span className={`scn-col scn-col--num${upside == null ? '' : upside >= 0 ? ' is-positive' : ' is-negative'}`}>
                            {upside != null ? `${signed(upside, 1)}%` : 'n/a'}
                          </span>
                          <span className="scn-col scn-col--go">
                            <button
                              type="button"
                              className="scn-chevron"
                              onClick={() => setExpandedTicker(isExpanded ? null : result.ticker)}
                              aria-expanded={isExpanded}
                              aria-label={isExpanded ? 'Hide evidence' : 'Show evidence'}
                            >
                              <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}`} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="scn-open"
                              onClick={() => router.push(`/dashboard/${encodeURIComponent(result.ticker)}`)}
                              aria-label={`Open brief for ${displayTicker(result.ticker, responseUniverse)}`}
                              title="Open brief"
                            >
                              <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                            </button>
                          </span>
                        </div>

                        {isExpanded && (
                          <div className="scn-detail">
                            <p className="scn-detail__meta">
                              {signal.conviction} conviction · {selectedPresetLabel(activePreset.label)} screen · updated {timeAgo(signal.asOf)} ·{' '}
                              {signal.dataQuality}% data quality · {signal.status}
                            </p>
                            <section aria-label="Why this signal">
                              <h3>Why this signal</h3>
                              <ul>{signal.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
                            </section>
                            <section aria-label="Trade plan">
                              <h3>Trade plan</h3>
                              <dl className="scn-kv">
                                <div><dt>Setup</dt><dd>{signal.plan.setup}</dd></div>
                                <div><dt>Entry</dt><dd>{signal.plan.entry != null ? formatPrice(signal.plan.entry) : signal.plan.entryLabel}</dd></div>
                                <div><dt>Target 1</dt><dd>{formatPrice(signal.plan.target1)}</dd></div>
                                <div><dt>Target 2</dt><dd>{formatPrice(signal.plan.target2)}</dd></div>
                                <div><dt>Stop</dt><dd>{formatPrice(signal.plan.stop)}</dd></div>
                                <div>
                                  <dt>Risk / reward</dt>
                                  <dd>{signal.plan.riskReward != null ? `${signal.plan.riskReward.toFixed(2)}R` : 'n/a'}</dd>
                                </div>
                                <div><dt>Invalidation</dt><dd>{signal.plan.invalidation}</dd></div>
                              </dl>
                            </section>
                            <section aria-label="Risk">
                              <h3>Risk</h3>
                              <p>Candle: {new Date(signal.asOf).toLocaleString()}</p>
                              {signal.warnings.length > 0
                                ? signal.warnings.map(warning => <p className="scn-warning" key={warning}>{warning}</p>)
                                : <p className="scn-muted">No blocking warnings on the last read.</p>}
                              <button
                                type="button"
                                className="scn-brief"
                                onClick={() => router.push(`/dashboard/${encodeURIComponent(result.ticker)}`)}
                              >
                                Open full brief <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                              </button>
                            </section>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : (
              <div className="scn-empty">
                <i className="fa-solid fa-filter-circle-xmark" aria-hidden="true" />
                <h2>{search ? 'No matches for that filter' : 'No candidates met every filter'}</h2>
                <p>
                  {search
                    ? `Nothing in this scan matches “${search.trim()}”. Clear the filter to see all ${response.results.length} matches.`
                    : 'Try lowering conviction, selecting any direction, or switching to deep coverage.'}
                </p>
                {search ? (
                  <button type="button" className="scn-ghostbtn" onClick={() => setSearch('')}>Clear filter</button>
                ) : (
                  <button type="button" className="scn-ghostbtn" onClick={resetFilters}>Reset filters</button>
                )}
              </div>
            )}

            <footer className="scn-foot">
              <span>Completed {new Date(response.meta.completedAt).toLocaleString()}</span>
              <span>{response.meta.skippedCount} unavailable · {response.meta.partial ? 'partial coverage' : 'full coverage'}</span>
            </footer>
          </>
        )}

        {!response && !loading && !error && (
          <div className="scn-empty scn-empty--start">
            <i className="fa-solid fa-radar" aria-hidden="true" />
            <h2>{hasRun ? 'Ready for the next scan' : `Run your first ${market === 'crypto' ? 'crypto' : market === 'us' ? 'US' : 'IDX'} screen`}</h2>
            <p>
              {activePreset.label} · {direction === 'any' ? 'any direction' : direction === 'buy' ? 'bullish' : 'bearish'} ·{' '}
              {mode === 'fast' ? 'fast coverage over the top 60 candidates' : 'deep coverage over the full universe'}.
              Use Run scan above to begin.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function selectedPresetLabel(label: string): string {
  return label;
}

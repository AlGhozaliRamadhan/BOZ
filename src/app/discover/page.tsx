'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import searchStyles from '../ticker/[ticker]/TickerPage.module.css';
import styles from './DiscoverPage.module.css';
import {
  loadRecentTickers,
  recordRecentTicker,
} from '@/shared/discover';
import type { ScreenerResult } from '@/shared/screener-contract';

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

interface TapeQuote {
  price: number | null;
  changePercent: number | null;
}

type MarketTab = 'us' | 'crypto' | 'idx';

const TAPE: Array<{ symbol: string; label: string }> = [
  { symbol: '^VIX', label: 'VOLATILITY' },
  { symbol: 'BTC-USD', label: 'BITCOIN' },
  { symbol: 'ETH-USD', label: 'ETHEREUM' },
  { symbol: 'GC=F', label: 'GOLD' },
  { symbol: '^TNX', label: 'US 10Y' },
  { symbol: '^JKSE', label: 'IHSG' },
];

const TABS: Array<{ value: MarketTab; label: string }> = [
  { value: 'us', label: 'US Stocks' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'idx', label: 'IDX Stocks' },
];

const PAGE_SIZE = 15;

function displayTicker(ticker: string, tab: MarketTab): string {
  if (tab === 'idx') return ticker.replace(/\.JK$/i, '');
  return ticker.replace(/-USD$/i, '');
}

function formatPrice(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : '—';
}

function signed(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function setupLabel(preset: string): string {
  switch (preset) {
    case 'near_52w_low':
      return '52W LOW';
    default:
      return preset.replace(/_/g, ' ').toUpperCase();
  }
}

export default function DiscoverPage() {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  const [tickerInput, setTickerInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const [tape, setTape] = useState<Record<string, TapeQuote>>({});
  const [tab, setTab] = useState<MarketTab>('us');
  const [rows, setRows] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [scanMeta, setScanMeta] = useState<string>('');

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  const openTicker = useCallback(
    (symbol: string) => {
      const clean = symbol.trim().toUpperCase();
      if (!clean) return;
      try {
        recordRecentTicker(window.localStorage, clean);
      } catch {
        // Best-effort only.
      }
      setShowDropdown(false);
      router.push(`/ticker/${encodeURIComponent(clean)}`);
    },
    [router],
  );

  // Index tape — one parallel quote round, refreshed while visible.
  useEffect(() => {
    let cancelled = false;
    const fetchTape = () => {
      if (document.visibilityState !== 'visible') return;
      TAPE.forEach(({ symbol }) => {
        fetch(`/api/market/quote?ticker=${encodeURIComponent(symbol)}`)
          .then(res => (res.ok ? res.json() : null))
          .then(data => {
            if (!cancelled && data && typeof data.price === 'number') {
              setTape(prev => ({
                ...prev,
                [symbol]: { price: data.price, changePercent: data.changePercent ?? null },
              }));
            }
          })
          .catch(() => {});
      });
    };
    fetchTape();
    const id = setInterval(fetchTape, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Favorites + recents.
  useEffect(() => {
    const load = () => {
      try {
        const favs = JSON.parse(window.localStorage.getItem('boz_favorites') || '[]');
        setFavorites(Array.isArray(favs) ? favs.filter((t: unknown): t is string => typeof t === 'string') : []);
        setRecent(loadRecentTickers(window.localStorage));
      } catch {
        setFavorites([]);
        setRecent([]);
      }
    };
    load();
    window.addEventListener('boz_favorites_changed', load);
    return () => window.removeEventListener('boz_favorites_changed', load);
  }, []);

  // Favorites stay read-only here: the watchlist itself lives on the
  // Dashboard. Discover only reflects star state so tickers can be added.
  const toggleFavorite = (e: React.MouseEvent, ticker: string) => {
    e.stopPropagation();
    try {
      const favs: string[] = JSON.parse(window.localStorage.getItem('boz_favorites') || '[]');
      const next = favs.includes(ticker) ? favs.filter(t => t !== ticker) : [...favs, ticker];
      window.localStorage.setItem('boz_favorites', JSON.stringify(next));
      window.dispatchEvent(new Event('boz_favorites_changed'));
    } catch {
      // Storage failures leave the list as-is.
    }
  };

  // Market board — one tab fans out across four screener lenses and merges
  // them, so the board holds the whole market picture instead of a single
  // preset's matches. Partial failures are tolerated (allSettled).
  const runScan = useCallback(async (market: MarketTab) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const lenses = ['momentum', 'breakout', 'rebound', 'oversold'];
      const settled = await Promise.allSettled(
        lenses.map(async lens => {
          const params = new URLSearchParams({
            preset: lens,
            sector: 'all',
            direction: 'any',
            minimumConviction: 'LOW',
            mode: 'fast',
            universe: market,
          });
          const res = await fetch(`/api/idx/scan?${params.toString()}`, { signal: controller.signal });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Scan failed');
          return Array.isArray(data?.results) ? (data.results as ScreenerResult[]) : [];
        }),
      );
      if (controller.signal.aborted) return;
      const byTicker = new Map<string, ScreenerResult>();
      let okLenses = 0;
      let cached = 0;
      settled.forEach((s, i) => {
        if (s.status !== 'fulfilled') return;
        okLenses++;
        // Second+ lens responses are usually cache-warmed; count roughly.
        if (i > 0) cached++;
        s.value.forEach(r => {
          const prev = byTicker.get(r.ticker);
          if (!prev || r.screenScore > prev.screenScore) byTicker.set(r.ticker, r);
        });
      });
      if (okLenses === 0) throw new Error('All four screens failed. Please try again.');
      const merged = [...byTicker.values()].sort((a, b) => b.screenScore - a.screenScore);
      setRows(merged);
      setPage(0);
      setScanMeta(
        `${merged.length} tickers · ${okLenses}/4 screens${okLenses < 4 ? ' · partial' : ''}${cached > 0 ? ' · cached' : ''}`,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Scan failed');
      setRows([]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runScan(tab);
    setFilter('');
    setPage(0);
    return () => abortRef.current?.abort();
  }, [tab, runScan]);

  // Ticker search autocomplete.
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (tickerInput.trim() && showDropdown) {
        setIsSearching(true);
        try {
          const res = await fetch(`/api/market/search?q=${encodeURIComponent(tickerInput.trim())}`);
          if (res.ok) {
            const data = await res.json();
            setSearchResults(Array.isArray(data) ? data.slice(0, 6) : []);
          }
        } catch {
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [tickerInput, showDropdown]);

  const query = filter.trim().toLowerCase();
  const visible = query
    ? rows.filter(r => r.ticker.toLowerCase().includes(query) || r.name.toLowerCase().includes(query))
    : rows;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const renderSkeletonRows = () => (
    <div className={styles['discover-table']} aria-label="Loading board" aria-busy="true">
      <div className={styles['discover-thead']} aria-hidden="true">
        <span>Ticker</span>
        <span>Price</span>
        <span>1D</span>
        <span className={styles['discover-hide-mobile']}>RSI</span>
        <span className={styles['discover-hide-mobile']}>Vol</span>
        <span>Signal</span>
        <span className={styles['discover-setup']}>Setup</span>
        <span></span>
        <span></span>
      </div>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className={styles['discover-row']} aria-hidden="true">
          <div className={styles['discover-row-grid']}>
            <span className={styles['discover-cell-id']}>
              <span className={searchStyles['skel']} style={{ width: '64px', height: '14px' }}></span>
              <span className={searchStyles['skel']} style={{ width: '110px', height: '10px', marginTop: '6px' }}></span>
            </span>
            <span className={styles['discover-num']}>
              <span className={searchStyles['skel']} style={{ width: '52px', height: '13px' }}></span>
            </span>
            <span className={styles['discover-num']}>
              <span className={searchStyles['skel']} style={{ width: '48px', height: '13px' }}></span>
            </span>
            <span className={`${styles['discover-num']} ${styles['discover-hide-mobile']}`}>
              <span className={searchStyles['skel']} style={{ width: '30px', height: '13px' }}></span>
            </span>
            <span className={`${styles['discover-num']} ${styles['discover-hide-mobile']}`}>
              <span className={searchStyles['skel']} style={{ width: '40px', height: '13px' }}></span>
            </span>
            <span>
              <span className={searchStyles['skel']} style={{ width: '56px', height: '18px' }}></span>
            </span>
            <span className={styles['discover-setup']}>
              <span className={searchStyles['skel']} style={{ width: '70px', height: '11px' }}></span>
            </span>
            <span></span>
            <span></span>
          </div>
        </div>
      ))}
    </div>
  );

  const renderRow = (r: ScreenerResult, activeTab: MarketTab) => {
    const action = r.expertSignal.action;
    const tone = action === 'BUY' ? 'is-buy' : action === 'SELL' ? 'is-sell' : 'is-watch';
    const chg = r.metrics.chg1d;
    const saved = favorites.includes(r.ticker);
    return (
      <div key={r.ticker} className={styles['discover-row']}>
        <button
          type="button"
          className={styles['discover-row-grid']}
          onClick={() => openTicker(r.ticker)}
          aria-label={`Open brief for ${displayTicker(r.ticker, activeTab)}`}
        >
          <span className={styles['discover-cell-id']}>
            <strong>{displayTicker(r.ticker, activeTab)}</strong>
            <span>{r.name}</span>
          </span>
          <span className={styles['discover-num']}>{formatPrice(r.metrics.price)}</span>
          <span className={`${styles['discover-num']}${chg >= 0 ? ' is-up' : ' is-down'}`}>{signed(chg)}</span>
          <span className={`${styles['discover-num']} ${styles['discover-hide-mobile']}`}>
            {r.metrics.rsi != null ? r.metrics.rsi.toFixed(0) : '—'}
          </span>
          <span className={`${styles['discover-num']} ${styles['discover-hide-mobile']}`}>
            {r.metrics.volumeRatio != null ? `${r.metrics.volumeRatio.toFixed(1)}x` : '—'}
          </span>
          <span>
            <span className={`${styles['discover-signal']} ${tone}`}>{action}</span>
          </span>
          <span className={`${styles['discover-setup']}`} title={`Matched screen: ${r.matchedPreset}`}>
            {setupLabel(r.matchedPreset)}
          </span>
          <span>
            <span
              role="button"
              tabIndex={0}
              aria-label={saved ? `Remove ${r.ticker} from watchlist` : `Add ${r.ticker} to watchlist`}
              title={saved ? 'Remove from watchlist' : 'Add to watchlist'}
              className={`${styles['discover-star']}${saved ? ' is-saved' : ''}`}
              onClick={e => toggleFavorite(e, r.ticker)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleFavorite(e as unknown as React.MouseEvent, r.ticker);
                }
              }}
            >
              <i className={`${saved ? 'fa-solid' : 'fa-regular'} fa-star`} aria-hidden="true"></i>
            </span>
          </span>
          <span className={styles['discover-go']}>›</span>
        </button>
      </div>
    );
  };

  return (
    <div className={styles['discover-page']}>
      <header className={`bbg-header ${searchStyles['ticker-page-header']}`}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-violet)', fontSize: '14px', fontWeight: 700, margin: 0, letterSpacing: '0.05em' }}>DISCOVER</h1>
          <p style={{ fontFamily: 'var(--font-mono)', color: '#555', fontSize: '10px', marginTop: '2px', textTransform: 'uppercase' }}>MARKETS · TICKERS · IDEAS</p>
        </div>
        <div className={searchStyles['ticker-search']}>
          <form
            onSubmit={e => {
              e.preventDefault();
              if (!tickerInput.trim()) return;
              const pick =
                showDropdown && searchResults.length > 0
                  ? searchResults[0].symbol.toUpperCase()
                  : tickerInput.trim().toUpperCase();
              openTicker(pick);
            }}
            className={searchStyles['ticker-search__form']}
            role="search"
          >
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input
              type="text"
              aria-label="Search ticker or asset"
              placeholder="Search ticker or asset"
              value={tickerInput}
              onChange={e => {
                setTickerInput(e.target.value);
                setShowDropdown(e.target.value.trim() !== '');
              }}
              onFocus={() => {
                if (tickerInput.trim() !== '') setShowDropdown(true);
              }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              className={searchStyles['ticker-search__input']}
            />
            <button type="submit" className={searchStyles['ticker-search__submit']}>GO <span aria-hidden="true">↗</span></button>
          </form>
          {showDropdown && tickerInput.trim() !== '' && (
            <div className={searchStyles['ticker-search__results']}>
              {isSearching ? (
                <div className={searchStyles['ticker-search__message']}>SEARCHING...</div>
              ) : searchResults.length > 0 ? (
                searchResults.map((result, i) => (
                  <button
                    type="button"
                    key={result.symbol + i}
                    className={searchStyles['ticker-search__result']}
                    onClick={() => openTicker(result.symbol)}
                  >
                    <span className={searchStyles['ticker-search__symbol']}>{result.symbol}</span>
                    <span className={searchStyles['ticker-search__name']}>{result.name}</span>
                    <span className={searchStyles['ticker-search__exchange']}>{result.exchange}</span>
                  </button>
                ))
              ) : (
                <div className={searchStyles['ticker-search__message']}>NO RESULTS</div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Market snapshot — cross-asset only. US equity indices live
          in the US Stocks board below, so they are not repeated here. */}
      <h2 className={styles['discover-section-title']}>MARKET SNAPSHOT</h2>
      <div className={styles['discover-tape']} aria-label="Market snapshot">
        {TAPE.map(({ symbol, label }) => {
          const q = tape[symbol];
          const chg = q?.changePercent;
          const up = (chg ?? 0) >= 0;
          return (
            <button key={symbol} type="button" className={styles['discover-tape-card']} onClick={() => openTicker(symbol)}>
              <div className={styles['discover-tape-label']}>{label}</div>
              <div className={styles['discover-tape-price']}>
                {q && typeof q.price === 'number' ? (
                  q.price.toLocaleString(undefined, { maximumFractionDigits: q.price < 100 ? 2 : 1 })
                ) : (
                  <span className={searchStyles['skel']} style={{ width: '72px', height: '17px' }}></span>
                )}
              </div>
              <div className={`${styles['discover-tape-change']}${typeof chg === 'number' ? (up ? ' is-up' : ' is-down') : ''}`}>
                {typeof chg === 'number' ? (
                  `${up ? '▲' : '▼'} ${signed(chg)}`
                ) : (
                  <span className={searchStyles['skel']} style={{ width: '52px', height: '12px' }}></span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Market board */}
      <div className={styles['discover-tabs']} role="tablist" aria-label="Market">
        {TABS.map(t => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            className={`${styles['discover-tab']}${tab === t.value ? ' is-active' : ''}`}
            onClick={() => setTab(t.value)}
            disabled={loading}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles['discover-board-head']}>
        <h2 className={styles['discover-section-title']} style={{ margin: 0 }}>
          MARKET BOARD · {TABS.find(t => t.value === tab)?.label.toUpperCase()}
        </h2>
        <div className={styles['discover-filter']}>
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input
            type="search"
            value={filter}
            onChange={e => {
              setFilter(e.target.value);
              setPage(0);
            }}
            placeholder="Filter this board…"
            aria-label="Filter board results"
          />
        </div>
      </div>

      {error && !loading && (
        <div className={styles['discover-error']} role="alert">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <span>Board failed to load — {error}</span>
          <button type="button" className={styles['discover-retry']} onClick={() => runScan(tab)}>Retry</button>
        </div>
      )}

      {loading ? (
        renderSkeletonRows()
      ) : (
        visible.length > 0 && (
          <div className={styles['discover-table']} aria-label="Market board results">
            <div className={styles['discover-thead']} aria-hidden="true">
              <span>Ticker</span>
              <span>Price</span>
              <span>1D</span>
              <span className={styles['discover-hide-mobile']}>RSI</span>
              <span className={styles['discover-hide-mobile']}>Vol</span>
              <span>Signal</span>
              <span className={styles['discover-setup']}>Setup</span>
              <span>
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Watchlist</span>
              </span>
              <span>
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Open</span>
              </span>
            </div>
            {paged.map(r => renderRow(r, tab))}
            <div className={styles['discover-foot']}>
              <span>{scanMeta}</span>
              {pageCount > 1 && (
                <span className={styles['discover-pager']} role="navigation" aria-label="Board pages">
                  <button
                    type="button"
                    className={styles['discover-page-btn']}
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  {Array.from({ length: pageCount }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`${styles['discover-page-btn']}${i === safePage ? ' is-current' : ''}`}
                      onClick={() => setPage(i)}
                      aria-label={`Page ${i + 1}`}
                      aria-current={i === safePage ? 'page' : undefined}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles['discover-page-btn']}
                    onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                    disabled={safePage === pageCount - 1}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </span>
              )}
              <button type="button" className={styles['discover-link']} onClick={() => router.push('/screener')}>
                Open full screener →
              </button>
            </div>
          </div>
        )
      )}

      {!loading && !error && visible.length === 0 && (
        <div className={styles['discover-status']}>
          {filter ? `Nothing on this board matches “${filter.trim()}”.` : 'No candidates on this board right now.'}
        </div>
      )}

      {/* Recently viewed */}
      {recent.length > 0 && (
        <section aria-label="Recently viewed" style={{ marginTop: 'var(--space-6)' }}>
          <h2 className={styles['discover-section-title']}>RECENTLY VIEWED</h2>
          <div className={styles['discover-chips']}>
            {recent.map(t => (
              <button key={t} type="button" className={styles['discover-chip']} onClick={() => openTicker(t)}>
                {t}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

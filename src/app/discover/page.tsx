'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import searchStyles from '../ticker/[ticker]/TickerPage.module.css';
import styles from './DiscoverPage.module.css';
import {
  loadRecentTickers,
  recordRecentTicker,
} from '@/shared/discover';
import { pageWindow, type PageToken } from '@/shared/pagination';
import { SYMBOL_MARKET_LABEL, type SymbolMarket } from '@/shared/symbol-search';
import { formatFxRate, fxDisplaySymbol, parseFxSymbol } from '@/shared/fx';
import { useLoadMoreOnScroll, useSymbolSearch } from '@/app/lib/hooks';
import type { ScreenerResult } from '@/shared/screener-contract';

interface TapeQuote {
  price: number | null;
  changePercent: number | null;
}

type MarketTab = 'us' | 'crypto' | 'idx' | 'forex';

const TAPE: Array<{ symbol: string; label: string }> = [
  { symbol: '^VIX', label: 'VOLATILITY' },
  { symbol: 'BTC-USD', label: 'BITCOIN' },
  { symbol: 'ETH-USD', label: 'ETHEREUM' },
  { symbol: 'GC=F', label: 'GOLD' },
  { symbol: '^TNX', label: 'US 10Y' },
  { symbol: '^JKSE', label: 'IHSG' },
  { symbol: 'EURUSD=X', label: 'EUR/USD' },
  { symbol: 'IDR=X', label: 'USD/IDR' },
];

const TABS: Array<{ value: MarketTab; label: string }> = [
  { value: 'us', label: 'US Stocks' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'idx', label: 'IDX Stocks' },
  { value: 'forex', label: 'Forex' },
];

const PAGE_SIZE = 15;

function displayTicker(ticker: string, tab: MarketTab): string {
  if (tab === 'forex') return fxDisplaySymbol(ticker);
  if (tab === 'idx') return ticker.replace(/\.JK$/i, '');
  return ticker.replace(/-USD$/i, '');
}

function formatPrice(value: number | null | undefined, ticker: string, tab: MarketTab): string {
  // A rate needs its own precision: 1.09 is not a EUR/USD quote.
  if (tab === 'forex') return formatFxRate(ticker, value);
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
  const [showDropdown, setShowDropdown] = useState(false);

  const [tape, setTape] = useState<Record<string, TapeQuote>>({});
  const [tab, setTab] = useState<MarketTab>('us');
  const [rows, setRows] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [scanMeta, setScanMeta] = useState<string>('');
  const [pageCount, setPageCount] = useState(1);
  const [hasMorePage, setHasMorePage] = useState(false);

  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  // Symbol search loads a page at a time and keeps fetching on demand, so the
  // dropdown no longer stops at a pre-truncated top-N.
  const symbolSearch = useSymbolSearch(tickerInput, { enabled: showDropdown });
  const searchLoadMoreRef = useLoadMoreOnScroll(
    symbolSearch.hasMore,
    symbolSearch.isSearching || symbolSearch.isLoadingMore,
    symbolSearch.loadMore,
  );

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

  // Market board — four screener lenses are merged SERVER-SIDE and enriched one
  // page at a time. The board previously fired four full scans and waited for
  // every chart call before painting anything; now page 1 arrives as soon as
  // its own rows are ready, and the pager pulls only the page you click.
  const LENSES = 'momentum,breakout,rebound,oversold';

  const loadPage = useCallback(async (market: MarketTab, pageIndex: number) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        presets: LENSES,
        sector: 'all',
        direction: 'any',
        minimumConviction: 'LOW',
        mode: 'fast',
        universe: market,
        page: String(pageIndex),
        pageSize: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/idx/scan?${params.toString()}`, { signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Scan failed');

      const results = Array.isArray(data?.results) ? (data.results as ScreenerResult[]) : [];
      const meta = (data?.meta ?? {}) as {
        universeCount?: number;
        candidateCount?: number;
        enrichedCount?: number;
        hasMore?: boolean;
      };

      setRows(results);
      setPage(pageIndex);
      setPageCount(Math.max(1, meta.candidateCount ?? 0));
      setHasMorePage(meta.hasMore === true);
      setScanMeta(
        `${results.length} shown · ${meta.universeCount ?? 0} scanned · ${meta.candidateCount ?? 0} candidates`
        + `${meta.hasMore ? ' · more available' : ''}`,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Scan failed');
      setRows([]);
      setPageCount(1);
      setHasMorePage(false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setFilter('');
    void loadPage(tab, 0);
    return () => abortRef.current?.abort();
  }, [tab, loadPage]);

  const query = filter.trim().toLowerCase();
  const visible = query
    ? rows.filter(r => r.ticker.toLowerCase().includes(query) || r.name.toLowerCase().includes(query))
    : rows;
  // `visible` is already the requested page: the server enriches and slices it.
  // The text filter narrows within that page only.
  const safePage = page;
  const paged = visible;
  const pagerTokens = useMemo(() => pageWindow(safePage + 1, pageCount), [safePage, pageCount]);
  const goToPage = useCallback((next: number) => {
    const clamped = Math.min(Math.max(0, next), Math.max(0, pageCount - 1));
    void loadPage(tab, clamped);
  }, [loadPage, pageCount, tab]);

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
          <span className={styles['discover-num']}>{formatPrice(r.metrics.price, r.ticker, activeTab)}</span>
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
          <p style={{ fontFamily: 'var(--font-mono)', color: '#555564', fontSize: '10px', marginTop: '2px', textTransform: 'uppercase' }}>MARKETS · TICKERS · IDEAS</p>
        </div>
        <div className={searchStyles['ticker-search']}>
          <form
            onSubmit={e => {
              e.preventDefault();
              if (!tickerInput.trim()) return;
              const pick =
                showDropdown && symbolSearch.results.length > 0
                  ? symbolSearch.results[0].symbol.toUpperCase()
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
              {symbolSearch.isSearching ? (
                <div className={searchStyles['ticker-search__message']}>SEARCHING...</div>
              ) : symbolSearch.results.length > 0 ? (
                <>
                  {symbolSearch.results.map((result, i) => (
                    <button
                      type="button"
                      key={result.symbol + i}
                      className={searchStyles['ticker-search__result']}
                      onClick={() => openTicker(result.symbol)}
                    >
                      <span className={searchStyles['ticker-search__symbol']}>{result.symbol}</span>
                      <span className={searchStyles['ticker-search__name']}>{result.name}</span>
                      <span className={searchStyles['ticker-search__exchange']}>
                        <span className={searchStyles['ticker-search__market']}>
                          {SYMBOL_MARKET_LABEL[(result.market as SymbolMarket) ?? 'other']}
                        </span>
                        {result.exchange}
                      </span>
                    </button>
                  ))}
                  <div ref={searchLoadMoreRef} />
                  {symbolSearch.hasMore && (
                    <button
                      type="button"
                      className={searchStyles['ticker-search__more']}
                      onClick={symbolSearch.loadMore}
                      disabled={symbolSearch.isLoadingMore}
                    >
                      {symbolSearch.isLoadingMore
                        ? 'LOADING...'
                        : `LOAD MORE · ${symbolSearch.results.length}/${symbolSearch.total}`}
                    </button>
                  )}
                </>
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
                  parseFxSymbol(symbol)
                    ? formatFxRate(symbol, q.price)
                    : q.price.toLocaleString(undefined, { maximumFractionDigits: q.price < 100 ? 2 : 1 })
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
            }}
            placeholder="Filter this page…"
            aria-label="Filter the current page of board results"
          />
        </div>
      </div>

      {error && !loading && (
        <div className={styles['discover-error']} role="alert">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <span>Board failed to load — {error}</span>
          <button type="button" className={styles['discover-retry']} onClick={() => loadPage(tab, 0)}>Retry</button>
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
                    onClick={() => goToPage(safePage - 1)}
                    disabled={safePage === 0}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  {pagerTokens.map((token: PageToken, i: number) => (
                    token === 'gap' ? (
                      <span key={`gap-${i}`} className={styles['discover-page-gap']} aria-hidden="true">…</span>
                    ) : (
                      <button
                        key={token}
                        type="button"
                        className={`${styles['discover-page-btn']}${token - 1 === safePage ? ' is-current' : ''}`}
                        onClick={() => goToPage(token - 1)}
                        aria-label={`Page ${token}`}
                        aria-current={token - 1 === safePage ? 'page' : undefined}
                      >
                        {token}
                      </button>
                    )
                  ))}
                  <button
                    type="button"
                    className={styles['discover-page-btn']}
                    onClick={() => goToPage(safePage + 1)}
                    disabled={!hasMorePage || safePage >= pageCount - 1}
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
          {filter ? `Nothing on this page matches “${filter.trim()}”.` : 'No candidates on this page right now.'}
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

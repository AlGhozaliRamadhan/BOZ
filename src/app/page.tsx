'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './ticker/[ticker]/TickerPage.module.css';
import { findBigMovers, loadRecentTickers } from '@/shared/discover';

interface Quote {
  price?: number;
  change?: number;
  changePercent?: number;
}

const MARKET_NOW = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'Nasdaq 100' },
  { symbol: 'BTC-USD', label: 'Bitcoin' },
  { symbol: 'NVDA', label: 'Nvidia' },
];

export default function HomePage() {
  const router = useRouter();

  // Favorites logic (same storage + two-step remove as before).
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteQuotes, setFavoriteQuotes] = useState<Record<string, Quote>>({});
  const [marketQuotes, setMarketQuotes] = useState<Record<string, Quote>>({});
  const [removingFavorite, setRemovingFavorite] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState(0);

  const removeFavorite = (ticker: string) => {
    if (removingFavorite) return;
    setRemovingFavorite(ticker);
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('boz_favorites') || '[]');
      const next = Array.isArray(stored) ? stored.filter((t: unknown) => t !== ticker) : [];
      localStorage.setItem('boz_favorites', JSON.stringify(next));
      setFavorites(next.filter((t: unknown): t is string => typeof t === 'string'));
      setFavoriteQuotes(prev => {
        const rest = { ...prev };
        delete rest[ticker];
        return rest;
      });
      window.dispatchEvent(new Event('boz_favorites_changed'));
    } catch {
      localStorage.setItem('boz_favorites', '[]');
      setFavorites([]);
    } finally {
      setRemovingFavorite(null);
      setConfirmRemove(null);
    }
  };

  useEffect(() => {
    if (!confirmRemove) return;
    const timer = setTimeout(() => setConfirmRemove(null), 5000);
    return () => clearTimeout(timer);
  }, [confirmRemove]);

  const loadFavorites = () => {
    try {
      const favs = JSON.parse(localStorage.getItem('boz_favorites') || '[]');
      setFavorites(Array.isArray(favs) ? favs.filter((t: unknown): t is string => typeof t === 'string') : []);
      setRecentCount(loadRecentTickers(window.localStorage).length);
    } catch {
      setFavorites([]);
    }
  };

  useEffect(() => {
    loadFavorites();
    const handleFavsChange = () => loadFavorites();
    window.addEventListener('boz_favorites_changed', handleFavsChange);
    return () => window.removeEventListener('boz_favorites_changed', handleFavsChange);
  }, []);

  // Market overview quotes (fixed basket, best-effort).
  useEffect(() => {
    MARKET_NOW.forEach(({ symbol }) => {
      fetch(`/api/market/quote?ticker=${encodeURIComponent(symbol)}`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (data && typeof data.price === 'number') {
            setMarketQuotes(prev => (prev[symbol] ? prev : { ...prev, [symbol]: data }));
          }
        })
        .catch(() => {});
    });
  }, []);

  // Watchlist quotes with a light refresh while visible (in-app alerts only).
  useEffect(() => {
    let cancelled = false;
    const fetchFavs = () => {
      if (document.visibilityState !== 'visible') return;
      favorites.forEach(t => {
        fetch(`/api/market/quote?ticker=${encodeURIComponent(t)}`)
          .then(res => (res.ok ? res.json() : null))
          .then(data => {
            if (!cancelled && data && typeof data.price === 'number') {
              setFavoriteQuotes(prev => ({ ...prev, [t]: data }));
            }
          })
          .catch(() => {});
      });
    };
    fetchFavs();
    const id = setInterval(fetchFavs, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [favorites]);

  // In-app move alerts: watchlist names moving ±3% today. No browser notify.
  const movers = useMemo(
    () =>
      findBigMovers(
        favorites.map(t => ({ ticker: t, changePercent: favoriteQuotes[t]?.changePercent })),
        3,
      ),
    [favorites, favoriteQuotes],
  );

  const topFavorites = favorites.slice(0, 5);

  return (
    <div className={styles['bbg-page']} style={{ padding: '0 var(--space-4) var(--space-6)', background: 'var(--bg-primary)' }}>
      <header className={`bbg-header ${styles['ticker-page-header']}`}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-violet)', fontSize: '14px', fontWeight: 700, margin: 0, letterSpacing: '0.05em' }}>DASHBOARD</h1>
          <p style={{ fontFamily: 'var(--font-mono)', color: '#555', fontSize: '10px', marginTop: '2px', textTransform: 'uppercase' }}>REAL-TIME MARKET OVERVIEW</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => router.push('/discover')}
            style={{ padding: '0 14px', height: '38px', borderRadius: '7px', border: 0, background: 'var(--accent-violet)', color: '#080808', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
          >
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true" style={{ marginRight: '6px' }}></i>
            SEARCH TICKERS
          </button>
        </div>
      </header>

      {/* Market now */}
      <section aria-label="Market now" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {MARKET_NOW.map(({ symbol, label }) => {
          const q = marketQuotes[symbol];
          const chg = q?.changePercent;
          const up = (chg ?? 0) >= 0;
          return (
            <button
              key={symbol}
              type="button"
              onClick={() => router.push(`/ticker/${encodeURIComponent(symbol)}`)}
              style={{ textAlign: 'left', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-glass)', background: 'var(--bg-secondary)', cursor: 'pointer' }}
            >
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: '#888' }}>{label}</div>
              <div style={{ color: '#fff', fontSize: '16px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', margin: '4px 0' }}>
                {typeof q?.price === 'number' ? (
                  `$${q.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                ) : (
                  <span className={styles['skel']} style={{ width: '76px', height: '17px' }}></span>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: typeof chg === 'number' ? (up ? 'var(--success)' : 'var(--danger)') : '#666' }}>
                {typeof chg === 'number' ? `${up ? '+' : ''}${chg.toFixed(2)}%` : <span className={styles['skel']} style={{ width: '52px', height: '12px' }}></span>}
              </div>
            </button>
          );
        })}
      </section>

      {/* In-app alerts preview */}
      {movers.length > 0 && (
        <section
          aria-label="Watchlist alerts"
          role="status"
          style={{ border: '1px solid var(--warning, #e2a63d)', borderRadius: '10px', padding: '12px 14px', marginBottom: '20px', background: 'rgba(226,166,61,0.07)' }}
        >
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', color: '#fff', marginBottom: '6px' }}>
            <i className="fa-solid fa-bell" aria-hidden="true" style={{ marginRight: '8px' }}></i>
            MOVING TODAY · {movers.length}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {movers.map(t => {
              const chg = favoriteQuotes[t]?.changePercent;
              const up = (chg ?? 0) >= 0;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => router.push(`/ticker/${encodeURIComponent(t)}`)}
                  style={{ padding: '6px 10px', borderRadius: '999px', border: '1px solid var(--border-glass)', background: 'transparent', color: up ? 'var(--success)' : 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {t} {typeof chg === 'number' ? `${up ? '+' : ''}${chg.toFixed(2)}%` : ''} ↗
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Watchlist summary */}
      <section className={styles['home-watchlist']} style={{ marginTop: 0, maxWidth: 'none' }} aria-label="Watchlist summary">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
          <h2>YOUR WATCHLIST{favorites.length > 0 ? ` · ${favorites.length}` : ''}</h2>
          {favorites.length > 5 && (
            <button
              type="button"
              onClick={() => router.push('/discover')}
              style={{ background: 'transparent', border: 0, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: '11px', cursor: 'pointer' }}
            >
              View all in Discover →
            </button>
          )}
        </div>
        {favorites.length > 0 ? (
          <div className={styles['home-watchlist-list']}>
            {topFavorites.map(t => {
              const quote = favoriteQuotes[t];
              const price = quote?.price;
              const change = quote?.change;
              const isUp = (change ?? 0) >= 0;
              return (
                <div key={t} className={styles['home-watchlist-row']}>
                  <button type="button" className={styles['home-watchlist-asset']} onClick={() => router.push(`/ticker/${encodeURIComponent(t)}`)}>
                    <span className={styles['home-watchlist-symbol']}>{t}</span>
                    <span className={styles['home-watchlist-price']}>
                      {typeof price === 'number' ? (
                        `$${price.toFixed(2)}`
                      ) : (
                        <span className={styles['skel']} style={{ width: '64px', height: '14px' }}></span>
                      )}
                    </span>
                    <span className={`${styles['home-watchlist-change']}${isUp ? ' is-up' : ' is-down'}`}>
                      {typeof change === 'number' ? `${isUp ? '+' : ''}${change.toFixed(2)}` : <span className={styles['skel']} style={{ width: '48px', height: '12px' }}></span>}
                    </span>
                    <i className="fa-solid fa-chevron-right" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    className={`${styles['favorite-toggle']} is-saved${confirmRemove === t ? ' is-confirming' : ''}`}
                    onClick={() => confirmRemove === t ? removeFavorite(t) : setConfirmRemove(t)}
                    disabled={removingFavorite === t}
                    title={confirmRemove === t ? 'Click again to remove from watchlist' : 'Remove from watchlist'}
                    aria-label={confirmRemove === t ? `Confirm remove ${t} from watchlist` : `Remove ${t} from watchlist`}
                    aria-pressed="true"
                  >
                    <i className="fa-solid fa-star" aria-hidden="true"></i>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: '28px 0', textAlign: 'center', border: '1px dashed var(--border-glass)', borderRadius: '10px' }}>
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: '#fff' }}>NO SYMBOLS YET</h2>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#888', marginTop: '8px' }}>
              Star any ticker to pin it here{recentCount > 0 ? ' — or jump back into one you recently viewed' : ''}.
            </p>
            <button
              type="button"
              onClick={() => router.push('/discover')}
              style={{ marginTop: '12px', padding: '10px 16px', borderRadius: '7px', border: 0, background: 'var(--accent-violet)', color: '#080808', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
            >
              DISCOVER TICKERS ↗
            </button>
          </div>
        )}
      </section>

      {/* Shortcuts to the rest of the app */}
      <section aria-label="Shortcuts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '20px' }}>
        {[
          { label: 'Discover', desc: 'Search + agent + ideas', href: '/discover' },
          { label: 'Screeners', desc: 'Find your next setup', href: '/screener' },
          { label: 'News Intel', desc: 'Headlines + sentiment', href: '/news-intel' },
          { label: 'Chat Agent', desc: 'Ask anything', href: '/chat' },
        ].map(s => (
          <button
            key={s.href}
            type="button"
            onClick={() => router.push(s.href)}
            style={{ textAlign: 'left', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border-glass)', background: 'transparent', cursor: 'pointer' }}
          >
            <div style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{s.label} →</div>
            <div style={{ color: '#888', fontSize: '11px', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{s.desc}</div>
          </button>
        ))}
      </section>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import styles from './ticker/[ticker]/TickerPage.module.css';
import { MiniCalendarWidget } from '@/app/components/layout/MarketStatusStrip';
import { WatchlistAlerts } from '@/app/components/layout/WatchlistAlerts';
import AreaChart from '@/app/components/ui/AreaChart';
import { findBigMovers, loadRecentTickers } from '@/shared/discover';
import {
  assignWatchlistGroup,
  dropTickerFromGroups,
  groupNamesInUse,
  normalizeGroupName,
  parseWatchlistGroups,
  tickersForGroup,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUPS,
  type WatchlistGroups,
} from '@/shared/watchlist-groups';

interface Quote {
  price?: number;
  change?: number;
  changePercent?: number;
}

/** Watchlist-driven hero: last charted symbol is remembered here. */
const DASHBOARD_SYMBOL_KEY = 'boz_dashboard_symbol';
const DASHBOARD_CHART_HEIGHT = 250;
/** Groups live BESIDE the flat watchlist: `ticker â†’ group name`, so every
 *  other consumer of the flat `boz_favorites` array stays untouched. */
const GROUPS_KEY = 'boz_watchlist_groups';
const GROUPS_EVENT = 'boz_watchlist_groups_changed';
/** Marks the hosts of the group assign/create dropdowns for outside-click. */
const GROUP_PICKER_CLASS = 'boz-group-picker';

// â”€â”€â”€ Group chip + assign-dropdown styling (this page writes styles inline) â”€â”€
const chipStyle = (selected: boolean): CSSProperties => ({
  padding: '4px 12px',
  borderRadius: '999px',
  border: `1px solid ${selected ? 'var(--accent-violet)' : 'var(--border-glass)'}`,
  background: selected ? 'rgba(139, 92, 246, 0.12)' : 'transparent',
  color: selected ? '#fff' : 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

const optionStyle = (selected: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 8px',
  margin: '0 -4px',
  borderRadius: '7px',
  border: 0,
  background: selected ? 'rgba(255, 255, 255, 0.07)' : 'transparent',
  color: '#fff',
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontWeight: 700,
  cursor: 'pointer',
  textAlign: 'left',
  minWidth: 0,
});

const pickerDropdownStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  width: '232px',
  maxWidth: 'min(90vw, 260px)',
  background: '#1d1d20',
  border: '1px solid var(--border-glass)',
  borderRadius: '12px',
  boxShadow: '0 14px 40px rgba(0, 0, 0, 0.6)',
  padding: '10px 12px',
  zIndex: 220,
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const rowChipStyle: CSSProperties = {
  maxWidth: '96px',
  padding: '3px 10px',
  borderRadius: '999px',
  border: '1px solid var(--border-glass)',
  background: 'transparent',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flexShrink: 0,
};

export default function HomePage() {
  const router = useRouter();

  // Favorites logic (same storage + two-step remove as before).
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteQuotes, setFavoriteQuotes] = useState<Record<string, Quote>>({});
  const [removingFavorite, setRemovingFavorite] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState(0);
  const [lastPicked, setLastPicked] = useState<string | null>(null);

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
      // Its group goes with it â€” groups only exist through their tickers.
      const storedGroups = readGroups();
      const groupNext = dropTickerFromGroups(storedGroups, ticker);
      if (groupNext !== storedGroups) {
        try {
          localStorage.setItem(GROUPS_KEY, JSON.stringify(groupNext));
        } catch {
          // storage optional
        }
        window.dispatchEvent(new Event(GROUPS_EVENT));
      }
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

  // â”€â”€ Watchlist groups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // A ticker carries at most one group; a group exists only through the
  // tickers that carry it. Groups are optional â€” the watchlist renders and
  // behaves identically when none are assigned.
  const [groups, setGroups] = useState<WatchlistGroups>({});
  const [groupFilter, setGroupFilter] = useState<string | null>(null); // null = ALL
  const [groupPicker, setGroupPicker] = useState<string | null>(null); // ticker | 'composer'
  const [pendingGroupName, setPendingGroupName] = useState('');
  const composerRef = useRef<HTMLInputElement>(null);

  const readGroups = (): WatchlistGroups => {
    try {
      return parseWatchlistGroups(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}'));
    } catch {
      return {}; // corrupted entry degrades to no groups, never a crash
    }
  };

  useEffect(() => {
    setGroups(readGroups());
    const reload = () => setGroups(readGroups());
    window.addEventListener(GROUPS_EVENT, reload);
    return () => window.removeEventListener(GROUPS_EVENT, reload);
  }, []);

  const persistGroups = (next: WatchlistGroups) => {
    setGroups(next);
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
    } catch {
      // Storage optional â€” assignments survive as session state.
    }
    window.dispatchEvent(new Event(GROUPS_EVENT));
  };

  const setTickerGroup = (ticker: string, name: string) => {
    try {
      persistGroups(assignWatchlistGroup(readGroups(), ticker, name));
    } catch {
      // localStorage unavailable â€” still update the visible state.
      setGroups(assignWatchlistGroup(groups, ticker, name));
    }
    setGroupPicker(null);
    setPendingGroupName('');
  };

  // One assign/create dropdown open at a time; Enter commits the typed name,
  // the composer also jumps the filter onto the fresh group so it's visible.
  const commitPendingGroup = () => {
    const name = normalizeGroupName(pendingGroupName);
    if (!name) return;
    if (groupPicker === 'composer') {
      setGroupFilter(name);
      setGroupPicker(null);
      setPendingGroupName('');
    } else if (groupPicker) {
      setTickerGroup(groupPicker, name);
    }
  };

  useEffect(() => {
    if (!groupPicker) return;
    composerRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(`.${GROUP_PICKER_CLASS}`)) return;
      setGroupPicker(null);
      setPendingGroupName('');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGroupPicker(null);
        setPendingGroupName('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [groupPicker]);

  const groupNames = useMemo(() => groupNamesInUse(groups), [groups]);
  const visibleFavorites = useMemo(
    () => tickersForGroup(favorites, groups, groupFilter),
    [favorites, groups, groupFilter],
  );
  // ALL stays a peek of the first five; a chosen group shows all its rows.
  const shownFavorites = groupFilter ? visibleFavorites : visibleFavorites.slice(0, 5);

  // Remembered chart symbol â€” read once on the client; SSR cannot touch
  // localStorage, so this stays a mount effect.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DASHBOARD_SYMBOL_KEY);
      setLastPicked(typeof raw === 'string' && raw.trim() ? raw : null);
    } catch {
      // Storage optional â€” the first favourite charts by default.
    }
  }, []);

  // The hero chart follows the watchlist: the FIRST favourite ("most loved")
  // charts by default, a dropdown switches between favourites, and the last
  // pick is remembered next visit. A removed favourite falls back to the
  // top of the list.
  const selectedSymbol = useMemo(() => {
    if (lastPicked && favorites.includes(lastPicked)) return lastPicked;
    return favorites[0] ?? null;
  }, [lastPicked, favorites]);

  const pickSymbol = (ticker: string) => {
    setLastPicked(ticker);
    try {
      window.localStorage.setItem(DASHBOARD_SYMBOL_KEY, ticker);
    } catch {
      // Storage optional.
    }
  };

  // Watchlist quotes with a light refresh while visible (the chart card and
  // the watchlist rows share them â€” no hardcoded basket anywhere).
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

  // In-app move alerts: watchlist names moving Â±3% today. No browser notify.
  const movers = useMemo(
    () =>
      findBigMovers(
        favorites.map(t => ({ ticker: t, changePercent: favoriteQuotes[t]?.changePercent })),
        3,
      ),
    [favorites, favoriteQuotes],
  );

  const selectedQuote = selectedSymbol ? favoriteQuotes[selectedSymbol] : undefined;
  const selectedChange = selectedQuote?.changePercent;
  const selectedUp = (selectedChange ?? 0) >= 0;

  return (
    <div className={styles['bbg-page']} style={{ padding: '0 var(--space-4) var(--space-6)', background: 'var(--bg-primary)' }}>
      <header className={`bbg-header ${styles['ticker-page-header']}`}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-violet)', fontSize: '14px', fontWeight: 700, margin: 0, letterSpacing: '0.05em' }}>DASHBOARD</h1>
          <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '10px', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>REAL-TIME MARKET OVERVIEW</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <WatchlistAlerts
            movers={movers}
            quotes={favoriteQuotes}
            onSelect={(ticker) => router.push(`/ticker/${encodeURIComponent(ticker)}`)}
          />
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

      {/* Top row: the watchlist chart hero on the left, and on the RIGHT one
          GLOBAL mini-month calendar (its own widget â€” sessions and closures
          spoken inside it, never a market-specific card). No hardcoded quote
          basket: the chart always follows the user's favourites. */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch', flexWrap: 'wrap', marginBottom: '20px' }}>
        <section
          aria-label="Watchlist chart"
          className="mis-card"
          style={{ flex: '1 1 420px', minWidth: 0 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 }}>
              <span className="mis-card-label" style={{ marginBottom: 0 }}>WATCHLIST CHART</span>
              {selectedSymbol ? (
                <select
                  aria-label="Watchlist symbol to chart"
                  value={selectedSymbol}
                  onChange={(e) => pickSymbol(e.target.value)}
                  style={{
                    background: 'var(--bg-primary)',
                    color: '#fff',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '7px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '5px 8px',
                    cursor: 'pointer',
                    maxWidth: '100%',
                  }}
                >
                  {favorites.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#888' }}>NO FAVOURITE YET</span>
              )}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ color: '#fff', fontSize: '15px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                {typeof selectedQuote?.price === 'number' ? (
                  `$${selectedQuote.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                ) : selectedSymbol ? (
                  <span className={styles['skel']} style={{ width: '74px', height: '15px' }}></span>
                ) : (
                  'â€”'
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: typeof selectedChange === 'number' ? (selectedUp ? 'var(--success)' : 'var(--danger)') : '#666' }}>
                {typeof selectedChange === 'number'
                  ? `${selectedUp ? '+' : ''}${selectedChange.toFixed(2)}% TODAY`
                  : <span className={styles['skel']} style={{ width: '68px', height: '11px' }}></span>}
              </div>
            </div>
          </div>
          {selectedSymbol ? (
            <AreaChart symbol={selectedSymbol} height={DASHBOARD_CHART_HEIGHT} rangeLabel="90D" />
          ) : (
            <div style={{ height: '220px', display: 'grid', placeItems: 'center', border: '1px dashed var(--border-glass)', borderRadius: 10 }}>
              <div style={{ textAlign: 'center', padding: '0 16px' }}>
                <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: '#fff', margin: 0 }}>NO SYMBOLS YET</h2>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#888', margin: '6px 0 0' }}>
                  Star a ticker and its chart lives here.
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/discover')}
                  style={{ marginTop: '10px', padding: '8px 14px', borderRadius: '7px', border: 0, background: 'var(--accent-violet)', color: '#080808', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
                >
                  DISCOVER TICKERS â†—
                </button>
              </div>
            </div>
          )}
        </section>

        <div
          aria-label="Market calendar"
          style={{ flex: '0 1 272px', minWidth: '264px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '12px', marginLeft: 'auto' }}
        >
          <MiniCalendarWidget />
        </div>
      </div>

      {/* In-app alerts live as a compact bell notification in the header â€”
          the wide "MOVING TODAY" banner is gone. */}

      {/* Watchlist summary */}
      <section className={styles['home-watchlist']} style={{ marginTop: 0, maxWidth: 'none' }} aria-label="Watchlist summary">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
          <h2>YOUR WATCHLIST{favorites.length > 0 ? ` Â· ${favorites.length}` : ''}</h2>
          {favorites.length > 5 && (
            <button
              type="button"
              onClick={() => router.push('/discover')}
              style={{ background: 'transparent', border: 0, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: '11px', cursor: 'pointer' }}
            >
              View all in Discover â†’
            </button>
          )}
        </div>

        {/* Groups: optional tags over the flat watchlist. ALL is the plain
            list; a group chip shows only its tickers, in watchlist order. */}
        {favorites.length > 0 && (
          <div aria-label="Watchlist groups" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', margin: '12px 0 2px' }}>
            <button
              type="button"
              style={chipStyle(groupFilter === null)}
              onClick={() => setGroupFilter(null)}
              aria-pressed={groupFilter === null}
            >
              ALL Â· {favorites.length}
            </button>
            {groupNames.map((name) => (
              <button
                key={name}
                type="button"
                style={chipStyle(groupFilter === name)}
                onClick={() => setGroupFilter(name)}
                aria-pressed={groupFilter === name}
                title={`Filter watchlist: ${name}`}
              >
                {name} Â· {favorites.filter((t) => groups[t] === name).length}
              </button>
            ))}
            {groupNames.length < MAX_GROUPS && (
              <div className={GROUP_PICKER_CLASS} style={{ position: 'relative' }}>
                <button
                  type="button"
                  style={chipStyle(false)}
                  aria-expanded={groupPicker === 'composer'}
                  aria-haspopup="dialog"
                  title="Create a group"
                  onClick={() => {
                    const next = groupPicker === 'composer' ? null : 'composer';
                    setGroupPicker(next);
                    setPendingGroupName('');
                  }}
                >
                  + GROUP
                </button>
                {groupPicker === 'composer' && (
                  <div style={{ ...pickerDropdownStyle, left: 0 }}>
                    <input
                      ref={composerRef}
                      value={pendingGroupName}
                      maxLength={MAX_GROUP_NAME_LENGTH}
                      placeholder="Group nameâ€¦"
                      aria-label="New group name"
                      onChange={(e) => setPendingGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitPendingGroup();
                        }
                      }}
                      style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-primary)', border: '1px solid var(--border-glass)', borderRadius: '7px', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '12px', padding: '7px 9px' }}
                    />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={commitPendingGroup}
                        disabled={!normalizeGroupName(pendingGroupName)}
                        style={{ padding: '7px 10px', borderRadius: '7px', border: 0, background: 'var(--accent-violet)', color: '#080808', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', cursor: 'pointer', opacity: pendingGroupName.trim() ? 1 : 0.4 }}
                      >
                        CREATE
                      </button>
                    </div>
                    <p style={{ margin: '-2px 0 0', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
                      Starred tickers stay ungrouped until assigned here.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {favorites.length > 0 ? (
          shownFavorites.length > 0 ? (
            <div className={styles['home-watchlist-list']}>
            {shownFavorites.map(t => {
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
                  <div className={GROUP_PICKER_CLASS} style={{ position: 'relative' }}>
                    <button
                      type="button"
                      style={{ ...rowChipStyle, color: groups[t] ? 'var(--text-primary)' : 'var(--text-muted)' }}
                      aria-expanded={groupPicker === t}
                      aria-haspopup="dialog"
                      title={groups[t] ? `Group: ${groups[t]}` : 'Assign to a group'}
                      onClick={() => {
                        setGroupPicker(groupPicker === t ? null : t);
                        setPendingGroupName('');
                      }}
                    >
                      {groups[t] ?? '+ group'}
                    </button>
                    {groupPicker === t && (
                      <div style={{ ...pickerDropdownStyle, right: 0 }}>
                        <span style={{ font: '800 9px var(--font-mono)', letterSpacing: '0.12em', color: 'var(--text-secondary)' }}>
                          ASSIGN GROUP
                        </span>
                        {groupNames.length === 0 ? (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                            No groups yet â€” create one below.
                          </span>
                        ) : (
                          groupNames.map((name) => (
                            <button
                              key={name}
                              type="button"
                              style={optionStyle(groups[t] === name)}
                              onClick={() => setTickerGroup(t, name)}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                              {groups[t] === name && (
                                <i className="fa-solid fa-check" aria-hidden="true" style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--accent-violet)' }}></i>
                              )}
                            </button>
                          ))
                        )}
                        {groups[t] && (
                          <button type="button" style={optionStyle(false)} onClick={() => setTickerGroup(t, '')}>
                            No group
                          </button>
                        )}
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            ref={composerRef}
                            value={pendingGroupName}
                            maxLength={MAX_GROUP_NAME_LENGTH}
                            placeholder="New groupâ€¦"
                            aria-label="New group name"
                            onChange={(e) => setPendingGroupName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitPendingGroup();
                              }
                            }}
                            style={{ flex: 1, minWidth: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-glass)', borderRadius: '7px', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '6px 8px', boxSizing: 'border-box' }}
                          />
                          <button
                            type="button"
                            aria-label="Create and assign"
                            onClick={commitPendingGroup}
                            disabled={!normalizeGroupName(pendingGroupName)}
                            style={{ padding: '0 10px', borderRadius: '7px', border: 0, background: 'var(--accent-violet)', color: '#080808', fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 800, cursor: pendingGroupName.trim() ? 'pointer' : 'not-allowed', opacity: pendingGroupName.trim() ? 1 : 0.4 }}
                          >
                            ï¼‹
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
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
            <div style={{ padding: '18px 0', textAlign: 'center', border: '1px dashed var(--border-glass)', borderRadius: '10px', marginTop: '10px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#888', margin: 0 }}>
                No tickers in {groupFilter} yet â€” assign one via a row's + group chip.
              </p>
            </div>
          )
        ) : (
          <div style={{ padding: '28px 0', textAlign: 'center', border: '1px dashed var(--border-glass)', borderRadius: '10px' }}>
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: '#fff' }}>NO SYMBOLS YET</h2>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#888', marginTop: '8px' }}>
              Star any ticker to pin it here{recentCount > 0 ? ' â€” or jump back into one you recently viewed' : ''}.
            </p>
            <button
              type="button"
              onClick={() => router.push('/discover')}
              style={{ marginTop: '12px', padding: '10px 16px', borderRadius: '7px', border: 0, background: 'var(--accent-violet)', color: '#080808', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
            >
              DISCOVER TICKERS â†—
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
            className="home-shortcut-tile"
            onClick={() => router.push(s.href)}
          >
            <div style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{s.label} â†’</div>
            <div style={{ color: '#888', fontSize: '11px', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{s.desc}</div>
          </button>
        ))}
      </section>
    </div>
  );
}

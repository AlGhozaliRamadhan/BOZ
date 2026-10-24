'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './ticker/[ticker]/TickerPage.module.css';
import db from './page.module.css';
import { MiniCalendarWidget } from '@/app/components/layout/MarketStatusStrip';
import { WatchlistAlerts } from '@/app/components/layout/WatchlistAlerts';
import AreaChart from '@/app/components/ui/AreaChart';
import { findBigMovers, loadRecentTickers } from '@/shared/discover';
import {
  assignWatchlistGroup,
  createFolder,
  deleteFolder,
  dropTickerFromGroups,
  foldersInUse,
  normalizeGroupName,
  parseWatchlistFolders,
  parseWatchlistGroups,
  renameFolder,
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
/** Groups live BESIDE the flat watchlist: `ticker → group name`, so every
 *  other consumer of the flat `boz_favorites` array stays untouched. */
const GROUPS_KEY = 'boz_watchlist_groups';
/** Folder names persist as their own ordered list beside the map: a folder
 *  exists from the moment it is created — empty ones included — until it is
 *  deleted. */
const FOLDERS_KEY = 'boz_watchlist_folders';
const GROUPS_EVENT = 'boz_watchlist_groups_changed';
/** Marks the hosts of the folder assign/create dropdowns for outside-click. */
const GROUP_PICKER_CLASS = 'boz-group-picker';

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
      // Its assignment goes with it — the folder itself stays on the bar.
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

  // ── Watchlist folders ──────────────────────────────────────────────────────
  // A ticker carries at most one group. The bar renders the persistent folder
  // list merged with any in-use group names from before folders existed, so
  // nothing a user assigned earlier can vanish below them. Groups are always
  // optional — the watchlist renders identically with none.
  const [groups, setGroups] = useState<WatchlistGroups>({});
  const [folders, setFolders] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState<string | null>(null); // null = ALL
  const [groupPicker, setGroupPicker] = useState<string | null>(null); // ticker | 'composer'
  const [pendingFolderName, setPendingFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<string | null>(null);
  const composerRef = useRef<HTMLInputElement>(null);

  const readGroups = (): WatchlistGroups => {
    try {
      return parseWatchlistGroups(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}'));
    } catch {
      return {}; // corrupted entry degrades to no groups, never a crash
    }
  };

  const readFolders = (): string[] => {
    try {
      return parseWatchlistFolders(JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '[]'));
    } catch {
      return []; // corrupted/absent list degrades to no folders, never a crash
    }
  };

  useEffect(() => {
    setGroups(readGroups());
    setFolders(readFolders());
    const reload = () => {
      setGroups(readGroups());
      setFolders(readFolders());
    };
    window.addEventListener(GROUPS_EVENT, reload);
    return () => window.removeEventListener(GROUPS_EVENT, reload);
  }, []);

  const persistGroups = (next: WatchlistGroups) => {
    setGroups(next);
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
    } catch {
      // Storage optional — assignments survive as session state.
    }
    window.dispatchEvent(new Event(GROUPS_EVENT));
  };

  /** Writes the folder list (and optionally the ticker map) in one go, then
   *  re-broadcasts — one event, one consistent state. */
  const persistFolders = (nextFolders: string[], nextGroups?: WatchlistGroups) => {
    setFolders(nextFolders);
    if (nextGroups) setGroups(nextGroups);
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(nextFolders));
      if (nextGroups) localStorage.setItem(GROUPS_KEY, JSON.stringify(nextGroups));
    } catch {
      // Storage optional — the bar survives as session state.
    }
    window.dispatchEvent(new Event(GROUPS_EVENT));
  };

  const setTickerGroup = (ticker: string, name: string) => {
    try {
      persistGroups(assignWatchlistGroup(readGroups(), ticker, name));
    } catch {
      // localStorage unavailable — still update the visible state.
      setGroups(assignWatchlistGroup(groups, ticker, name));
    }
    setGroupPicker(null);
    setPendingFolderName('');
  };

  // One dropdown open at a time. The composer creates a REAL folder — it lands
  // next to ALL even before any ticker is assigned. The row composer also
  // materializes a typed name before assigning, so the chip exists everywhere.
  const commitPendingFolder = (mode: 'composer' | 'row') => {
    const name = normalizeGroupName(pendingFolderName);
    if (!name) return;
    const created = createFolder(folders, name);
    if (mode === 'composer') {
      persistFolders(created.folders);
      setGroupFilter(name); // jump onto the fresh (or existing) folder
      setGroupPicker(null);
      setPendingFolderName('');
    } else if (groupPicker) {
      const exists = created.created || created.folders.includes(name);
      if (exists) {
        persistFolders(created.folders);
        setTickerGroup(groupPicker, name);
      }
      // A cap-blocked fresh name is refused silently: the dropdown stays open.
    }
  };

  const startFolderRename = (name: string) => {
    setRenamingFolder(name);
    setRenameDraft(name);
  };

  // Enter commits; blur follows through (a second call re-renames with the
  // same names — an idempotent no-op). Escape drops the draft untouched.
  const commitFolderRename = () => {
    const target = renamingFolder;
    const next = normalizeGroupName(renameDraft);
    if (!target) return;
    setRenamingFolder(null);
    setRenameDraft('');
    if (!next) return;
    const result = renameFolder(folders, groups, target, next);
    if (result.renamed) {
      persistFolders(result.folders, result.groups);
      if (groupFilter === target) setGroupFilter(next);
    }
  };

  const requestFolderDelete = (name: string) => {
    if (confirmDeleteFolder !== name) {
      setConfirmDeleteFolder(name);
      return;
    }
    const result = deleteFolder(folders, groups, name);
    persistFolders(result.folders, result.groups);
    if (groupFilter === name) setGroupFilter(null);
    setConfirmDeleteFolder(null);
  };

  useEffect(() => {
    if (!confirmDeleteFolder) return;
    const timer = setTimeout(() => setConfirmDeleteFolder(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmDeleteFolder]);

  useEffect(() => {
    if (!groupPicker) return;
    composerRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(`.${GROUP_PICKER_CLASS}`)) return;
      setGroupPicker(null);
      setPendingFolderName('');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGroupPicker(null);
        setPendingFolderName('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [groupPicker]);

  const folderNames = useMemo(() => foldersInUse(folders, groups), [folders, groups]);
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const name of folderNames) counts[name] = 0;
    for (const ticker of favorites) {
      const name = groups[ticker];
      if (name && name in counts) counts[name] += 1;
    }
    return counts;
  }, [folderNames, favorites, groups]);

  const visibleFavorites = useMemo(
    () => tickersForGroup(favorites, groups, groupFilter),
    [favorites, groups, groupFilter],
  );
  // ALL stays a peek of the first five; a chosen folder shows all its rows.
  const shownFavorites = groupFilter ? visibleFavorites : visibleFavorites.slice(0, 5);

  // Remembered chart symbol — read once on the client; SSR cannot touch
  // localStorage, so this stays a mount effect.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DASHBOARD_SYMBOL_KEY);
      setLastPicked(typeof raw === 'string' && raw.trim() ? raw : null);
    } catch {
      // Storage optional — the first favourite charts by default.
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

  // Watchlist quotes with a light refresh while visible (the chart strip and
  // the watchlist rows share them — no hardcoded basket anywhere).
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

  const selectedQuote = selectedSymbol ? favoriteQuotes[selectedSymbol] : undefined;
  const selectedChange = selectedQuote?.changePercent;
  const selectedUp = (selectedChange ?? 0) >= 0;

  return (
    <div className={styles['bbg-page']} style={{ padding: '0 var(--space-4) var(--space-6)', background: 'var(--bg-primary)' }}>
      {/* In-content navbar: a flat instrument strip in the page's own colour
          with one bottom separator — the charted symbol, its price and today's
          spoken change on the left, the alert bell on the right. Colour is
          data only: green/red says what the market is doing. */}
      <nav aria-label="Charted instrument" className={db['dash-nav']}>
        <div className={db['dash-quote']}>
          {selectedSymbol ? (
            <>
              <select
                aria-label="Watchlist symbol to chart"
                className={db['dash-symbol']}
                value={selectedSymbol}
                onChange={(e) => pickSymbol(e.target.value)}
              >
                {favorites.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span className={db['dash-price']}>
                {typeof selectedQuote?.price === 'number' ? (
                  `$${selectedQuote.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                ) : (
                  <span className={styles['skel']} style={{ width: '86px', height: '14px' }}></span>
                )}
              </span>
              <span
                className={`${db['dash-change']}${typeof selectedChange === 'number' ? (selectedUp ? ` ${db['is-up']}` : ` ${db['is-down']}`) : ''}`}
              >
                {typeof selectedChange === 'number'
                  ? `${selectedUp ? '+' : ''}${selectedChange.toFixed(2)}% TODAY`
                  : <span className={styles['skel']} style={{ width: '74px', height: '11px' }}></span>}
              </span>
            </>
          ) : (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#888899' }}>
              NO FAVOURITE YET — STAR A TICKER TO CHART IT
            </span>
          )}
        </div>
        <div className={db['dash-actions']}>
          <WatchlistAlerts
            movers={movers}
            quotes={favoriteQuotes}
            onSelect={(ticker) => router.push(`/ticker/${encodeURIComponent(ticker)}`)}
          />
        </div>
      </nav>

      {/* Top row: the watchlist chart hero on the left, and on the RIGHT one
          GLOBAL mini-month calendar (its own widget — sessions and closures
          spoken inside it, never a market-specific card). No hardcoded quote
          basket: the chart always follows the user's favourites. */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch', flexWrap: 'wrap', marginBottom: '20px' }}>
        <section
          aria-label="Watchlist chart"
          className="mis-card"
          style={{ flex: '1 1 420px', minWidth: 0 }}
        >
          {selectedSymbol ? (
            <AreaChart symbol={selectedSymbol} height={DASHBOARD_CHART_HEIGHT} rangeLabel="90D" />
          ) : (
            <div style={{ height: '220px', display: 'grid', placeItems: 'center', border: '1px dashed var(--border-glass)', borderRadius: 10 }}>
              <div style={{ textAlign: 'center', padding: '0 16px' }}>
                <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: '#ffffff', margin: 0 }}>NO SYMBOLS YET</h2>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#888899', margin: '6px 0 0' }}>
                  Star a ticker and its chart lives here.
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/discover')}
                  style={{ marginTop: '10px', padding: '8px 14px', borderRadius: '7px', border: 0, background: '#ffffff', color: '#080808', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
                >
                  DISCOVER TICKERS ↗
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

      {/* Watchlist summary */}
      <section className={styles['home-watchlist']} style={{ marginTop: 0, maxWidth: 'none' }} aria-label="Watchlist summary">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
          <h2>YOUR WATCHLIST{favorites.length > 0 ? ` · ${favorites.length}` : ''}</h2>
          {favorites.length > 5 && (
            <button
              type="button"
              onClick={() => router.push('/discover')}
              style={{ background: 'transparent', border: 0, color: '#ffffff', fontFamily: 'var(--font-mono)', fontSize: '11px', cursor: 'pointer' }}
            >
              View all in Discover →
            </button>
          )}
        </div>

        {/* Folders: persistent chips beside ALL. A folder exists from the
            moment it is created — empty included — and every row carries it
            or stays ungrouped. Selected folders grow manage controls. */}
        {favorites.length > 0 || folderNames.length > 0 ? (
          <div className={db['folder-bar']} aria-label="Watchlist folders">
            <button
              type="button"
              className={`${db.chip}${groupFilter === null ? ` ${db['is-active']}` : ''}`}
              onClick={() => setGroupFilter(null)}
              aria-pressed={groupFilter === null}
              title="Show the whole watchlist"
            >
              ALL · {favorites.length}
            </button>
            {folderNames.map((name) => {
              const active = groupFilter === name;
              return (
                <span key={name} className={`${db['folder-chip-group']}${active ? ` ${db['is-active']}` : ''}`}>
                  {renamingFolder === name ? (
                    <input
                      className={db['chip-rename']}
                      value={renameDraft}
                      maxLength={MAX_GROUP_NAME_LENGTH}
                      aria-label={`Rename folder ${name}`}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitFolderRename();
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setRenamingFolder(null);
                        }
                      }}
                      onBlur={commitFolderRename}
                      autoFocus
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`${db.chip}${active ? ` ${db['is-active']}` : ''}`}
                        onClick={() => setGroupFilter(name)}
                        aria-pressed={active}
                        title={`Filter watchlist: ${name}`}
                      >
                        {name} · {folderCounts[name] ?? 0}
                      </button>
                      <button
                        type="button"
                        className={db['chip-ghost']}
                        title="Rename folder"
                        aria-label={`Rename folder ${name}`}
                        onClick={() => startFolderRename(name)}
                      >
                        <i className="fa-solid fa-pen" aria-hidden="true"></i>
                      </button>
                      <button
                        type="button"
                        className={`${db['chip-ghost']}${confirmDeleteFolder === name ? ` ${db['is-armed']}` : ''}`}
                        title={confirmDeleteFolder === name ? 'Click again to delete the folder' : 'Delete folder (keeps its tickers)'}
                        aria-label={confirmDeleteFolder === name ? `Confirm delete folder ${name}` : `Delete folder ${name}`}
                        onClick={() => requestFolderDelete(name)}
                      >
                        <i className="fa-solid fa-trash" aria-hidden="true"></i>
                      </button>
                    </>
                  )}
                </span>
              );
            })}
            {folderNames.length < MAX_GROUPS && (
              <div className={GROUP_PICKER_CLASS} style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={db.chip}
                  aria-expanded={groupPicker === 'composer'}
                  aria-haspopup="dialog"
                  title="Create a folder"
                  onClick={() => {
                    const next = groupPicker === 'composer' ? null : 'composer';
                    setGroupPicker(next);
                    setPendingFolderName('');
                  }}
                >
                  + FOLDER
                </button>
                {groupPicker === 'composer' && (
                  <div className={db.picker}>
                    <input
                      ref={composerRef}
                      className={db['picker-input']}
                      value={pendingFolderName}
                      maxLength={MAX_GROUP_NAME_LENGTH}
                      placeholder="Folder name…"
                      aria-label="New folder name"
                      onChange={(e) => setPendingFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitPendingFolder('composer');
                        }
                      }}
                    />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className={db['picker-create']}
                        onClick={() => commitPendingFolder('composer')}
                        disabled={!normalizeGroupName(pendingFolderName)}
                      >
                        CREATE
                      </button>
                    </div>
                    <p className={db['picker-hint']}>
                      Folders stay next to ALL — empty ones included — until deleted. Put tickers in with a row&apos;s + folder chip.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

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
                      className={`${db['row-chip']}${groups[t] ? ` ${db['is-set']}` : ''}`}
                      aria-expanded={groupPicker === t}
                      aria-haspopup="dialog"
                      title={groups[t] ? `Folder: ${groups[t]}` : 'Assign to a folder'}
                      onClick={() => {
                        setGroupPicker(groupPicker === t ? null : t);
                        setPendingFolderName('');
                      }}
                    >
                      {groups[t] ?? '+ folder'}
                    </button>
                    {groupPicker === t && (
                      <div className={`${db.picker} ${db['is-end']}`}>
                        <span className={db['picker-title']}>
                          ASSIGN FOLDER
                        </span>
                        {folderNames.length === 0 ? (
                          <span className={db['picker-note']}>
                            No folders yet — create one below.
                          </span>
                        ) : (
                          folderNames.map((name) => (
                            <button
                              key={name}
                              type="button"
                              className={`${db.option}${groups[t] === name ? ` ${db['is-active']}` : ''}`}
                              onClick={() => setTickerGroup(t, name)}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                              {groups[t] === name && (
                                <i className="fa-solid fa-check" aria-hidden="true"></i>
                              )}
                            </button>
                          ))
                        )}
                        {groups[t] && (
                          <button type="button" className={db.option} onClick={() => setTickerGroup(t, '')}>
                            No folder
                          </button>
                        )}
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            ref={composerRef}
                            className={db['picker-input']}
                            style={{ flex: 1, minWidth: 0, fontSize: '11px', padding: '6px 8px' }}
                            value={pendingFolderName}
                            maxLength={MAX_GROUP_NAME_LENGTH}
                            placeholder="New folder…"
                            aria-label="New folder name"
                            onChange={(e) => setPendingFolderName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitPendingFolder('row');
                              }
                            }}
                          />
                          <button
                            type="button"
                            aria-label="Create and assign"
                            onClick={() => commitPendingFolder('row')}
                            disabled={!normalizeGroupName(pendingFolderName)}
                            style={{ padding: '0 10px' }}
                            className={db['picker-create']}
                          >
                            ＋
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
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#888899', margin: 0 }}>
                No tickers in {groupFilter} yet — assign one via a row&apos;s + folder chip.
              </p>
            </div>
          )
        ) : (
          <div style={{ padding: '28px 0', textAlign: 'center', border: '1px dashed var(--border-glass)', borderRadius: '10px' }}>
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: '#ffffff' }}>NO SYMBOLS YET</h2>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#888899', marginTop: '8px' }}>
              Star any ticker to pin it here{recentCount > 0 ? ' — or jump back into one you recently viewed' : ''}.
            </p>
            <button
              type="button"
              onClick={() => router.push('/discover')}
              style={{ marginTop: '12px', padding: '10px 16px', borderRadius: '7px', border: 0, background: '#ffffff', color: '#080808', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
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
            className="home-shortcut-tile"
            onClick={() => router.push(s.href)}
          >
            <div style={{ color: '#ffffff', fontSize: '12px', fontWeight: 700 }}>{s.label} →</div>
            <div style={{ color: '#888899', fontSize: '11px', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{s.desc}</div>
          </button>
        ))}
      </section>
    </div>
  );
}

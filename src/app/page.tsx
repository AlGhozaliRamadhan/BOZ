'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  const [tickerInput, setTickerInput] = useState('');
  
  // Autocomplete state
  const [searchResults, setSearchResults] = useState<{symbol: string, name: string, exchange: string}[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  
  // Favorites logic
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteQuotes, setFavoriteQuotes] = useState<Record<string, any>>({});
  const [removingFavorite, setRemovingFavorite] = useState<string | null>(null);
  // Two-step removal: first click arms the star so an accidental
  // tap on remove can't silently drop the ticker from the watchlist.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

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
      // Corrupt storage — clear it so the list recovers.
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
    } catch(e) {}
  };

  useEffect(() => {
    loadFavorites();
    const handleFavsChange = () => loadFavorites();
    window.addEventListener('boz_favorites_changed', handleFavsChange);
    return () => window.removeEventListener('boz_favorites_changed', handleFavsChange);
  }, []);

  useEffect(() => {
    favorites.forEach(t => {
      if (!favoriteQuotes[t]) {
        fetch(`/api/market/quote?ticker=${encodeURIComponent(t)}`)
          .then(res => res.json())
          .then(data => {
            setFavoriteQuotes(prev => ({ ...prev, [t]: data }));
          })
          .catch(err => console.error(err));
      }
    });
  }, [favorites, favoriteQuotes]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (tickerInput.trim() && showDropdown) {
        setIsSearching(true);
        try {
          const res = await fetch(`/api/market/search?q=${encodeURIComponent(tickerInput.trim())}`);
          if (res.ok) {
            const data = await res.json();
            setSearchResults(data.slice(0, 6)); // Top 6 results
          }
        } catch (err) {
          console.error('Search failed', err);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [tickerInput, showDropdown]);

  const handleTickerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tickerInput.trim()) {
      let newTicker = tickerInput.trim().toUpperCase();
      if (showDropdown && searchResults.length > 0) {
        newTicker = searchResults[0].symbol.toUpperCase();
      }
      setShowDropdown(false);
      router.push(`/ticker/${encodeURIComponent(newTicker)}`);
    }
  };

  return (
    <div className="bbg-page" style={{ padding: '0 var(--space-4) var(--space-6)', background: 'var(--bg-primary)' }}>
      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <header className="bbg-header ticker-page-header">
        <div>
          <h1 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-violet)', fontSize: '14px', fontWeight: 700, margin: 0, letterSpacing: '0.05em' }}>INTELLIGENCE DASHBOARD</h1>
          <p style={{ fontFamily: 'var(--font-mono)', color: '#555', fontSize: '10px', marginTop: '2px', textTransform: 'uppercase' }}>REAL-TIME MARKET OVERVIEW</p>
        </div>
        <div className="ticker-search">
          <form onSubmit={handleTickerSubmit} className="ticker-search__form" role="search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input
              type="text"
              aria-label="Search ticker or asset"
              placeholder="Search ticker or asset"
              value={tickerInput}
              onChange={(e) => {
                setTickerInput(e.target.value);
                setShowDropdown(e.target.value.trim() !== '');
              }}
              onFocus={() => {
                if (tickerInput.trim() !== '') setShowDropdown(true);
              }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              className="ticker-search__input"
            />
            <button type="submit" className="ticker-search__submit">GO <span aria-hidden="true">↗</span></button>
          </form>

          {showDropdown && (tickerInput.trim() !== '') && (
            <div className="ticker-search__results">
              {isSearching ? (
                <div className="ticker-search__message">SEARCHING...</div>
              ) : searchResults.length > 0 ? (
                searchResults.map((result, i) => (
                  <button
                    type="button"
                    key={result.symbol + i}
                    className="ticker-search__result"
                    onClick={() => {
                      const newTicker = result.symbol.toUpperCase();
                      setShowDropdown(false);
                      router.push(`/ticker/${encodeURIComponent(newTicker)}`);
                    }}
                  >
                    <span className="ticker-search__symbol">{result.symbol}</span>
                    <span className="ticker-search__name">{result.name}</span>
                    <span className="ticker-search__exchange">{result.exchange}</span>
                  </button>
                ))
              ) : (
                <div className="ticker-search__message">NO RESULTS</div>
              )}
            </div>
          )}
        </div>
      </header>

      {favorites.length > 0 ? (
        <section className="home-watchlist">
          <h2>YOUR WATCHLIST</h2>
          <div className="home-watchlist-list">
            {favorites.map(t => {
              const quote = favoriteQuotes[t];
              const price = quote?.price;
              const change = quote?.change;
              const isUp = change >= 0;
              return (
                <div key={t} className="home-watchlist-row">
                  <button type="button" className="home-watchlist-asset" onClick={() => router.push(`/ticker/${encodeURIComponent(t)}`)}>
                    <span className="home-watchlist-symbol">{t}</span>
                    <span className="home-watchlist-price">{typeof price === 'number' ? `$${price.toFixed(2)}` : 'LOADING...'}</span>
                    <span className={`home-watchlist-change${isUp ? ' is-up' : ' is-down'}`}>
                      {typeof change === 'number' ? `${isUp ? '+' : ''}${change.toFixed(2)}` : '—'}
                    </span>
                    <i className="fa-solid fa-chevron-right" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    className={`favorite-toggle is-saved${confirmRemove === t ? ' is-confirming' : ''}`}
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
        </section>
      ) : (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', color: '#fff' }}>ENTER A TICKER TO BEGIN</h2>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#888', marginTop: '8px' }}>
            Search for any stock or crypto symbol in the top right to view intelligence data.
          </p>
        </div>
      )}
    </div>
  );
}

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

  const loadFavorites = () => {
    try {
      const favs = JSON.parse(localStorage.getItem('boz_favorites') || '[]');
      setFavorites(favs);
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
      router.push(`/dashboard/${encodeURIComponent(newTicker)}`);
    }
  };

  return (
    <div className="bbg-page" style={{ padding: '0 0 var(--space-6)', minHeight: '100vh', background: '#000' }}>
      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div className="bbg-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid #1f1f1f' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-violet)', fontSize: '14px', fontWeight: 700, margin: 0, letterSpacing: '0.05em' }}>INTELLIGENCE DASHBOARD</h1>
          <p style={{ fontFamily: 'var(--font-mono)', color: '#555', fontSize: '10px', marginTop: '2px', textTransform: 'uppercase' }}>REAL-TIME MARKET OVERVIEW</p>
        </div>
        <div style={{ position: 'relative', width: '280px' }}>
          <form onSubmit={handleTickerSubmit} style={{ display: 'flex', border: '1px solid #333' }}>
            <input
              type="text"
              placeholder="SEARCH..."
              value={tickerInput}
              onChange={(e) => {
                setTickerInput(e.target.value);
                setShowDropdown(e.target.value.trim() !== '');
              }}
              onFocus={() => {
                if (tickerInput.trim() !== '') setShowDropdown(true);
              }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              style={{
                flex: 1, background: '#000', color: '#fff', border: 'none', padding: '0 12px',
                fontFamily: 'var(--font-mono)', fontSize: '12px', outline: 'none', textTransform: 'uppercase'
              }}
            />
            <button type="submit" style={{
              background: 'var(--accent-violet)', color: '#000', border: 'none', padding: '6px 12px',
              fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, cursor: 'pointer'
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px', verticalAlign: 'text-bottom' }}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              GO
            </button>
          </form>

          {showDropdown && (tickerInput.trim() !== '') && (
            <div style={{ 
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px',
              background: '#0d0d0d', border: '1px solid #333', zIndex: 50
            }}>
              {isSearching ? (
                <div style={{ padding: '8px', color: '#555', fontSize: '11px', textAlign: 'center' }}>SEARCHING...</div>
              ) : searchResults.length > 0 ? (
                searchResults.map((result, i) => (
                  <div 
                    key={result.symbol + i}
                    style={{ 
                      padding: '8px 12px', borderBottom: i === searchResults.length - 1 ? 'none' : '1px solid #1f1f1f', 
                      cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px'
                    }}
                    onMouseDown={() => {
                      const newTicker = result.symbol.toUpperCase();
                      setShowDropdown(false);
                      router.push(`/dashboard/${encodeURIComponent(newTicker)}`);
                    }}
                  >
                    <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{result.symbol}</span>
                    <span style={{ color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>{result.name}</span>
                  </div>
                ))
              ) : (
                <div style={{ padding: '8px', color: '#555', fontSize: '11px', textAlign: 'center' }}>NO RESULTS</div>
              )}
            </div>
          )}
        </div>
      </div>

      {favorites.length > 0 ? (
        <div style={{ marginTop: '32px' }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: '#888', marginBottom: '16px', textTransform: 'uppercase' }}>YOUR WATCHLIST</h2>
          <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '16px' }}>
            {favorites.map(t => {
              const quote = favoriteQuotes[t];
              const price = quote?.price;
              const change = quote?.change;
              const isUp = change >= 0;
              return (
                <div 
                  key={t}
                  onClick={() => router.push(`/dashboard/${encodeURIComponent(t)}`)}
                  style={{ 
                    minWidth: '200px', background: '#0a0a0a', border: '1px solid #1f1f1f', 
                    padding: '16px', cursor: 'pointer', display: 'flex', flexDirection: 'column'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-violet)'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = '#1f1f1f'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '16px' }}>{t}</span>
                    <i className="fa-solid fa-chevron-right" style={{ color: '#555', fontSize: '10px' }}></i>
                  </div>
                  {quote ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                      <span style={{ color: '#fff', fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>${price?.toFixed(2)}</span>
                      <span style={{ color: isUp ? '#00c853' : '#d50000', fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {isUp ? '+' : ''}{change?.toFixed(2)}
                      </span>
                    </div>
                  ) : (
                    <div style={{ color: '#555', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>LOADING...</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
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

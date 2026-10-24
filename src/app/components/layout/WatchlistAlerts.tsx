'use client';

// ─── components/layout/WatchlistAlerts.tsx ───────────────────────────────────
// In-app move alerts as a COMPACT notification: a bell with a count badge in
// the dashboard header, opening a small right-aligned dropdown of the movers
// — the replacement for the old full-width "MOVING TODAY" banner that pushed
// half the page down. Rows navigate like everything else in the watchlist.

import { useEffect, useRef, useState } from 'react';

export interface WatchlistQuote {
  change?: number;
  changePercent?: number;
}

interface WatchlistAlertsProps {
  movers: string[];
  quotes: Record<string, WatchlistQuote>;
  onSelect: (ticker: string) => void;
}

const PANEL_WIDTH = 280;

export function WatchlistAlerts({ movers, quotes, onSelect }: WatchlistAlertsProps) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  // Dismiss like every other popover: click elsewhere or Escape.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (movers.length === 0) return null;

  return (
    <div ref={hostRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={`Watchlist alerts — ${movers.length} moving today`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Watchlist movers today"
        onClick={() => setOpen((value) => !value)}
        style={{
          position: 'relative',
          width: '38px',
          height: '38px',
          padding: 0,
          borderRadius: '7px',
          border: '1px solid var(--border-glass)',
          background: open ? 'var(--accent-violet)' : 'var(--bg-primary)',
          color: open ? '#080808' : 'var(--accent-violet)',
          fontFamily: 'var(--font-mono)',
          fontSize: '14px',
          cursor: 'pointer',
        }}
      >
        <i className="fa-solid fa-bell" aria-hidden="true"></i>
        {/* Count badge only while closed — the open panel IS the count. */}
        {!open && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '-5px',
              right: '-5px',
              minWidth: '16px',
              height: '16px',
              padding: '0 4px',
              borderRadius: '999px',
              background: 'var(--accent-violet)',
              color: '#080808',
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              fontWeight: 800,
              lineHeight: '16px',
              textAlign: 'center',
            }}
          >
            {movers.length}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Watchlist movers today"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: `${PANEL_WIDTH}px`,
            maxWidth: 'min(90vw, 320px)',
            background: '#1d1d20',
            border: '1px solid var(--border-glass)',
            borderRadius: '14px',
            boxShadow: '0 16px 44px rgba(0, 0, 0, 0.6)',
            padding: '12px 14px',
            zIndex: 220,
          }}
        >
          <div style={{ font: '800 10px var(--font-mono)', letterSpacing: '0.14em', color: 'var(--text-secondary)', marginBottom: '10px' }}>
            MOVING TODAY · {movers.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {movers.map((ticker) => {
              const change = quotes[ticker]?.changePercent;
              const up = (change ?? 0) >= 0;
              return (
                <button
                  key={ticker}
                  type="button"
                  onClick={() => {
                    onSelect(ticker);
                    setOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '7px 8px',
                    margin: '0 -8px',
                    borderRadius: '8px',
                    border: 0,
                    background: 'transparent',
                    color: '#ffffff',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticker}</span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      color: up ? 'var(--success)' : 'var(--danger)',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: '11px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {typeof change === 'number' ? `${up ? '+' : ''}${change.toFixed(2)}%` : '—'}
                  </span>
                  <i className="fa-solid fa-arrow-right-long" aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: '10px' }}></i>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

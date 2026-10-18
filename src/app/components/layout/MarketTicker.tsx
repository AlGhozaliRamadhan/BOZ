'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';

/* ────────────────────────────────────────────────────────────────────────────
   MARKET TICKER
   Dense, data-rich scrolling strip inspired by the Bloomberg Terminal.

   Every cell is a real quote pulled from /api/market/quotes — the strip used to
   paint 22 hardcoded strings that never moved. Nothing renders a number that
   did not come back from the API: cells read '—' until their quote lands.
   Features:
   – Category section dividers (INDEX · EQUITY · CRYPTO · CMDTY · FX · RATES)
   – Compact price cells with change badges
   – Pause-on-hover
   – Live clock + real US session state (from the S&P 500 quote, not a UTC guess)
   ──────────────────────────────────────────────────────────────────────────── */

type TickerCategory = 'INDEX' | 'EQUITY' | 'CRYPTO' | 'CMDTY' | 'FX' | 'RATES';

interface TapeEntry {
  /** Yahoo symbol to quote. */
  symbol: string;
  /** Short label shown in the ribbon. */
  label: string;
  category: TickerCategory;
}

interface TapeQuote {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  marketState: string | null;
}

const TAPE: TapeEntry[] = [
  // Indices — ^GSPC doubles as the US session clock.
  { symbol: '^GSPC', label: 'SPX', category: 'INDEX' },
  { symbol: '^IXIC', label: 'NDX', category: 'INDEX' },
  { symbol: '^DJI', label: 'DJI', category: 'INDEX' },
  { symbol: '^RUT', label: 'RUT', category: 'INDEX' },
  { symbol: '^VIX', label: 'VIX', category: 'INDEX' },
  { symbol: '^JKSE', label: 'IHSG', category: 'INDEX' },
  // Equities
  { symbol: 'NVDA', label: 'NVDA', category: 'EQUITY' },
  { symbol: 'AAPL', label: 'AAPL', category: 'EQUITY' },
  { symbol: 'MSFT', label: 'MSFT', category: 'EQUITY' },
  { symbol: 'TSLA', label: 'TSLA', category: 'EQUITY' },
  { symbol: 'BBCA.JK', label: 'BBCA', category: 'EQUITY' },
  { symbol: 'BBRI.JK', label: 'BBRI', category: 'EQUITY' },
  // Crypto
  { symbol: 'BTC-USD', label: 'BTC', category: 'CRYPTO' },
  { symbol: 'ETH-USD', label: 'ETH', category: 'CRYPTO' },
  { symbol: 'SOL-USD', label: 'SOL', category: 'CRYPTO' },
  // Commodities
  { symbol: 'GC=F', label: 'GOLD', category: 'CMDTY' },
  { symbol: 'SI=F', label: 'SILVER', category: 'CMDTY' },
  { symbol: 'CL=F', label: 'WTI', category: 'CMDTY' },
  { symbol: 'BZ=F', label: 'BRENT', category: 'CMDTY' },
  // FX
  { symbol: 'EURUSD=X', label: 'EUR/USD', category: 'FX' },
  { symbol: 'JPY=X', label: 'USD/JPY', category: 'FX' },
  { symbol: 'DX-Y.NYB', label: 'DXY', category: 'FX' },
  // Rates
  { symbol: '^TNX', label: 'US10Y', category: 'RATES' },
  { symbol: '^FVX', label: 'US5Y', category: 'RATES' },
  { symbol: '^TYX', label: 'US30Y', category: 'RATES' },
];

const REFRESH_MS = 60_000;
const SESSION_LABEL: Record<string, string> = {
  REGULAR: 'US OPEN',
  PRE: 'US PRE',
  POST: 'US POST',
  POSTPOST: 'CLOSED',
  CLOSED: 'CLOSED',
};

const CATEGORY_ORDER: TickerCategory[] = ['INDEX', 'EQUITY', 'CRYPTO', 'CMDTY', 'FX', 'RATES'];

type RenderItem =
  | { type: 'divider'; label: string }
  | { type: 'ticker'; data: TapeEntry };

function buildRenderItems(entries: TapeEntry[]): RenderItem[] {
  const items: RenderItem[] = [];
  for (const category of CATEGORY_ORDER) {
    const group = entries.filter(entry => entry.category === category);
    if (group.length === 0) continue;
    items.push({ type: 'divider', label: category });
    for (const entry of group) items.push({ type: 'ticker', data: entry });
  }
  return items;
}

const RENDER_ITEMS = buildRenderItems(TAPE);

function formatPrice(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const digits = Math.abs(value) >= 1000 ? 1 : value < 10 ? 4 : 2;
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

interface MarketTickerProps {
  visible?: boolean;
}

export default function MarketTicker({ visible = true }: MarketTickerProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [clock, setClock] = useState('');
  const [quotes, setQuotes] = useState<Record<string, TapeQuote>>({});

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const hh = now.getHours().toString().padStart(2, '0');
      const mm = now.getMinutes().toString().padStart(2, '0');
      const ss = now.getSeconds().toString().padStart(2, '0');
      setClock(`${hh}:${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Live quotes — one batch request per refresh, skipped while the tab is hidden.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const fetchTape = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/api/market/quotes?tickers=${encodeURIComponent(TAPE.map(e => e.symbol).join(','))}`);
        if (!res.ok) return;
        const data = await res.json();
        const rows = Array.isArray(data?.quotes) ? data.quotes : [];
        if (cancelled) return;
        setQuotes(prev => {
          const next = { ...prev };
          for (const row of rows) {
            if (typeof row?.symbol !== 'string') continue;
            next[row.symbol.toUpperCase()] = {
              symbol: row.symbol.toUpperCase(),
              price: typeof row.price === 'number' ? row.price : null,
              changePercent: typeof row.changePercent === 'number' ? row.changePercent : null,
              marketState: typeof row.marketState === 'string' ? row.marketState : null,
            };
          }
          return next;
        });
      } catch {
        // Keep the last good values rather than blanking the strip on a blip.
      }
    };

    void fetchTape();
    const id = setInterval(fetchTape, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [visible]);

  // The S&P 500 quote carries Yahoo's own US session state, which beats
  // guessing from the UTC hour.
  const sessionLabel = useMemo(() => {
    const state = quotes['^GSPC']?.marketState;
    return (state && SESSION_LABEL[state.toUpperCase()]) || '—';
  }, [quotes]);

  const handleMouseEnter = useCallback(() => setIsPaused(true), []);
  const handleMouseLeave = useCallback(() => setIsPaused(false), []);

  if (!visible) return null;

  return (
    <div
      className="bbg-ticker"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Left session badge */}
      <div className="bbg-ticker__session">
        <span className="bbg-ticker__session-dot" />
        <span className="bbg-ticker__session-label">{sessionLabel}</span>
      </div>

      {/* Scrolling area */}
      <div className="bbg-ticker__track">
        <div
          className="bbg-ticker__ribbon"
          style={{ animationPlayState: isPaused ? 'paused' : 'running' }}
        >
          {/* Double the items for a seamless loop */}
          {[0, 1].map(pass => (
            <React.Fragment key={pass}>
              {RENDER_ITEMS.map((item, i) => {
                if (item.type === 'divider') {
                  return (
                    <span key={`${pass}-d-${i}`} className="bbg-ticker__divider">
                      {item.label}
                    </span>
                  );
                }

                const entry = item.data;
                const quote = quotes[entry.symbol];
                const change = quote?.changePercent ?? null;
                const isUp = change != null && change >= 0;

                return (
                  <span
                    key={`${pass}-t-${i}`}
                    className="bbg-ticker__cell"
                    title={quote ? `${entry.label} · ${formatPrice(quote.price)}` : `${entry.label} · no quote`}
                  >
                    <span className="bbg-ticker__symbol">{entry.label}</span>
                    <span className="bbg-ticker__price">{formatPrice(quote?.price ?? null)}</span>
                    <span className={`bbg-ticker__change ${change == null ? '' : isUp ? 'up' : 'down'}`}>
                      {change == null ? '—' : `${isUp ? '▲' : '▼'} ${change.toFixed(2)}%`}
                    </span>
                  </span>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Right clock badge */}
      <div className="bbg-ticker__clock">
        <span className="bbg-ticker__clock-time">{clock}</span>
      </div>

    </div>
  );
}
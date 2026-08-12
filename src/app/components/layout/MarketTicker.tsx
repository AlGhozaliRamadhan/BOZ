'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ────────────────────────────────────────────────────────────────────────────
   BLOOMBERG-STYLE MARKET TICKER
   Dense, data-rich scrolling strip inspired by the Bloomberg Terminal.
   Features:
   – Category section dividers (EQUITY · CRYPTO · CMDTY · FX · RATES)
   – Compact price cells with change badges
   – Pause-on-hover with subtle deceleration
   – Live clock + session indicator
   – Mini volume/trend micro-indicators
   ──────────────────────────────────────────────────────────────────────────── */

interface TickerItem {
  symbol: string;
  price: string;
  change: string;       // e.g. "+0.21" or "-0.78"
  isUp: boolean;
  volume?: string;      // abbreviated volume
  category: 'EQUITY' | 'INDEX' | 'CRYPTO' | 'CMDTY' | 'FX' | 'RATES';
}

const MOCK_TICKERS: TickerItem[] = [
  // Indices
  { symbol: 'SPX',     price: '6,021.4',  change: '+0.32', isUp: true,  category: 'INDEX' },
  { symbol: 'NDX',     price: '21,712',   change: '+0.61', isUp: true,  category: 'INDEX' },
  { symbol: 'DJI',     price: '44,801',   change: '-0.14', isUp: false, category: 'INDEX' },
  { symbol: 'VIX',     price: '14.82',    change: '-3.21', isUp: false, category: 'INDEX' },
  { symbol: 'IHSG',    price: '7,412',    change: '+0.28', isUp: true,  category: 'INDEX' },
  // Equities
  { symbol: 'NVDA',    price: '142.62',   change: '+2.14', isUp: true,  volume: '48.2M', category: 'EQUITY' },
  { symbol: 'AAPL',    price: '227.10',   change: '+0.45', isUp: true,  volume: '32.1M', category: 'EQUITY' },
  { symbol: 'MSFT',    price: '468.35',   change: '-0.18', isUp: false, volume: '18.7M', category: 'EQUITY' },
  { symbol: 'BBCA',    price: '10,475',   change: '+1.20', isUp: true,  volume: '12.4M', category: 'EQUITY' },
  { symbol: 'BBRI',    price: '5,225',    change: '-0.47', isUp: false, volume: '89.3M', category: 'EQUITY' },
  // Crypto
  { symbol: 'BTC',     price: '104,283',  change: '+2.04', isUp: true,  volume: '28.1B', category: 'CRYPTO' },
  { symbol: 'ETH',     price: '3,884',    change: '+1.12', isUp: true,  volume: '11.6B', category: 'CRYPTO' },
  { symbol: 'SOL',     price: '248.90',   change: '+3.81', isUp: true,  volume: '4.2B',  category: 'CRYPTO' },
  // Commodities
  { symbol: 'GOLD',    price: '2,654.1',  change: '+0.15', isUp: true,  category: 'CMDTY' },
  { symbol: 'WTI',     price: '71.34',    change: '-1.22', isUp: false, category: 'CMDTY' },
  { symbol: 'SILVER',  price: '31.18',    change: '+0.42', isUp: true,  category: 'CMDTY' },
  // FX
  { symbol: 'DXY',     price: '103.42',   change: '-0.08', isUp: false, category: 'FX' },
  { symbol: 'EUR/USD', price: '1.0912',   change: '+0.12', isUp: true,  category: 'FX' },
  { symbol: 'USD/JPY', price: '149.82',   change: '+0.31', isUp: true,  category: 'FX' },
  // Rates
  { symbol: 'US10Y',   price: '4.284',    change: '+0.02', isUp: true,  category: 'RATES' },
  { symbol: 'US2Y',    price: '4.612',    change: '-0.01', isUp: false, category: 'RATES' },
];

// Group items by category and produce an interleaved array
// with category divider markers
type RenderItem =
  | { type: 'divider'; label: string }
  | { type: 'ticker'; data: TickerItem };

function buildRenderItems(tickers: TickerItem[]): RenderItem[] {
  const categoryOrder: TickerItem['category'][] = ['INDEX', 'EQUITY', 'CRYPTO', 'CMDTY', 'FX', 'RATES'];
  const items: RenderItem[] = [];
  for (const cat of categoryOrder) {
    const group = tickers.filter(t => t.category === cat);
    if (group.length === 0) continue;
    items.push({ type: 'divider', label: cat });
    for (const t of group) {
      items.push({ type: 'ticker', data: t });
    }
  }
  return items;
}

const RENDER_ITEMS = buildRenderItems(MOCK_TICKERS);

export default function MarketTicker() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [clock, setClock] = useState('');
  const [marketSession, setMarketSession] = useState('PRE');

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const hh = now.getHours().toString().padStart(2, '0');
      const mm = now.getMinutes().toString().padStart(2, '0');
      const ss = now.getSeconds().toString().padStart(2, '0');
      setClock(`${hh}:${mm}:${ss}`);

      // Determine session
      const utcH = now.getUTCHours();
      if (utcH >= 13 && utcH < 20) {
        setMarketSession('US OPEN');
      } else if (utcH >= 1 && utcH < 8) {
        setMarketSession('ASIA');
      } else if (utcH >= 7 && utcH < 16) {
        setMarketSession('EU OPEN');
      } else {
        setMarketSession('AFTER');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const handleMouseEnter = useCallback(() => setIsPaused(true), []);
  const handleMouseLeave = useCallback(() => setIsPaused(false), []);

  return (
    <div
      className="bbg-ticker"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Left session badge */}
      <div className="bbg-ticker__session">
        <span className="bbg-ticker__session-dot" />
        <span className="bbg-ticker__session-label">{marketSession}</span>
      </div>

      {/* Scrolling area */}
      <div className="bbg-ticker__track">
        <div
          ref={scrollRef}
          className="bbg-ticker__ribbon"
          style={{ animationPlayState: isPaused ? 'paused' : 'running' }}
        >
          {/* Double the items for seamless loop */}
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
                const t = item.data;
                return (
                  <span key={`${pass}-t-${i}`} className="bbg-ticker__cell">
                    <span className="bbg-ticker__symbol">{t.symbol}</span>
                    <span className="bbg-ticker__price">{t.price}</span>
                    <span className={`bbg-ticker__change ${t.isUp ? 'up' : 'down'}`}>
                      {t.isUp ? '▲' : '▼'} {t.change}%
                    </span>
                    {t.volume && (
                      <span className="bbg-ticker__vol">{t.volume}</span>
                    )}
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

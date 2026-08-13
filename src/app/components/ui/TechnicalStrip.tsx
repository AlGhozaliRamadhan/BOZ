'use client';

import { useEffect, useRef, useState } from 'react';

/* ────────────────────────────────────────────────────────────────────────────
   TECHNICAL BOARD
   Bloomberg-style indicator panel rendered below the TradingView chart.
   Shows "lots" of indicators by default (ALL), filterable by category,
   and responsive across all screen widths.
   Data: POST /api/market/indicators.
   ──────────────────────────────────────────────────────────────────────────── */

interface IndicatorCandle {
  close: number;
  volume: number;
  RSI: number | null;
  MACD: number | null;
  MACD_Signal: number | null;
  MACD_Hist: number | null;
  SMA_20: number | null;
  SMA_50: number | null;
  SMA_200: number | null;
  BB_High: number | null;
  BB_Mid: number | null;
  BB_Low: number | null;
  BB_Width: number | null;
  ATR: number | null;
  ATR_Percent: number | null;
  OBV: number | null;
  OBV_Trend: boolean | null;
  Volume_Ratio: number | null;
}

interface TechnicalStripProps {
  ticker: string;
}

const DASH = '—';

const CATEGORIES = ['ALL', 'TREND', 'MOMENTUM', 'VOLATILITY', 'VOLUME'] as const;
type Category = (typeof CATEGORIES)[number];
type CellCat = Exclude<Category, 'ALL'>;

interface IndicatorData {
  last: IndicatorCandle;
  closes: number[];
}

/** Fetch the last candle's indicators + close series on the specified timeframe. */
async function fetchIndicators(ticker: string, interval: string): Promise<IndicatorData | null> {
  const res = await fetch('/api/market/indicators', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, interval }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const candles = data?.candles ?? [];
  const last = candles[candles.length - 1];
  if (!last) return null;
  return {
    last: {
      close: last.close ?? 0,
      volume: last.volume ?? 0,
      RSI: last.RSI ?? null,
      MACD: last.MACD ?? null,
      MACD_Signal: last.MACD_Signal ?? null,
      MACD_Hist: last.MACD_Hist ?? null,
      SMA_20: last.SMA_20 ?? null,
      SMA_50: last.SMA_50 ?? null,
      SMA_200: last.SMA_200 ?? null,
      BB_High: last.BB_High ?? null,
      BB_Mid: last.BB_Mid ?? null,
      BB_Low: last.BB_Low ?? null,
      BB_Width: last.BB_Width ?? null,
      ATR: last.ATR ?? null,
      ATR_Percent: last.ATR_Percent ?? null,
      OBV: last.OBV ?? null,
      OBV_Trend: last.OBV_Trend ?? null,
      Volume_Ratio: last.Volume_Ratio ?? null,
    },
    closes: candles.map((cd: any) => cd.close as number),
  };
}

function fmt(v: number | null | undefined, d = 2): string {
  return v == null || !Number.isFinite(v) ? DASH : v.toFixed(d);
}

/** Compact 1.23B / 45.2M / 912K formatting. */
function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

interface CellDef {
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'warn';
  sub?: string;
  subTone?: 'up' | 'down' | 'warn';
  cats: CellCat[];
}

function buildCells(data: IndicatorData | null): CellDef[] {
  const c = data?.last ?? null;
  const closes = data?.closes ?? [];
  const close = c?.close ?? 0;
  const rsi = c?.RSI ?? null;
  const volRatio = c?.Volume_Ratio ?? null;

  // Range stats over the last 50 daily candles (matches the API window).
  const hi = closes.length ? Math.max(...closes) : null;
  const lo = closes.length ? Math.min(...closes) : null;
  const range = hi != null && lo != null && lo > 0 ? ((hi - lo) / lo) * 100 : null;
  const offHigh = hi != null && hi > 0 ? ((close - hi) / hi) * 100 : null;

  const smaTone = (sma: number | null | undefined): 'up' | 'down' | undefined =>
    sma == null ? undefined : close >= sma ? 'up' : 'down';
  const smaVal = (sma: number | null | undefined) =>
    sma == null ? DASH : `$${fmt(sma)} ${close >= sma ? '▲' : '▼'}`;

  const cells: CellDef[] = [
    { label: 'LAST', value: c ? `$${fmt(close)}` : DASH, cats: ['TREND'] },
    {
      label: '50D HIGH',
      value: hi == null ? DASH : `$${fmt(hi)}`,
      sub: offHigh == null || c == null ? undefined : `${fmt(offHigh, 1)}% OFF`,
      subTone: offHigh == null ? undefined : offHigh > -2 ? 'up' : undefined,
      cats: ['TREND'],
    },
    {
      label: '50D LOW',
      value: lo == null ? DASH : `$${fmt(lo)}`,
      cats: ['TREND'],
    },
    {
      label: '50D RANGE',
      value: range == null ? DASH : `${fmt(range, 1)}%`,
      tone: range != null && range > 25 ? 'warn' : undefined,
      cats: ['VOLATILITY'],
    },
    {
      label: 'RSI (14)',
      value: fmt(rsi, 1),
      tone: rsi == null ? undefined : rsi > 70 ? 'warn' : rsi < 30 ? 'up' : undefined,
      sub: rsi == null ? undefined : rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : 'NEUTRAL',
      subTone: rsi == null ? undefined : rsi > 70 ? 'warn' : rsi < 30 ? 'up' : undefined,
      cats: ['MOMENTUM'],
    },
    {
      label: 'MACD',
      value: fmt(c?.MACD, 3),
      tone: c?.MACD != null ? (c.MACD >= 0 ? 'up' : 'down') : undefined,
      cats: ['MOMENTUM'],
    },
    {
      label: 'MACD SIG',
      value: fmt(c?.MACD_Signal, 3),
      tone: c?.MACD_Signal != null ? (c.MACD_Signal >= 0 ? 'up' : 'down') : undefined,
      cats: ['MOMENTUM'],
    },
    {
      label: 'MACD HIST',
      value: fmt(c?.MACD_Hist, 3),
      tone: c?.MACD_Hist != null ? (c.MACD_Hist >= 0 ? 'up' : 'down') : undefined,
      cats: ['MOMENTUM'],
    },
    { label: 'SMA 20', value: smaVal(c?.SMA_20), tone: smaTone(c?.SMA_20), cats: ['TREND'] },
    { label: 'SMA 50', value: smaVal(c?.SMA_50), tone: smaTone(c?.SMA_50), cats: ['TREND'] },
    { label: 'SMA 200', value: smaVal(c?.SMA_200), tone: smaTone(c?.SMA_200), cats: ['TREND'] },
    {
      label: 'ATR',
      value: c?.ATR == null ? DASH : `${fmt(c.ATR)} (${fmt(c.ATR_Percent)}%)`,
      cats: ['VOLATILITY'],
    },
    { label: 'BB HIGH', value: fmt(c?.BB_High), cats: ['VOLATILITY', 'TREND'] },
    { label: 'BB MID', value: fmt(c?.BB_Mid), cats: ['VOLATILITY', 'TREND'] },
    { label: 'BB LOW', value: fmt(c?.BB_Low), cats: ['VOLATILITY', 'TREND'] },
    {
      label: 'BB WIDTH',
      value: fmt(c?.BB_Width, 4),
      tone: c?.BB_Width != null && c.BB_Width > 0.08 ? 'warn' : undefined,
      cats: ['VOLATILITY'],
    },
    { label: 'VOLUME', value: fmtNum(c?.volume), cats: ['VOLUME'] },
    {
      label: 'VOL RATIO',
      value: volRatio == null ? DASH : `${fmt(volRatio)}x`,
      tone: volRatio != null && volRatio > 1.5 ? 'warn' : undefined,
      sub: volRatio != null && volRatio > 1.5 ? 'ELEVATED' : undefined,
      subTone: volRatio != null && volRatio > 1.5 ? 'warn' : undefined,
      cats: ['VOLUME'],
    },
    {
      label: 'OBV',
      value: fmtNum(c?.OBV),
      sub: c?.OBV_Trend == null ? undefined : c.OBV_Trend ? 'UP' : 'DOWN',
      subTone: c?.OBV_Trend == null ? undefined : c.OBV_Trend ? 'up' : 'down',
      cats: ['MOMENTUM', 'VOLUME'],
    },
  ];
  return cells;
}

function Cell({ def }: { def: CellDef }) {
  const color =
    def.tone === 'up' ? 'var(--success)' :
    def.tone === 'down' ? 'var(--danger)' :
    def.tone === 'warn' ? '#fff' : '#fff';
  const subColor =
    def.subTone === 'up' ? 'var(--success)' :
    def.subTone === 'down' ? 'var(--danger)' :
    def.subTone === 'warn' ? '#fff' : '#555';
  return (
    <div style={{ 
      background: '#0a0a0a', 
      padding: '10px 14px', 
      minWidth: 0, 
      display: 'flex', 
      flexDirection: 'column', 
      justifyContent: 'center',
      transition: 'background 0.15s ease' 
    }}>
      <div style={{ color: '#555', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {def.label}
      </div>
      <div style={{ color, fontSize: '13px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {def.value}
      </div>
      {def.sub ? (
        <div style={{ color: subColor, fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {def.sub}
        </div>
      ) : (
        <div style={{ height: '10px', marginTop: '2px' }} />
      )}
    </div>
  );
}

const INTERVALS = [
  { id: '15m', label: '15M' },
  { id: '1h', label: '1H' },
  { id: '4h', label: '4H' },
  { id: '1d', label: '1D' },
  { id: '1wk', label: '1W' },
  { id: '1mo', label: '1M' },
] as const;

export default function TechnicalStrip({ ticker }: TechnicalStripProps) {
  const [data, setData] = useState<IndicatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<Category>('ALL');
  const [interval, setIntervalState] = useState<string>('1d');
  const [intervalMenuOpen, setIntervalMenuOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!ticker) return;
    const mySeq = ++seq.current;
    setLoading(true);
    setData(null);
    fetchIndicators(ticker, interval).then((result) => {
      if (seq.current !== mySeq) return; // stale — ticker or interval changed
      setData(result);
      setLoading(false);
    });
  }, [ticker, interval]);

  const allCells = buildCells(data);
  const visible = cat === 'ALL' ? allCells : allCells.filter((c) => c.cats.includes(cat));

  return (
    <div style={{ background: '#000', display: 'flex', flexDirection: 'column', width: '100%' }}>
      {/* Header Toolbar */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '8px 14px', 
        borderBottom: '1px solid #1a1a1a',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        {/* Left: Title + Timeframe dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
          <span style={{ color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em' }}>
            TECHNICAL • {ticker} • 
          </span>
          <button
            type="button"
            onClick={() => setIntervalMenuOpen(o => !o)}
            style={{
              background: '#0a0a0a', border: '1px solid #2a2a2a', color: '#fff',
              padding: '2px 8px', fontFamily: 'var(--font-mono)', fontSize: '10px',
              fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            {INTERVALS.find(i => i.id === interval)?.label || '1D'}
            <span style={{ fontSize: '8px', color: '#888' }}>▼</span>
          </button>

          {intervalMenuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setIntervalMenuOpen(false)} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: '120px', zIndex: 50,
                background: '#0d0d0d', border: '1px solid #2a2a2a', minWidth: '80px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.8)'
              }}>
                {INTERVALS.map(int => (
                  <button
                    key={int.id}
                    type="button"
                    onClick={() => { setIntervalState(int.id); setIntervalMenuOpen(false); }}
                    style={{
                      display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 10px', background: 'transparent', border: 'none', color: interval === int.id ? '#00c853' : '#fff',
                      fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, cursor: 'pointer', textAlign: 'left'
                    }}
                  >
                    <span>{int.label}</span>
                    {interval === int.id && <span style={{ color: '#00c853', fontSize: '8px' }}>●</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Middle: Category filter tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {CATEGORIES.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setCat(k)}
              style={{
                background: cat === k ? '#1a1a1a' : 'transparent',
                border: `1px solid ${cat === k ? '#fff' : '#2a2a2a'}`,
                color: cat === k ? '#fff' : '#888',
                padding: '2px 9px',
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {k}
            </button>
          ))}
        </div>

        {/* Right: Count & Live state */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#555', fontSize: '9px', letterSpacing: '0.08em' }}>
            {visible.length} INDICATORS
          </span>
          <span style={{ 
            color: loading ? '#ffd700' : data ? '#00c853' : '#d50000', 
            fontSize: '9px', 
            fontWeight: 700,
            letterSpacing: '0.05em' 
          }}>
            {loading ? 'CALCULATING…' : data ? '● LIVE' : 'UNAVAILABLE'}
          </span>
        </div>
      </div>

      {/* Responsive Indicator Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', 
        background: '#1a1a1a', 
        gap: '1px' 
      }}>
        {visible.map((def) => (
          <Cell key={def.label} def={def} />
        ))}
      </div>
    </div>
  );
}
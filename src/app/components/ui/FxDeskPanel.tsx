'use client';

// ─── FxDeskPanel ──────────────────────────────────────────────────────────────
// The pair-specific block on an FX ticker page: live session clock, cross rates
// and a deterministic position-sizing calculator.
//
// The calculator calls the same `fxRiskCalc` the chat tool uses, so a size the
// user reads here matches a size the model quotes back. Nothing is rounded for
// display until it is already computed.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  FX_SECTOR_LABEL,
  formatFxRate,
  formatMinutes,
  fxMarketStatus,
  parseFxSymbol,
} from '@/shared/fx';
import { fxRiskCalc } from '@/shared/fx-risk';

export interface FxDeskCross {
  code: string;
  pair: string;
  price: number | null;
  changePercent: number | null;
}

export interface FxDeskContext {
  rates?: Record<string, number> | null;
  dxy?: { price: number | null; changePercent: number | null } | null;
  crosses?: FxDeskCross[] | null;
}

interface FxDeskPanelProps {
  /** Canonical Yahoo symbol or any pair spelling (`EURUSD`, `EUR/USD`). */
  symbol: string;
  price: number | null;
  context: FxDeskContext | null;
}

const LABEL: Record<string, string> = {
  open: '#00c853',
  closed: '#555564',
};

function pnlColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '#888899';
  return value >= 0 ? '#00c853' : '#d50000';
}

export default function FxDeskPanel({ symbol, price, context }: FxDeskPanelProps) {
  const pair = useMemo(() => parseFxSymbol(symbol), [symbol]);
  const [now, setNow] = useState<Date>(() => new Date());
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const status = useMemo(() => fxMarketStatus(now), [now]);

  const [equity, setEquity] = useState('10000');
  const [riskPct, setRiskPct] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');

  useEffect(() => {
    if (!pair || price == null || !Number.isFinite(price) || price <= 0) return;
    if (seededFor.current === pair.code) return;
    seededFor.current = pair.code;
    setEntry(price.toFixed(pair.precision));
    setStop((price - 50 * pair.pipSize).toFixed(pair.precision));
  }, [pair, price]);

  const result = useMemo(() => {
    if (!pair) return null;
    const entryValue = Number(entry);
    const stopValue = Number(stop);
    if (!Number.isFinite(entryValue) || !Number.isFinite(stopValue) || entryValue <= 0 || stopValue <= 0) {
      return null;
    }
    return fxRiskCalc({
      pair: pair.yahoo,
      entry: entryValue,
      stop: stopValue,
      account_currency: 'USD',
      account_equity: Number.isFinite(Number(equity)) ? Number(equity) : null,
      risk_pct: Number.isFinite(Number(riskPct)) ? Number(riskPct) : null,
      rates: context?.rates ?? null,
    });
  }, [pair, entry, stop, equity, riskPct, context]);

  if (!pair) return null;

  const crosses = (context?.crosses ?? []).filter(cross => cross.price != null).slice(0, 5);
  const openCount = status.sessions.filter(session => session.open).length;

  const inputStyle: CSSProperties = {
    width: '100%',
    background: 'var(--bg-tertiary, #15151b)',
    border: '1px solid var(--border-glass, #2a2a33)',
    color: '#ffffff',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    padding: '5px 7px',
    outline: 'none',
  };
  const labelStyle: CSSProperties = {
    color: '#555564',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    marginBottom: '4px',
    display: 'block',
  };

  return (
    <section aria-label="FX desk" style={{
      border: '1px solid var(--border-glass, #2a2a33)',
      background: 'var(--bg-secondary, #101015)',
      padding: '14px 16px',
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <span style={{ color: '#ffffff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em' }}>FX DESK</span>
          <span style={{ color: '#888899', fontSize: '10px' }}>{pair.pair} · {FX_SECTOR_LABEL[pair.class]}</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', fontSize: '9px', color: '#555564', letterSpacing: '0.05em' }}>
          <span>PIP {pair.pipSize}</span>
          <span>PRECISION {pair.precision}</span>
          <span style={{ color: status.open ? '#00c853' : '#d50000' }}>
            {status.open ? `${openCount} DESK${openCount === 1 ? '' : 'S'} OPEN` : 'MARKET CLOSED'}
          </span>
        </div>
      </div>

      {/* Session clock */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px', marginBottom: '14px' }}>
        {status.sessions.map(session => (
          <div key={session.key} style={{
            border: `1px solid ${session.open ? '#1f4a2c' : 'var(--border-glass, #2a2a33)'}`,
            background: session.open ? 'rgba(0, 200, 83, 0.05)' : 'transparent',
            padding: '7px 8px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#ffffff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em' }}>{session.city.toUpperCase()}</span>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: session.open ? '#00c853' : '#33333d', display: 'inline-block' }} />
            </div>
            <div style={{ color: '#888899', fontSize: '10px', marginTop: '2px' }}>{session.localTime} local</div>
            <div style={{ color: session.open ? LABEL.open : LABEL.closed, fontSize: '9px', fontWeight: 700, marginTop: '3px' }}>
              {session.open
                ? `CLOSES IN ${formatMinutes(session.closesInMinutes)}`
                : `OPENS IN ${formatMinutes(session.opensInMinutes)}`}
            </div>
          </div>
        ))}
      </div>

      {/* Cross rates + dollar index */}
      {(crosses.length > 0 || context?.dxy) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', paddingBottom: '12px', marginBottom: '12px', borderBottom: '1px solid var(--border-glass, #2a2a33)' }}>
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            {crosses.map(cross => (
              <span key={cross.code} style={{ fontSize: '10px', color: '#888899' }}>
                {cross.pair}{' '}
                <strong style={{ color: '#ffffff' }}>{formatFxRate(cross.code, cross.price)}</strong>{' '}
                <span style={{ color: pnlColor(cross.changePercent) }}>
                  {cross.changePercent != null ? `${cross.changePercent >= 0 ? '+' : ''}${cross.changePercent.toFixed(2)}%` : ''}
                </span>
              </span>
            ))}
          </div>
          {context?.dxy && (
            <span style={{ fontSize: '10px', color: '#888899' }}>
              DXY{' '}
              <strong style={{ color: '#ffffff' }}>{context.dxy.price != null ? context.dxy.price.toFixed(2) : '—'}</strong>{' '}
              <span style={{ color: pnlColor(context.dxy.changePercent) }}>
                {context.dxy.changePercent != null ? `${context.dxy.changePercent >= 0 ? '+' : ''}${context.dxy.changePercent.toFixed(2)}%` : ''}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Position sizing */}
      <div style={{ color: '#ffffff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>
        POSITION SIZING · USD ACCOUNT
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
        <label>
          <span style={labelStyle}>EQUITY</span>
          <input style={inputStyle} inputMode="decimal" value={equity} onChange={e => setEquity(e.target.value)} aria-label="Account equity" />
        </label>
        <label>
          <span style={labelStyle}>RISK %</span>
          <input style={inputStyle} inputMode="decimal" value={riskPct} onChange={e => setRiskPct(e.target.value)} aria-label="Risk percent" />
        </label>
        <label>
          <span style={labelStyle}>ENTRY</span>
          <input style={inputStyle} inputMode="decimal" value={entry} onChange={e => setEntry(e.target.value)} aria-label="Entry price" />
        </label>
        <label>
          <span style={labelStyle}>STOP</span>
          <input style={inputStyle} inputMode="decimal" value={stop} onChange={e => setStop(e.target.value)} aria-label="Stop price" />
        </label>
      </div>

      {result?.ok ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px', marginTop: '12px' }}>
            {[
              { label: 'STOP', value: `${result.stop_pips.toFixed(1)} pips` },
              { label: 'SIZE', value: result.lots != null ? `${result.lots} lots` : '—' },
              { label: 'UNITS', value: result.position_units != null ? result.position_units.toLocaleString('en-US') : '—' },
              { label: 'RISK', value: result.risk_amount != null ? `$${result.risk_amount.toFixed(2)}` : '—' },
              { label: 'MARGIN', value: result.margin_required != null ? `$${result.margin_required.toFixed(2)}` : '—' },
            ].map(item => (
              <div key={item.label}>
                <div style={{ color: '#555564', fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em' }}>{item.label}</div>
                <div style={{ color: '#ffffff', fontSize: '12px', fontWeight: 700 }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '8px', fontSize: '9px', color: '#555564' }}>
            <span>
              PIP VALUE {result.pip_value_per_lot != null ? `$${result.pip_value_per_lot.toFixed(2)}/lot` : '—'}
              {result.notional_account != null ? ` · NOTIONAL $${result.notional_account.toLocaleString('en-US')}` : ''}
              {` · ${result.leverage}:1`}
            </span>
            <span style={{ color: result.side === 'long' ? '#00c853' : '#d50000' }}>
              {result.side ? result.side.toUpperCase() : '—'} · {result.stop_distance} {pair.quote}
            </span>
          </div>
          {result.warnings.length > 0 && (
            <div style={{ marginTop: '6px', color: '#d5a000', fontSize: '9px', lineHeight: 1.5 }}>
              {result.warnings.join(' · ')}
            </div>
          )}
        </>
      ) : (
        <div style={{ marginTop: '10px', color: '#555564', fontSize: '10px' }}>
          {result?.error ?? 'Enter a valid entry and stop to size the position.'}
        </div>
      )}
    </section>
  );
}

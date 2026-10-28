import { describe, expect, it } from 'vitest';
import {
  FX_PAIRS,
  FX_SECTORS,
  formatFxPips,
  formatFxRate,
  formatMinutes,
  fxDisplaySymbol,
  fxMarketStatus,
  fxPairByCode,
  fxPips,
  isFxSymbol,
  parseFxSymbol,
  resolveFxSymbol,
} from '../src/shared/fx.js';

describe('FX pair registry', () => {
  it('keeps codes and Yahoo symbols unique', () => {
    expect(new Set(FX_PAIRS.map(p => p.code)).size).toBe(FX_PAIRS.length);
    expect(new Set(FX_PAIRS.map(p => p.yahoo)).size).toBe(FX_PAIRS.length);
  });

  it('covers every sector', () => {
    for (const sector of FX_SECTORS) {
      expect(FX_PAIRS.some(p => p.class === sector)).toBe(true);
    }
  });

  it('derives Yahoo symbols from the base currency', () => {
    expect(fxPairByCode('EURUSD')?.yahoo).toBe('EURUSD=X');
    expect(fxPairByCode('USDJPY')?.yahoo).toBe('JPY=X');
    expect(fxPairByCode('USDIDR')?.yahoo).toBe('IDR=X');
    expect(fxPairByCode('GBPJPY')?.yahoo).toBe('GBPJPY=X');
  });

  it('uses the conventional pip size per quote currency', () => {
    expect(fxPairByCode('EURUSD')?.pipSize).toBe(0.0001);
    expect(fxPairByCode('USDJPY')?.pipSize).toBe(0.01);
    expect(fxPairByCode('USDIDR')?.pipSize).toBe(1);
    expect(fxPairByCode('USDKRW')?.pipSize).toBe(1);
  });

  it('includes the IDX-relevant Asian pairs', () => {
    for (const code of ['USDIDR', 'USDSGD', 'USDMYR', 'USDTHB', 'USDPHP', 'USDKRW', 'USDCNY']) {
      expect(fxPairByCode(code)).not.toBeNull();
    }
  });
});

describe('parseFxSymbol', () => {
  it('accepts every spelling of a pair', () => {
    for (const input of ['EURUSD', 'eurusd', 'EUR/USD', 'eur-usd', 'EUR_USD', 'EURUSD=X', ' EURUSD ']) {
      expect(parseFxSymbol(input)?.code, input).toBe('EURUSD');
    }
  });

  it('accepts Yahoo USD-base symbols', () => {
    expect(parseFxSymbol('JPY=X')?.code).toBe('USDJPY');
    expect(parseFxSymbol('IDR=X')?.code).toBe('USDIDR');
    expect(parseFxSymbol('CAD=X')?.code).toBe('USDCAD');
  });

  it('normalises a non-canonical Yahoo symbol', () => {
    expect(resolveFxSymbol('USDJPY=X')).toBe('JPY=X');
  });

  it('rejects anything that is not a registered pair', () => {
    for (const input of ['AAPL', 'BTC-USD', 'GC=F', 'DX-Y.NYB', '^JKSE', 'BBCA.JK', '', 'EUR']) {
      expect(parseFxSymbol(input), input).toBeNull();
      expect(isFxSymbol(input), input).toBe(false);
    }
  });

  it('returns null from resolveFxSymbol for non-FX input', () => {
    expect(resolveFxSymbol('NVDA')).toBeNull();
    expect(resolveFxSymbol('EURUSD')).toBe('EURUSD=X');
  });
});

describe('FX formatting', () => {
  it('uses the pair precision', () => {
    expect(formatFxRate('EURUSD', 1.087654)).toBe('1.08765');
    expect(formatFxRate('USDJPY', 155.1234)).toBe('155.123');
    expect(formatFxRate('USDIDR', 16250.5)).toBe('16250.50');
    expect(formatFxRate('EURUSD', null)).toBe('—');
  });

  it('converts price moves into pips', () => {
    expect(fxPips('EURUSD', 0.0025)).toBe(25);
    expect(fxPips('USDJPY', 0.25)).toBeCloseTo(25, 6);
    expect(fxPips('USDIDR', 50)).toBe(50);
    expect(formatFxPips('EURUSD', 0.0025)).toBe('+25.0 pips');
    expect(formatFxPips('EURUSD', -0.001)).toBe('-10.0 pips');
    expect(fxPips('AAPL', 1)).toBeNull();
  });

  it('displays the pair form', () => {
    expect(fxDisplaySymbol('EURUSD=X')).toBe('EUR/USD');
    expect(fxDisplaySymbol('AAPL')).toBe('AAPL');
  });
});

describe('FX session clock', () => {
  const at = (iso: string) => new Date(iso);

  it('has London and New York open in the Wednesday overlap', () => {
    const status = fxMarketStatus(at('2026-10-28T12:00:00Z'));
    expect(status.open).toBe(true);
    expect(status.sessions.find(s => s.key === 'london')?.open).toBe(true);
    expect(status.sessions.find(s => s.key === 'newyork')?.open).toBe(true);
    // Tokyo local is 21:00, past its 18:00 close.
    expect(status.sessions.find(s => s.key === 'tokyo')?.open).toBe(false);
  });

  it('opens with Sydney on Sunday night UTC', () => {
    const status = fxMarketStatus(at('2026-11-01T22:00:00Z'));
    expect(status.open).toBe(true);
    expect(status.sessions.find(s => s.key === 'sydney')?.open).toBe(true);
  });

  it('is closed for the weekend', () => {
    const saturday = fxMarketStatus(at('2026-10-31T12:00:00Z'));
    expect(saturday.open).toBe(false);
    expect(saturday.nextEvent?.action).toBe('open');
    expect(saturday.nextEvent?.session).toBe('sydney');
  });

  it('stays open until the New York close on Friday', () => {
    expect(fxMarketStatus(at('2026-10-30T20:30:00Z')).open).toBe(true);
    expect(fxMarketStatus(at('2026-10-30T21:30:00Z')).open).toBe(false);
  });

  it('always reports the next event with a non-negative countdown', () => {
    const status = fxMarketStatus(at('2026-10-28T12:00:00Z'));
    expect(status.nextEvent).not.toBeNull();
    expect(status.nextEvent!.inMinutes).toBeGreaterThanOrEqual(0);
    for (const session of status.sessions) {
      expect(session.localTime).toMatch(/^\d{2}:\d{2}$/);
      if (session.open) expect(session.closesInMinutes).toBeGreaterThan(0);
      else expect(session.opensInMinutes).toBeGreaterThan(0);
    }
  });

  it('formats countdowns', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(135)).toBe('2h 15m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(1500)).toBe('1d 1h');
    expect(formatMinutes(null)).toBe('—');
  });
});

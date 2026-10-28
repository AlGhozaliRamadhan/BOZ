import {
  FX_PAIRS,
  FX_SECTOR_LABEL,
  formatMinutes,
  fxMarketStatus,
  parseFxSymbol,
} from '../shared/fx.js';
import { fxRiskCalc } from '../shared/fx-risk.js';
import { fxService } from '../services/market/fx.service.js';

// ─── Tool Definitions (JSON Schemas) ─────────────────────────────────────────

export const fxRiskCalcDefinition = {
  type: 'function' as const,
  function: {
    name: 'fx_risk_calc',
    description: [
      'Deterministic FX position math: stop distance in pips, pip value, lot size,',
      'notional, margin and risk in the account currency. Prices are pair rates, not dollars.',
      'Use for every FX entry/stop before presenting a plan; quote its output verbatim.',
      'The live rate book is fetched by the tool, so never invent conversion rates.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        pair: { type: 'string', description: 'FX pair, e.g. EURUSD, EUR/USD, GBPJPY, USDIDR' },
        entry: { type: 'number', description: 'Entry rate in quote currency' },
        stop: { type: 'number', description: 'Stop rate in the same quote currency' },
        account_currency: { type: 'string', description: 'Account currency (default USD)' },
        account_equity: { type: 'number', description: 'Account equity for risk-based sizing' },
        risk_pct: { type: 'number', description: 'Risk percent per trade (default 1 when equity is supplied)' },
        units: { type: 'number', description: 'Explicit size in base-currency units (overrides sizing)' },
        lots: { type: 'number', description: 'Explicit size in standard lots (1 lot = 100,000 base units)' },
        leverage: { type: 'number', description: 'Account leverage (default 30:1)' },
      },
      required: ['pair', 'entry', 'stop'],
    },
  },
};

export const fxSessionsDefinition = {
  type: 'function' as const,
  function: {
    name: 'fx_sessions',
    description: [
      'FX session clock: which of Sydney, Tokyo, London and New York are open right now,',
      'their local time, minutes to the next open/close, and whether the market as a whole is open.',
      'Call before saying a pair is tradeable, quiet, or waiting for a session.',
    ].join(' '),
    parameters: { type: 'object', properties: {} },
  },
};

// ─── Tool Executors ───────────────────────────────────────────────────────────

function round(value: number | null, decimals: number): number | null {
  if (value == null || !Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Live pair rates keyed by code, used only for account-currency conversion. */
async function liveRateBook(): Promise<Record<string, number>> {
  try {
    const board = await fxService.getBoard();
    const book: Record<string, number> = {};
    for (const row of board) {
      if (row.price != null && row.price > 0) book[row.code] = row.price;
    }
    return book;
  } catch {
    // No book means account-currency values are withheld, never guessed.
    return {};
  }
}

export async function executeFxRiskCalc(args: Record<string, any>): Promise<string> {
  const rawPair = String(args.pair ?? '');
  const pair = parseFxSymbol(rawPair);
  if (!pair) {
    return JSON.stringify({
      tool: 'fx_risk_calc',
      ok: false,
      error: `Unknown FX pair "${rawPair}". Use a registry pair such as EURUSD, GBPJPY, USDIDR.`,
    });
  }

  const rates = await liveRateBook();
  const result = fxRiskCalc({
    pair: pair.code,
    entry: Number(args.entry),
    stop: Number(args.stop),
    account_currency: args.account_currency == null ? 'USD' : String(args.account_currency),
    account_equity: args.account_equity == null ? null : Number(args.account_equity),
    risk_pct: args.risk_pct == null ? (args.account_equity == null ? null : 1) : Number(args.risk_pct),
    units: args.units == null ? null : Number(args.units),
    lots: args.lots == null ? null : Number(args.lots),
    leverage: args.leverage == null ? null : Number(args.leverage),
    rates,
  });

  return JSON.stringify({
    tool: 'fx_risk_calc',
    ok: result.ok,
    pair: result.pair,
    side: result.side,
    pip_size: result.pip_size,
    entry: round(result.entry, pair.precision),
    stop: round(result.stop, pair.precision),
    stop_distance: result.stop_distance,
    stop_pips: result.stop_pips,
    account_currency: result.account_currency,
    pip_value_per_unit: result.pip_value_per_unit,
    pip_value_per_lot: result.pip_value_per_lot,
    risk_per_unit: result.risk_per_unit,
    position_units: result.position_units,
    lots: result.lots,
    risk_amount: result.risk_amount,
    risk_pct_actual: result.risk_pct_actual,
    notional_base: result.notional_base,
    notional_account: result.notional_account,
    margin_required: result.margin_required,
    leverage: result.leverage,
    warnings: result.warnings,
    rates_used: {
      [pair.code]: rates[pair.code] ?? null,
      [`${pair.base}USD`]: rates[`${pair.base}USD`] ?? null,
      [`USD${pair.quote}`]: rates[`USD${pair.quote}`] ?? null,
    },
    rates_as_of: new Date().toISOString(),
    source: 'Yahoo Finance (delayed, indicative)',
    error: result.error ?? null,
  });
}

export async function executeFxSessions(): Promise<string> {
  const status = fxMarketStatus();
  return JSON.stringify({
    tool: 'fx_sessions',
    open: status.open,
    as_of: status.asOf,
    sessions: status.sessions.map(session => ({
      city: session.city,
      local_time: session.localTime,
      open: session.open,
      action: session.open ? 'close' : 'open',
      in_minutes: session.open ? session.closesInMinutes : session.opensInMinutes,
      in_human: formatMinutes(session.open ? session.closesInMinutes : session.opensInMinutes),
    })),
    next_event: status.nextEvent
      ? {
        city: status.nextEvent.city,
        action: status.nextEvent.action,
        in_minutes: status.nextEvent.inMinutes,
        in_human: formatMinutes(status.nextEvent.inMinutes),
      }
      : null,
    registry: {
      pairs: FX_PAIRS.length,
      sectors: FX_PAIRS.reduce<Record<string, number>>((acc, pair) => {
        const label = FX_SECTOR_LABEL[pair.class];
        acc[label] = (acc[label] ?? 0) + 1;
        return acc;
      }, {}),
    },
  });
}

// ─── Fact Extractors ──────────────────────────────────────────────────────────

export function extractFxRiskCalcFact(args: Record<string, any>, obs: string) {
  try {
    const parsed = JSON.parse(obs) as {
      ok?: boolean;
      error?: string | null;
      pair?: string;
      side?: string | null;
      stop_pips?: number;
      lots?: number | null;
      risk_amount?: number | null;
      warnings?: string[];
    };
    if (parsed.ok === false) {
      return {
        step: 0,
        tool: 'fx_risk_calc',
        fact: `fx_risk_calc ${String(args.pair ?? '')}: ${parsed.error ?? 'rejected'}`,
        quality: 'empty' as const,
      };
    }
    const size = parsed.lots != null ? `${parsed.lots} lots` : 'size withheld';
    const risk = parsed.risk_amount != null ? `, risk ${parsed.risk_amount}` : '';
    return {
      step: 0,
      tool: 'fx_risk_calc',
      fact: `fx_risk_calc ${parsed.pair ?? String(args.pair ?? '')} ${parsed.side ?? ''}: ${parsed.stop_pips ?? '?'} pips stop, ${size}${risk}${parsed.warnings?.length ? ` warnings: ${parsed.warnings.join('; ')}` : ''}`,
      quality: 'confirmed' as const,
    };
  } catch {
    return {
      step: 0,
      tool: 'fx_risk_calc',
      fact: 'fx_risk_calc returned non-JSON output',
      quality: 'empty' as const,
    };
  }
}

export function extractFxSessionsFact(_args: Record<string, any>, obs: string) {
  try {
    const parsed = JSON.parse(obs) as {
      open?: boolean;
      sessions?: Array<{ city: string; open: boolean }>;
      next_event?: { city: string; action: string; in_human: string } | null;
    };
    const openCities = (parsed.sessions ?? []).filter(s => s.open).map(s => s.city);
    const state = parsed.open
      ? `open — ${openCities.join(', ') || 'desk open'}`
      : 'closed — weekend';
    const next = parsed.next_event
      ? `${parsed.next_event.city} ${parsed.next_event.action}s in ${parsed.next_event.in_human}`
      : 'no next event';
    return {
      step: 0,
      tool: 'fx_sessions',
      fact: `FX sessions: ${state}; next ${next}`,
      quality: 'confirmed' as const,
    };
  } catch {
    return {
      step: 0,
      tool: 'fx_sessions',
      fact: 'fx_sessions returned non-JSON output',
      quality: 'empty' as const,
    };
  }
}

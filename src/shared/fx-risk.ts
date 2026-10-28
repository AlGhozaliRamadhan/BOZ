// ─── shared/fx-risk.ts ────────────────────────────────────────────────────────
// Deterministic FX position math: pips, pip value, lot sizing, notional and
// margin. No LLM, no I/O, no rounding hidden inside the caller.
//
// The share-based `risk_calc` in ./risk-math.ts prices a position in dollars per
// share. FX does not work that way: size is quoted in units of the base
// currency, risk per unit depends on the pip size, and the pip value has to be
// converted from the quote currency into the account currency. That is a
// different calculation, so it gets its own function rather than an overload.
//
// Every number a model or a UI prints for an FX plan should come from here.

import { parseFxSymbol, type FxPair } from './fx.js';

export type FxSide = 'long' | 'short';

export interface FxRiskInput {
  pair: string;
  entry: number;
  stop: number;
  account_currency?: string | null;
  account_equity?: number | null;
  risk_pct?: number | null;
  /** Explicit position size in base-currency units. Overrides risk-based sizing. */
  units?: number | null;
  /** Explicit size in standard lots (1 lot = 100,000 base units). */
  lots?: number | null;
  /** Account leverage, e.g. 30 for ESMA retail FX. Defaults to 30. */
  leverage?: number | null;
  /** Known rates keyed by pair code or Yahoo symbol, e.g. { EURUSD: 1.0876 }. */
  rates?: Record<string, number> | null;
}

export interface FxRiskResult {
  ok: boolean;
  error?: string;
  pair: string;
  side: FxSide | null;
  pip_size: number;
  entry: number;
  stop: number;
  stop_distance: number;
  stop_pips: number;
  account_currency: string;
  /** Account-currency value of one pip for one base-currency unit. */
  pip_value_per_unit: number | null;
  /** Account-currency value of one pip for a standard lot. */
  pip_value_per_lot: number | null;
  risk_per_unit: number | null;
  risk_amount: number | null;
  risk_pct_actual: number | null;
  position_units: number | null;
  lots: number | null;
  notional_base: number | null;
  notional_account: number | null;
  margin_required: number | null;
  leverage: number;
  warnings: string[];
}

/** Pair code → rate (quote units per one base unit). */
export type FxRateBook = Record<string, number>;

const DEFAULT_LEVERAGE = 30;
const STANDARD_LOT = 100_000;

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Normalise a `{ symbol: rate }` map into a code-keyed rate book. */
export function buildFxRateBook(rates: Record<string, number> | null | undefined): FxRateBook {
  const book: FxRateBook = {};
  if (!rates) return book;
  for (const [rawSymbol, rawRate] of Object.entries(rates)) {
    if (!isPositive(rawRate)) continue;
    const pair = parseFxSymbol(rawSymbol);
    if (pair) book[pair.code] = rawRate;
  }
  return book;
}

/** Units of `currency` per one USD, or null when the book cannot price it. */
function usdPerUnit(currency: string, book: FxRateBook): number | null {
  if (currency === 'USD') return 1;
  const direct = book[`${currency}USD`];
  if (isPositive(direct)) return direct;
  const inverse = book[`USD${currency}`];
  if (isPositive(inverse)) return 1 / inverse;
  return null;
}

/**
 * Convert an amount between currencies using the direct pair when the book has
 * it, then the inverse, then a USD cross. Returns null when the book has no
 * path, which is preferable to silently inventing a rate.
 */
export function convertFxAmount(
  amount: number,
  from: string,
  to: string,
  book: FxRateBook,
): number | null {
  const source = (from ?? '').trim().toUpperCase();
  const target = (to ?? '').trim().toUpperCase();
  if (!Number.isFinite(amount)) return null;
  if (source === target) return amount;

  const direct = book[`${source}${target}`];
  if (isPositive(direct)) return amount * direct;

  const inverse = book[`${target}${source}`];
  if (isPositive(inverse)) return amount / inverse;

  const sourceUsd = usdPerUnit(source, book);
  const targetUsd = usdPerUnit(target, book);
  if (sourceUsd === null || targetUsd === null) return null;
  return (amount * sourceUsd) / targetUsd;
}

function pipValuePerUnitInAccount(pair: FxPair, account: string, book: FxRateBook): number | null {
  return convertFxAmount(pair.pipSize, pair.quote, account, book);
}

function emptyResult(pair: string, error: string): FxRiskResult {
  return {
    ok: false,
    error,
    pair,
    side: null,
    pip_size: 0,
    entry: 0,
    stop: 0,
    stop_distance: 0,
    stop_pips: 0,
    account_currency: 'USD',
    pip_value_per_unit: null,
    pip_value_per_lot: null,
    risk_per_unit: null,
    risk_amount: null,
    risk_pct_actual: null,
    position_units: null,
    lots: null,
    notional_base: null,
    notional_account: null,
    margin_required: null,
    leverage: DEFAULT_LEVERAGE,
    warnings: [],
  };
}

/**
 * Size an FX position and price its risk.
 *
 * Sizing order: explicit `units`, then explicit `lots`, then `account_equity`
 * with `risk_pct`. Without any of those the position fields stay null — the
 * pip math is still returned, which is what a "what is a pip worth" question
 * needs.
 */
export function fxRiskCalc(input: FxRiskInput): FxRiskResult {
  const rawPair = String(input?.pair ?? '').trim();
  const pair = parseFxSymbol(rawPair);
  if (!pair) {
    return emptyResult(rawPair, `Unknown FX pair: ${rawPair || '(empty)'}`);
  }

  const entry = Number(input.entry);
  const stop = Number(input.stop);
  if (!isPositive(entry) || !isPositive(stop)) {
    return emptyResult(pair.pair, 'Entry and stop must be positive prices.');
  }
  if (entry === stop) {
    return emptyResult(pair.pair, 'Entry and stop are identical, so the position has no risk distance.');
  }

  const warnings: string[] = [];
  const account = String(input.account_currency ?? 'USD').trim().toUpperCase() || 'USD';
  const book = buildFxRateBook(input.rates);
  const side: FxSide = stop < entry ? 'long' : 'short';

  const stopDistance = Math.abs(entry - stop);
  const stopPips = stopDistance / pair.pipSize;
  const leverage = isPositive(input.leverage) ? input.leverage : DEFAULT_LEVERAGE;

  const pipValueUnit = pipValuePerUnitInAccount(pair, account, book);
  if (pipValueUnit === null) {
    warnings.push(`No ${pair.quote}→${account} conversion available; account-currency values are withheld.`);
  }
  const pipValueLot = pipValueUnit === null ? null : pipValueUnit * STANDARD_LOT;
  const riskPerUnit = pipValueUnit === null ? null : stopPips * pipValueUnit;

  if (stopPips < 1) warnings.push('Stop is under one pip wide.');
  if (leverage > 30) warnings.push(`Leverage ${leverage}:1 is above the 30:1 retail default.`);
  if (!['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'SGD', 'IDR'].includes(account)) {
    warnings.push(`Account currency ${account} is unusual; check the rate book.`);
  }

  let units: number | null = null;
  let sizingBasis = '';

  // Sizing division lands a hair under a round number often enough (500 / 0.005
  // = 99,999.999…) that flooring without a tolerance shaves a whole unit off.
  const floorUnits = (value: number): number => Math.floor(value + 1e-6);

  if (isPositive(input.units)) {
    units = floorUnits(input.units);
    sizingBasis = 'explicit units';
  } else if (isPositive(input.lots)) {
    units = floorUnits(input.lots * STANDARD_LOT);
    sizingBasis = 'explicit lots';
  } else if (isPositive(input.account_equity) && isPositive(input.risk_pct) && riskPerUnit !== null) {
    const riskBudget = (input.account_equity * input.risk_pct) / 100;
    units = floorUnits(riskBudget / riskPerUnit);
    sizingBasis = `${input.risk_pct}% of ${input.account_equity} ${account}`;
    if (units === 0) {
      warnings.push('Risk budget is smaller than the risk of one unit at this stop distance.');
    }
  }

  if (units !== null && units < 1) units = 0;

  const notionalBase = units === null ? null : units;
  const notionalAccount = units === null ? null : convertFxAmount(units, pair.base, account, book);
  if (units !== null && notionalAccount === null) {
    warnings.push(`No ${pair.base}→${account} conversion available; notional and margin are withheld.`);
  }

  const marginRequired = notionalAccount === null ? null : notionalAccount / leverage;
  const riskAmount = units === null || riskPerUnit === null ? null : units * riskPerUnit;
  const riskPctActual =
    riskAmount !== null && isPositive(input.account_equity)
      ? (riskAmount / input.account_equity) * 100
      : null;

  if (marginRequired !== null && isPositive(input.account_equity) && marginRequired > input.account_equity) {
    warnings.push('Required margin exceeds account equity.');
  }
  if (units !== null && units === 0) {
    warnings.push('Position size rounds to zero units.');
  }
  if (sizingBasis === '') {
    warnings.push('No position size supplied; pip and risk-per-unit math only.');
  }
  if (stopPips > 0 && stopPips > 500) {
    warnings.push('Stop is unusually wide for FX; check that entry and stop are in the same quote.');
  }

  return {
    ok: true,
    pair: pair.pair,
    side,
    pip_size: pair.pipSize,
    entry,
    stop,
    stop_distance: round(stopDistance, pair.precision + 1),
    stop_pips: round(stopPips, 1),
    account_currency: account,
    pip_value_per_unit: pipValueUnit === null ? null : round(pipValueUnit, 8),
    pip_value_per_lot: pipValueLot === null ? null : round(pipValueLot, 2),
    risk_per_unit: riskPerUnit === null ? null : round(riskPerUnit, 8),
    risk_amount: riskAmount === null ? null : round(riskAmount, 2),
    risk_pct_actual: riskPctActual === null ? null : round(riskPctActual, 3),
    position_units: units,
    lots: units === null ? null : round(units / STANDARD_LOT, 4),
    notional_base: notionalBase,
    notional_account: notionalAccount === null ? null : round(notionalAccount, 2),
    margin_required: marginRequired === null ? null : round(marginRequired, 2),
    leverage,
    warnings,
  };
}

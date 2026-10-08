// ─── shared/risk-math.ts ────────────────────────────────────────────────────
// Deterministic trade math. No LLM, no I/O, no rounding inside.
// risk_calc: stop distance, ATR multiple, sizing, per-target R:R, warnings.
// risk_calc is the single deterministic gate for plan numbers: every
// entry/stop/target/R:R quoted in an answer must come verbatim from its
// output. Do not rely on prompt alone.

export type RiskSide = 'long' | 'short';

export interface RiskCalcInput {
  symbol: string;
  side: RiskSide | string;
  entry: number;
  stop: number;
  targets: number[];
  atr: number;
  account_equity?: number | null;
  risk_pct?: number | null;
}

export interface RiskTargetRR {
  target: number;
  rr: number | null;
}

export interface RiskCalcResult {
  stop_distance: number | null;
  stop_atr_multiple: number | null;
  position_size: number | null;
  per_target: RiskTargetRR[];
  warnings: string[];
}

function isValidPrice(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function hasDuplicates(values: number[]): boolean {
  const seen = new Set<number>();
  for (const v of values) {
    if (seen.has(v)) return true;
    seen.add(v);
  }
  return false;
}

/**
 * Deterministic risk math.
 * stop_distance = |entry - stop|.
 * rr = |target - entry| / stop_distance.
 * position_size = floor(equity * risk_pct/100 / stop_distance).
 */
export function risk_calc(input: RiskCalcInput): RiskCalcResult {
  const {
    side,
    entry,
    stop,
    targets,
    atr,
    account_equity = null,
    risk_pct = 1.0,
  } = input;
  const warnings: string[] = [];

  if (side !== 'long' && side !== 'short') {
    return {
      stop_distance: null,
      stop_atr_multiple: null,
      position_size: null,
      per_target: [],
      warnings: ['invalid_side: side must be "long" or "short"'],
    };
  }

  const entryOk = isValidPrice(entry);
  const stopOk = isValidPrice(stop);
  const targetsIsArray = Array.isArray(targets);
  const targetsOkList: boolean[] = targetsIsArray
    ? (targets as number[]).map((t) => isValidPrice(t))
    : [];
  const allNumbersOk =
    entryOk && stopOk && targetsIsArray && (targets as number[]).length > 0 && targetsOkList.every(Boolean);

  if (!targetsIsArray || (targets as number[]).length === 0) {
    warnings.push('missing_targets: no targets on the profit side of entry');
  }
  if (!allNumbersOk && (targetsIsArray && (targets as number[]).length > 0)) {
    // Only add invalid_number when there is at least a targets array to talk about;
    // missing_targets already covers the empty case. Keep both when both apply.
    if (!entryOk || !stopOk || targetsOkList.some((ok) => !ok)) {
      warnings.push('invalid_number: entry, stop and every target must be finite numbers > 0');
    }
  }
  if (!targetsIsArray) {
    return {
      stop_distance: entryOk && stopOk ? Math.abs((entry as number) - (stop as number)) : null,
      stop_atr_multiple: null,
      position_size: null,
      per_target: [],
      warnings,
    };
  }

  const targetList = targets as number[];
  const stop_distance: number | null =
    entryOk && stopOk ? Math.abs((entry as number) - (stop as number)) : null;

  if (stop_distance === 0) {
    warnings.push('zero_stop_distance: entry equals stop');
  }

  let stop_atr_multiple: number | null = null;
  if (stop_distance != null && typeof atr === 'number' && Number.isFinite(atr) && atr > 0) {
    stop_atr_multiple = stop_distance / (atr as number);
    if (stop_atr_multiple < 1) {
      warnings.push('stop within 1 ATR (inside normal noise)');
    }
  } else {
    warnings.push('invalid_atr: atr must be a finite number > 0 to compute ATR multiple');
  }

  const per_target: RiskTargetRR[] = targetList.map((t) => {
    if (!isValidPrice(t) || stop_distance == null || stop_distance === 0) {
      return { target: t, rr: null };
    }
    return { target: t, rr: Math.abs(t - (entry as number)) / stop_distance };
  });

  // Ordering / profit-side check. Long needs stop < entry < every target.
  // Short is mirrored. Do not reorder; report only.
  let orderingOk = true;
  if (entryOk && stopOk) {
    if (side === 'long') {
      if (!((stop as number) < (entry as number))) orderingOk = false;
      for (const t of targetList) {
        if (!(isValidPrice(t) && t > (entry as number))) {
          orderingOk = false;
          break;
        }
      }
      // Targets should be ordered TP1 < TP2 .. for a long.
      for (let i = 1; i < targetList.length; i++) {
        if (targetList[i] <= targetList[i - 1]) {
          orderingOk = false;
          break;
        }
      }
    } else {
      if (!((stop as number) > (entry as number))) orderingOk = false;
      for (const t of targetList) {
        if (!(isValidPrice(t) && t < (entry as number))) {
          orderingOk = false;
          break;
        }
      }
      for (let i = 1; i < targetList.length; i++) {
        if (targetList[i] >= targetList[i - 1]) {
          orderingOk = false;
          break;
        }
      }
    }
  } else {
    orderingOk = false;
  }
  if (!orderingOk) {
    warnings.push('no targets on the profit side of entry');
    warnings.push('wrong_ordering: long requires stop < entry < every target; short requires stop > entry > every target');
  }

  if (entryOk && stopOk && targetList.length > 0) {
    const nums: number[] = [entry as number, stop as number];
    for (const t of targetList) {
      if (typeof t === 'number' && Number.isFinite(t)) nums.push(t);
    }
    if (hasDuplicates(nums)) {
      warnings.push('duplicate_levels: entry, stop and targets must all differ');
    }
  }

  // R:R check against the final target (most optimistic). Task requires a
  // warning when R:R is below ~1.5.
  const finalRR = per_target.length ? per_target[per_target.length - 1].rr : null;
  if (finalRR != null && finalRR < 1.5) {
    warnings.push('RR below 1.5');
  }

  let position_size: number | null = null;
  if (account_equity == null) {
    // Omitted sizing by design: no warning when equity is unknown.
    position_size = null;
  } else {
    const equityOk =
      typeof account_equity === 'number' && Number.isFinite(account_equity) && account_equity > 0;
    const riskPctOk =
      typeof risk_pct === 'number' && Number.isFinite(risk_pct) && (risk_pct as number) > 0;
    if (!equityOk || !riskPctOk) {
      warnings.push('invalid_sizing_input: account_equity and risk_pct must be finite numbers > 0');
      position_size = null;
    } else if (stop_distance == null || stop_distance === 0) {
      position_size = null;
    } else {
      position_size = Math.floor(
        ((account_equity as number) * ((risk_pct as number) / 100)) / stop_distance,
      );
    }
  }

  return { stop_distance, stop_atr_multiple, position_size, per_target, warnings };
}

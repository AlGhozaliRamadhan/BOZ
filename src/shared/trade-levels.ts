// ─── shared/trade-levels.ts ───────────────────────────────────────────────────
// Reusable trade-level calculator.
// Any agent or analyzer that needs entry / target / stop levels imports this.

import { LATE_KEYWORDS } from './market-constants.js';

export interface TradeLevel {
  action:      'BUY' | 'SELL' | 'WATCH';
  entryRange:  string;
  targetRange: string;
  stopLoss:    string;
  lateSignal:  string;
  spotPrice?:  number;
}

/**
 * Given a live spot price (or null), a directional action, a confidence score,
 * and a news blob, returns concrete entry / target / stop strings plus a
 * late-entry warning flag.
 *
 * When spot is null the function returns textual / qualitative ranges instead
 * of numeric ones so the output is always safe to display.
 */
export function buildTradeLevels(
  spot:       number | null,
  action:     'BUY' | 'SELL' | 'WATCH',
  confidence: number,
  blob:       string,
): TradeLevel {
  const isLate = LATE_KEYWORDS.some(k => blob.toLowerCase().includes(k));
  const resolvedAction: 'BUY' | 'SELL' | 'WATCH' =
    isLate && action !== 'WATCH' ? 'WATCH' : action;

  const lateSignal = isLate
    ? 'YES — momentum looks extended; avoid chasing'
    : 'NO — timing still looks reasonable';

  if (spot == null) {
    return {
      action: resolvedAction,
      entryRange:
        action === 'BUY'  ? 'from support retest to confirmed breakout'      :
        action === 'SELL' ? 'from resistance test to breakdown confirmation'  :
                            'wait for clearer setup',
      targetRange:
        action === 'BUY'  ? 'from first resistance to next resistance'  :
        action === 'SELL' ? 'from first support to next support'        :
                            'monitor',
      stopLoss:
        action === 'BUY'  ? 'below invalidation level' :
        action === 'SELL' ? 'above invalidation level'  :
                            'n/a',
      lateSignal,
    };
  }

  const tight  = confidence >= 75 ? 0.006 : 0.01;
  const tgtLow = confidence >= 70 ? 0.035 : 0.025;
  const tgtHi  = confidence >= 70 ? 0.08  : 0.05;

  let entryLow: number, entryHigh: number, tgt1: number, tgt2: number, stop: number;

  if (resolvedAction === 'BUY') {
    entryLow  = spot * (1 - tight);  entryHigh = spot * (1 + tight);
    tgt1      = spot * (1 + tgtLow); tgt2      = spot * (1 + tgtHi);
    stop      = spot * 0.97;
  } else if (resolvedAction === 'SELL') {
    entryLow  = spot * (1 - tight);  entryHigh = spot * (1 + tight);
    tgt1      = spot * (1 - tgtHi);  tgt2      = spot * (1 - tgtLow);
    stop      = spot * 1.03;
  } else {
    entryLow  = spot * (1 - tight);  entryHigh = spot * (1 + tight);
    tgt1      = spot * 0.97;         tgt2      = spot * 1.03;
    stop      = spot * 0.97;
  }

  const fmt = (n: number) =>
    spot > 1000 ? n.toFixed(2) :
    spot > 10   ? n.toFixed(3) :
                  n.toFixed(5);

  return {
    action:      resolvedAction,
    spotPrice:   spot,
    entryRange:  `from ${fmt(entryLow)} to ${fmt(entryHigh)}`,
    targetRange: `from ${fmt(tgt1)} to ${fmt(tgt2)}`,
    stopLoss:    fmt(stop),
    lateSignal,
  };
}

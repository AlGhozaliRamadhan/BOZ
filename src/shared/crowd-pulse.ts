/**
 * Shared crowd-pulse readout for the CROWD & SOCIAL SENTIMENT card.
 *
 * StockTwits labels only a fraction of its stream, so every consumer must
 * agree on what the numbers mean: bull/bear counts, the bullish share of
 * *labelled* messages, the sampling base, and a confidence tier that reflects
 * how many labelled messages back the read. The Reddit buzz entry stays a
 * separate observation (thread count, not sentiment).
 */

export type StocktwitsConfidence = 'STRONG' | 'MODERATE' | 'THIN' | 'EMPTY';

export interface StocktwitsPulse {
  bullish: number;
  bearish: number;
  labelled: number;
  totalMessages: number | null;
  bullRatio: number | null;
  bearRatio: number | null;
  neutralShare: number | null;
  confidence: StocktwitsConfidence;
  confidenceNote: string;
}

export interface StocktwitsPulseInput {
  bullish?: number | null;
  bearish?: number | null;
  total_with_sentiment?: number | null;
  total_messages?: number | null;
  bull_ratio?: number | null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Normalizes a raw `stocktwits_data` payload into one pulse read.
 *
 * The provider's `bull_ratio` is only honored when it matches the counts we
 * can audit (bullish / bearish / labelled); otherwise it is recomputed so a
 * stale or hand-built payload can never inflate the read.
 */
export function buildStocktwitsPulse(input: StocktwitsPulseInput | null | undefined): StocktwitsPulse {
  const bullish = Math.max(0, Math.round(finiteNumber(input?.bullish)));
  const bearish = Math.max(0, Math.round(finiteNumber(input?.bearish)));
  const labelled = Math.max(0, Math.round(finiteNumber(input?.total_with_sentiment, bullish + bearish)));
  const totalMessages = input?.total_messages == null ? null : Math.max(0, Math.round(finiteNumber(input.total_messages)));

  const auditedRatio = labelled > 0 ? (bullish / labelled) * 100 : null;
  const claimed = typeof input?.bull_ratio === 'number' && Number.isFinite(input.bull_ratio) ? input.bull_ratio : null;
  const bullRatio = auditedRatio ?? (claimed != null ? Math.max(0, Math.min(100, claimed)) : null);
  const bearRatio = bullRatio == null ? null : Math.max(0, Math.min(100, 100 - bullRatio));
  const neutralShare = totalMessages != null && totalMessages > 0
    ? Math.max(0, Math.min(100, ((totalMessages - labelled) / totalMessages) * 100))
    : null;

  const confidence: StocktwitsConfidence =
    labelled >= 20 ? 'STRONG' : labelled >= 8 ? 'MODERATE' : labelled > 0 ? 'THIN' : 'EMPTY';
  const confidenceNote =
    confidence === 'STRONG'
      ? `${labelled} labelled messages — read is stable`
      : confidence === 'MODERATE'
        ? `${labelled} labelled messages — read is usable`
        : confidence === 'THIN'
          ? `only ${labelled} labelled ${labelled === 1 ? 'message' : 'messages'} — treat as a hint`
          : 'no labelled messages — no read';

  return { bullish, bearish, labelled, totalMessages, bullRatio, bearRatio, neutralShare, confidence, confidenceNote };
}

/** One-line contrarian read driven by the audited bull ratio. */
export function stocktwitsContrarianNote(pulse: StocktwitsPulse): string {
  if (pulse.bullRatio == null) return 'Crowd read unavailable — no labelled StockTwits messages.';
  if (pulse.confidence === 'THIN' || pulse.confidence === 'EMPTY') {
    return `Crowd sample too thin (${pulse.labelled} labelled) — wait for more posts before a contrarian read.`;
  }
  if (pulse.bullRatio > 70) return 'Retail euphoria — contrarian caution, require price confirmation.';
  if (pulse.bullRatio < 30) return 'Retail fear — contrarian opportunity, require price confirmation.';
  return 'Crowd balanced — no contrarian edge.';
}

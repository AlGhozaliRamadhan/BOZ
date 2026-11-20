// ─── shared/current-date.ts ────────────────────────────────────────────────
// Today's date, as the model should see it.
//
// A model has no clock. Asked about current conditions it reaches for the
// period it was trained on, which is why a web search could come back with a
// prior year's material while the user expected today's: the query itself was
// written in the model's remembered present. Passing the date in makes "now" a
// fact in the context instead of an assumption, and naming the year gives a
// search query something concrete to anchor to.
//
// The date is a default, not a rule: a historical question is answered from
// historical sources, and a durable fact does not expire. Only a stale result
// presented as the current picture is the failure worth preventing.

export interface CurrentDate {
  /** ISO calendar date in the local timezone, e.g. 2026-11-20. */
  iso: string;
  /** Four-digit year, for search queries that need the year spelled out. */
  year: number;
  /** Weekday name, so relative wording ("next week") has a reference point. */
  weekday: string;
}

export function currentDate(now: Date = new Date()): CurrentDate {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return {
    iso: `${year}-${month}-${day}`,
    year,
    weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
  };
}

/**
 * The block a system prompt carries. Kept as a function so the reasoning for
 * each sentence stays with it: recency is the default because a stale figure
 * reads exactly like a fresh one, and the reader has no way to tell them apart
 * before acting on it.
 */
export function currentDatePrompt(now: Date = new Date()): string {
  const today = currentDate(now);
  return [
    `CURRENT DATE: ${today.weekday}, ${today.iso}.`,
    '  Treat that as now for anything time-sensitive — prices, policy, earnings, rates, a "latest" question. Current information is the working default, and a search query that names a year should name this one unless the user asked about the past, because a stale result presented as today reads as authoritative and can mislead someone acting on it.',
    '  Historical questions are answered from historical sources, and a durable fact does not expire. The point is only that the reader should never mistake an old picture for the current one.',
  ].join('\n');
}

// ─── app/api/chat/effort-passes.ts ───────────────────────────────────────────
// How many "look again" passes each effort tier gets, and what each one is for.
//
// Extracted from `chat.engine.ts` so the schedule is directly assertable. It
// was previously a private const that no test could reach, which is why the
// tier's most universal effect — it always changes BOZ's own verification depth,
// regardless of provider — had no behavioural pin at all.
//
// Effort scales VERIFICATION and COVERAGE, not repetition of the same critique:
//   Medium — recomputes every number against the ledger and deletes what cannot
//            be traced (no exemption words).
//   High   — checks logic and completeness against the ledger.
//   Extra  — numbers check, then coverage.
//   Max    — numbers check, then logic, then coverage.
// Low gets no review pass at all: single pass, no invented figures.
//
// DELIVERY (one render): the complete analysis appears exactly once, as the
// final streamed answer. All review passes are INTERNAL-ONLY — they return a
// full revised draft (or "clean") applied silently, never streamed, never
// yielded to the timeline, never shown under a pass label.

import type { ThoughtEffort } from '@/shared/thought-prompts';

/** Total synthesis calls for one generation, draft included. */
export const EFFORT_PASSES: Readonly<Record<ThoughtEffort, number>> = Object.freeze({
  Low: 1,
  Medium: 2,
  High: 2,
  Extra: 3,
  Max: 4,
});

/**
 * Which review each pass index performs, per tier.
 *
 * Each pass is given a SPECIFIC job rather than re-running the same critique,
 * which is what stops refinement passes from oscillating or from rewriting a
 * good draft with a worse one.
 */
export type ReviewRole = 'numbers' | 'reasoning' | 'coverage';

/** `pass` is 1-based; index 0 is the initial draft and has no review role. */
export function reviewRoleFor(effort: ThoughtEffort, pass: number): ReviewRole {
  if (effort === 'High') return 'reasoning';
  if (effort === 'Extra') return pass === 1 ? 'numbers' : 'coverage';
  if (effort === 'Max') return pass === 1 ? 'numbers' : pass === 2 ? 'reasoning' : 'coverage';
  return 'numbers';
}

/** Resolves the pass count for a run, honouring the Deep Think toggle. */
export function resolvePassCount(options: {
  effort: ThoughtEffort;
  thinkingEnabled: boolean;
  hasResearch: boolean;
}): number {
  // No tools means nothing to verify against, and no thinking means the user
  // asked for one shot: either collapses to a single synthesis call.
  if (!options.thinkingEnabled || !options.hasResearch) return 1;
  return EFFORT_PASSES[options.effort];
}
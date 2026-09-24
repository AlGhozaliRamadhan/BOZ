import type { ExpertSignal } from './screener-contract.js';

function finite(value: number, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Signal clarity as a 5–95% confidence read.
 *
 * Blends directional strength (|score|) with data completeness, penalizes
 * stacked warnings, and caps the read when the signal is NO_TRADE.
 * This describes how clear the technical evidence is — not a win probability,
 * so it never reaches 0% or 100%.
 */
export function signalConfidence(signal: ExpertSignal): number {
  const strength = Math.max(0, Math.min(100, Math.abs(finite(signal.score))));
  const quality = Math.max(0, Math.min(100, finite(signal.dataQuality)));
  const warningCount = Array.isArray(signal.warnings) ? signal.warnings.length : 0;
  let confidence = Math.round(strength * 0.65 + quality * 0.35 - warningCount * 6);
  if (signal.status === 'NO_TRADE') confidence = Math.min(confidence, 35);
  return Math.max(5, Math.min(95, confidence));
}

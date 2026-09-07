import type { ThoughtEffort } from './thought-prompts.js';

/**
 * Decision-relevant research that is required after a ticker dashboard.
 * Higher effort broadens the evidence instead of repeating the same search.
 */
export function requiredTickerResearchQueries(symbol: string, effort: ThoughtEffort): string[] {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) return [];

  const queries = [
    `${normalizedSymbol} latest earnings guidance company catalysts`,
    `${normalizedSymbol} regulation sector competitor macro risks`,
  ];
  return queries.slice(0, effort === 'Low' || effort === 'Medium' ? 1 : 2);
}

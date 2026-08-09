// ─── shared/ledger-facts.ts ───────────────────────────────────────────────────
// Rendering helpers for the evidence ledger.
//
// The ledger is append-only: every confirmed tool result is pushed as its own
// entry, so two sources that disagree about the same quantity (e.g. one says
// foreign ownership is 38.2%, another 34.1%) BOTH survive. The naive
// `.map(fact).join('\n')` flattens them into bare lines that look like they
// could be duplicates — the model then has to *notice* the divergence across
// lines. These helpers surface the disagreement explicitly so the review /
// cross-check passes have something concrete to cross-check against.

export interface LedgerLike {
  fact: string;
  quality: 'confirmed' | 'partial' | 'empty';
}

/**
 * Heuristic: does this fact look like it's making a claim about a *quantity*
 * (a value, rate, price, or level) — the kind of claim two sources can
 * disagree about? Simple and cheap: a bare bullet line that contains a number.
 */
function isQuantitativeFact(fact: string): boolean {
  // Strip source tags we prefix ourselves, e.g. "[Page Title] rest of fact".
  const body = fact.replace(/^\[[^\]]*\]\s*/, '');
  return /\d/.test(body);
}

/**
 * Groups the confirmed facts into quantitative vs qualitative buckets, then
 * returns a prompt block that lists them with explicit disagreement markers.
 *
 * Quantitative facts are grouped by their first 4 significant tokens so rival
 * claims about the same quantity land in one group and get a "DISAGREES WITH"
 * marker rather than being flattened into near-identical lines. Qualititative
 * facts are listed plainly. Empty/partial entries are reported separately.
 *
 * Example output shape:
 *   • [confirmed] [source-a] foreign ownership 38.2% …
 *   • [confirmed] [source-b] foreign ownership 34.1% …  ⚠ DISAGREES with the above
 */
export function formatLedgerFacts(entries: LedgerLike[]): string {
  const confirmed = entries.filter(e => e.quality === 'confirmed');
  const empty     = entries.filter(e => e.quality === 'empty');

  const quant: Array<{ key: string; fact: string }> = [];
  const qual: string[] = [];
  for (const e of confirmed) {
    if (isQuantitativeFact(e.fact)) {
      quant.push({ key: e.fact.replace(/^\[[^\]]*\]\s*/, '').replace(/\d[\d.,%]*/g, '').trim().split(/\s+/).slice(0, 4).join(' '), fact: e.fact });
    } else {
      qual.push(e.fact);
    }
  }

  const groups = new Map<string, string[]>();
  for (const q of quant) {
    const list = groups.get(q.key) ?? [];
    list.push(q.fact);
    groups.set(q.key, list);
  }

  const lines: string[] = [];
  for (const [key, facts] of groups) {
    if (facts.length === 1) {
      lines.push(`  • ${facts[0]}`);
    } else {
      // Multiple sources make a claim about the same quantity → flag the rivalry.
      facts.forEach((f, i) => {
        lines.push(`  • ${f}${i === 0 ? '' : '  ⚠ DISAGREES with the above (same quantity, different value/source)'}`);
      });
    }
    void key;
  }
  for (const q of qual) {
    lines.push(`  • ${q}`);
  }

  const confirmedBlock = lines.length ? lines.join('\n') : '  (none)';

  const emptyBlock = empty.length
    ? empty.map(e => `  • ${e.fact}`).join('\n')
    : '';

  return [
    confirmedBlock,
    emptyBlock ? `GAPS / EMPTY RESULTS (acknowledge these honestly):\n${emptyBlock}` : '',
  ].filter(Boolean).join('\n');
}

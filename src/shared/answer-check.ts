// ─── shared/answer-check.ts ────────────────────────────────────────────────
// Deterministic post-generation gate. Runs after the final answer is drafted,
// before delivery. It only PASSES or FAILS answers — it never modifies them.
// On FAIL the engine regenerates once with the issues appended; on a second
// FAIL the answer ships stamped "FAILED VALIDATION" with the issue list.
// Never silently ship a failing answer.

export interface AnswerCheckToolCall {
  tool: string;
  /** Echoed risk_calc inputs (entry/stop/targets). Empty when unparsable. */
  input: { entry?: unknown; stop?: unknown; targets?: unknown };
  /** Tool output envelope. warnings drives the suppression check. */
  output: { warnings?: unknown };
  /** Raw tool output text. Source of truth for URL allowlisting. */
  text: string;
}

export interface AnswerCheckResult {
  pass: boolean;
  issues: string[];
}

const DEFLECTION_SIGNATURES = [
  'no passing',
  'validate_plan',
  'cannot recommend',
  'without such validation',
  'no trade',
  'no-trade',
];

const DENIAL_PATTERN =
  /no (passing|validated|alternative|combination)|not been validated|cannot recommend|without such validation|no[\s-]trade/i;

const FLAT_STANCE_PATTERN = /^(?:FLAT)[,\s—–-]/im;

/**
 * Label-first stamp opener ("WAIT, medium conviction …"): all-caps label
 * followed by a comma as the first words. Uppercase-only is the
 * discriminator — a natural "Wait, ..." (mixed case) never matches.
 */
const LABEL_STAMP_OPENER = /^(WAIT|FLAT|LONG|SHORT)\s*,/;

const FIRST_PERSON_TAKE_PATTERN = /I would|I'd|I see|My take/i;

const RAW_OUTPUT_PATTERN = /\d\.9{3,}|stop_distance|"rr"/;

const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * Markdown `[label](url)` and trailing prose punctuation must not become part
 * of the URL: `\S+` captures the link's closing `)` (and any trailing `.`, `,`
 * etc.), which then never exact-matches the tool log's clean URL — a false
 * "unsourced URL" failure on a grounded citation.
 */
function normalizeUrl(u: string): string {
  return u.replace(/[)\]}"'.,;:!?]+$/g, '');
}

/**
 * Feed/API infrastructure the model must name inline, never paste as a link
 * target — even when a tool output happens to carry it. Genuine publisher /
 * article URLs never match this shape.
 */
const ENDPOINT_URL_PATTERN = /(^|[:\/.])api\.|\/api\/|graphdata|alternative\.me|\/rss|search\.rss|[?&]ceid=/i;

function isEndpointUrl(u: string): boolean {
  return ENDPOINT_URL_PATTERN.test(u);
}

export function answerCheck(answer: string, toolLog: AnswerCheckToolCall[]): AnswerCheckResult {
  const issues: string[] = [];

  // 1) Suppression: denial language while a zero-warning call exists.
  const passing = toolLog.filter(
    (c) => c.tool === 'risk_calc' && isWarningFree(c.output?.warnings),
  );
  if (passing.length > 0 && DENIAL_PATTERN.test(answer)) {
    const cited = passing.every((c) =>
      riskNumbers(c).every((n) => answer.includes(String(n))),
    );
    if (!cited) {
      issues.push(
        'zero-warning risk_calc call exists; answer claims none and omits its numbers',
      );
    }
  }

  // 2) Deflection signatures — always wrong.
  const lowered = answer.toLowerCase();
  for (const sig of DEFLECTION_SIGNATURES) {
    if (lowered.includes(sig)) {
      issues.push(`deflection signature: '${sig}'`);
    }
  }

  // 3) Raw tool output / float garbage.
  if (RAW_OUTPUT_PATTERN.test(answer)) {
    issues.push('raw tool output or unrounded float in answer');
  }

  // 4) URLs must come from tool outputs (normalized: trailing markdown /
  // prose punctuation stripped on both sides), and endpoint URLs are never
  // citable link targets — name the source inline instead.
  const known = new Set(
    toolLog.flatMap((c) => (c.text?.match(URL_PATTERN) ?? []).map(normalizeUrl)),
  );
  for (const raw of new Set(answer.match(URL_PATTERN) ?? [])) {
    const u = normalizeUrl(raw);
    if (isEndpointUrl(u)) {
      issues.push(`API/endpoint URL pasted as source (name it inline instead): ${u}`);
    } else if (!known.has(u)) {
      issues.push(`URL not in any tool output: ${u}`);
    }
  }

  // 5) Completeness.
  if (!/[.!?]$/.test(answer.trimEnd())) {
    issues.push('answer does not end with a complete sentence');
  }

  // 6) Scenario-first shape — trading analyses only (risk_calc or dashboard
  // in the log). General chat (greetings, help, …) is exempt: no table/take
  // is required there. For trading: never a bare refusal, always the
  // likely-path table + a first-person take with the wait trigger.
  const isTrading = toolLog.some(
    (c) => c.tool === 'risk_calc' || c.tool === 'fetch_ticker_dashboard',
  );
  if (isTrading) {
    if (/no[\s-]trade/i.test(answer)) {
      issues.push('bare no-trade refusal; give the likely-path scenario instead');
    }
    if (FLAT_STANCE_PATTERN.test(answer)) {
      issues.push('FLAT stance banned; use WAIT plus the trigger and what you would do there');
    }
    if (LABEL_STAMP_OPENER.test(answer.trimStart())) {
      issues.push('label-stamp opener; open in your own words with direction, conviction, and invalidation woven into sentences');
    }
    // The table must be REAL markdown — inline pipes ("| Base: … | …")
    // render as prose, not a table — with separated plan columns, so Entry /
    // Stop / TP1 / TP2 are never crammed into one cell.
    const tableLines = answer.split('\n');
    const delimIdx = tableLines.findIndex((l) => /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(l));
    if (delimIdx <= 0) {
      issues.push('missing real likely-path table (needs a header row plus a |---|---| delimiter row)');
    } else {
      const header = [...tableLines.slice(0, delimIdx)].reverse().find((l) => l.includes('|')) ?? '';
      const cols = header.toLowerCase();
      for (const col of ['entry', 'stop', 'tp1', 'tp2']) {
        if (!cols.includes(col)) {
          issues.push(`likely-path table missing separated ${col.toUpperCase()} column`);
          break;
        }
      }
    }
    if (!FIRST_PERSON_TAKE_PATTERN.test(answer)) {
      issues.push('missing first-person take (I would wait for price X and …)');
    }
  }

  return { pass: issues.length === 0, issues };
}

/** Python parity: `not out.get("warnings")` — missing, null, or [] all count as warning-free. */
function isWarningFree(warnings: unknown): boolean {
  if (warnings == null) return true;
  if (Array.isArray(warnings)) return warnings.length === 0;
  return !warnings;
}

function riskNumbers(c: AnswerCheckToolCall): unknown[] {
  const targets = Array.isArray(c.input?.targets) ? c.input.targets : [];
  return [c.input?.entry, c.input?.stop, ...targets];
}

// ─── shared/tool-labels.ts ────────────────────────────────────────────────────
// The one place that maps internal tool names to what the reader actually sees.
//
// The thinking panel used to print the wire name — `fetch_ticker_dashboard` —
// which is a plumbing fact the user never asked for. Labels here are short
// plain-English verbs that carry the ticker or query when one is available,
// with a progressive form while the call runs ("Loading VOO dashboard") and a
// past form once it settles ("Loaded VOO dashboard"), plus a retry form shown
// under a transient failure ("Retrying VOO dashboard").
//
// Pure module: no DOM, no imports — safe for API routes and client components.

export type ToolLabelPhase = 'running' | 'done' | 'retry';

const SUBJECT_LIMIT = 36;

function clip(subject: string): string {
  const trimmed = subject.replace(/\s+/g, ' ').trim();
  return trimmed.length > SUBJECT_LIMIT ? `${trimmed.slice(0, SUBJECT_LIMIT).trimEnd()}…` : trimmed;
}

/** The ticker-ish argument a tool was given, if any. */
function tickerArg(args?: Record<string, unknown>): string {
  const raw = args?.symbol ?? args?.symbol_or_name ?? args?.pair ?? '';
  const clipped = clip(String(raw ?? ''));
  // Tickers are rendered uppercase ("Loaded NVDA dashboard"); a free-text
  // name with spaces is left as written so a phrase stays a phrase.
  return /\s/.test(clipped) ? clipped : clipped.toUpperCase();
}

/** The free-text/search argument a tool was given, if any. */
function queryArg(args?: Record<string, unknown>): string {
  const raw = args?.query ?? '';
  return clip(String(raw ?? ''));
}

function agentArg(args?: Record<string, unknown>): string {
  const raw = String(args?.agent_name ?? '').trim();
  return clip(raw || 'specialist');
}

function skillArg(args?: Record<string, unknown>): string {
  const raw = String(args?.name ?? '').trim().replace(/^\//, '') || 'requested';
  return clip(raw);
}

function universeArg(args?: Record<string, unknown>): string {
  const raw = String(args?.universe ?? '').trim().toLowerCase();
  const names: Record<string, string> = {
    idx: 'IDX screener',
    us: 'US screener',
    crypto: 'crypto screener',
    forex: 'forex screener',
  };
  return names[raw] ?? 'market screener';
}

/**
 * A tool's label, rendered for the phase it is in.
 *
 * Every known call site gets an exact phrase; anything else falls back to a
 * de-snake-cased stand-in so a future tool can never reintroduce raw
 * `snake_case` into the panel even before it earns a proper phrase.
 */
export function toolLabel(
  tool: string,
  args?: Record<string, unknown>,
  phase: ToolLabelPhase = 'running',
): string {
  switch (tool) {
    case 'fetch_ticker_dashboard':
      return withTicker('Loading', 'Loaded', 'Retrying', 'dashboard', args, phase);
    case 'fetch_price':
      return withTicker('Checking', 'Checked', 'Retrying', 'price', args, phase);
    case 'fetch_news':
      return withQuery(
        'Scanning news on', 'Scanned news on', 'Retrying the news scan',
        'Scanning the news', 'Scanned the news', args, phase,
      );
    case 'web_search':
      return withQuery(
        'Searching the web for', 'Searched the web for', 'Retrying the web search',
        'Searching the web', 'Searched the web', args, phase,
      );
    case 'fetch_sentiment':
      return phaseOnly('Reading crowd sentiment', 'Read crowd sentiment', 'Retrying the sentiment read', phase);
    case 'fetch_global_market_snapshot':
      return phaseOnly('Checking global markets', 'Checked global markets', 'Retrying the market check', phase);
    case 'scan_indonesia_momentum': {
      const screener = universeArg(args);
      if (phase === 'retry') return `Retrying the ${screener}`;
      return `${phase === 'done' ? 'Scanned' : 'Scanning'} the ${screener}`;
    }
    case 'risk_calc': {
      const subject = tradePlanSubject(args);
      return phaseOnly(
        `Validating ${subject}`,
        `Validated ${subject}`,
        'Retrying the plan check',
        phase,
      );
    }
    case 'fx_risk_calc': {
      const subject = tradePlanSubject(args);
      return phaseOnly(
        `Validating ${subject}`,
        `Validated ${subject}`,
        'Retrying the plan check',
        phase,
      );
    }
    case 'fx_sessions':
      return phaseOnly('Checking FX sessions', 'Checked FX sessions', 'Retrying the session check', phase);
    case 'summon_agent': {
      const agent = agentArg(args);
      if (phase === 'retry') return `Retrying the ${agent} consult`;
      return phase === 'done' ? `Consulted ${agent}` : `Consulting ${agent}`;
    }
    case 'update_memory':
      return phaseOnly('Saving your preference', 'Saved your preference', 'Retrying the save', phase);
    case 'list_skills':
      return phaseOnly('Reviewing BOZ skills', 'Reviewed BOZ skills', 'Retrying the skill review', phase);
    case 'get_skill':
      return phaseOnly(
        `Loading the ${skillArg(args)} skill`,
        `Loaded the ${skillArg(args)} skill`,
        'Retrying the skill load',
        phase,
      );
    default:
      return fallbackLabel(tool, phase);
  }
}

/** Verb side: progressive while running, past once settled, retry prefix otherwise. */
function phaseOnly(running: string, done: string, retry: string, phase: ToolLabelPhase): string {
  if (phase === 'retry') return retry;
  return phase === 'done' ? done : running;
}

function tradePlanSubject(args?: Record<string, unknown>): string {
  const symbol = tickerArg(args);
  return symbol ? `the ${symbol} trade plan` : 'the trade plan';
}

function withTicker(
  runningVerb: string,
  doneVerb: string,
  retryVerb: string,
  noun: string,
  args: Record<string, unknown> | undefined,
  phase: ToolLabelPhase,
): string {
  const symbol = tickerArg(args);
  if (!symbol) {
    return phaseOnly(
      `${runningVerb} the ${noun}`,
      `${doneVerb} the ${noun}`,
      `Retrying the ${noun}`,
      phase,
    );
  }
  return phaseOnly(
    `${runningVerb} ${symbol} ${noun}`,
    `${doneVerb} ${symbol} ${noun}`,
    `Retrying ${symbol} ${noun}`,
    phase,
  );
}

function withQuery(
  runningVerb: string,
  doneVerb: string,
  retryLabel: string,
  bareRunning: string,
  bareDone: string,
  args: Record<string, unknown> | undefined,
  phase: ToolLabelPhase,
): string {
  const query = queryArg(args);
  if (!query) {
    // No subject, no dangling preposition: "Searched the web", never
    // "Searched the web for…".
    return phaseOnly(bareRunning, bareDone, retryLabel, phase);
  }
  return phaseOnly(`${runningVerb} "${query}"`, `${doneVerb} "${query}"`, retryLabel, phase);
}

/**
 * Last resort for a tool that never earned a phrase. Splits the wire name on
 * underscores so even an unregistered tool can never render as `fetch_thing`
 * — at worst the reader sees plain words.
 */
function fallbackLabel(tool: string, phase: ToolLabelPhase): string {
  const words = String(tool || 'tool')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return phaseOnly(`Running ${words}`, `${words} finished`, `Retrying ${words}`, phase);
}

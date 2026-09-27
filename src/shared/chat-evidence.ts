// The chat keeps raw observations for tool details, and gives every model pass
// the same compact data. Availability is bookkeeping, not market evidence.
export interface EvidenceCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolEvidence {
  call: EvidenceCall;
  raw: string;
  data: string;
  unavailable: string[];
  clarification: boolean;
  recoveryAttempted: boolean;
  recoveryBlocked?: boolean;
}

function safeInline(text: string): string {
  return text.replace(/[\r\n]/g, ' ').replace(/[\\`*_{}\[\]()<>!#|]/g, '\\$&').slice(0, 140);
}

function failureReason(raw: string): string {
  if (/timeout|timed out|ETIMEDOUT/i.test(raw)) return 'the source timed out';
  if (/429|rate.?limit/i.test(raw)) return 'the source rate-limited the request';
  if (/No news found|returned no results/i.test(raw)) return 'the available sources returned no results';
  if (/budget reached/i.test(raw)) return 'the request budget was reached';
  return 'the source did not return usable data';
}

const PLACEHOLDER = /^(?:n\/?a|--|null|undefined|unavailable|not available|unknown)\s*[%x]?$/i;
const FAILED_OUTPUT = /^(?:Tool execution failed|Failed to fetch|No market data available|No price data found|No news found|Could not find ticker|Ticker .+ was not found|Web search .+ returned no results)/i;
const MISSING_LINE = /^(?:[•-]\s*)?(?:(?:Hourly candles|.* data|.* observations|.* source|.* feed) (?:unavailable|not available)|No source-attributed crowd observations were available|No significant news|No (?:usable|relevant|recent) .*(?:found|available))/i;

export function evidenceKey(call: EvidenceCall): string {
  function canonical(value: unknown): unknown {
    if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ').toLowerCase();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
  }
  return `${call.name}:${JSON.stringify(canonical(call.arguments))}`;
}

function compactJson(value: unknown, path: string, gaps: string[]): unknown {
  if (value == null || (typeof value === 'string' && (!value.trim() || PLACEHOLDER.test(value)))) {
    if (path) gaps.push(path);
    return undefined;
  }
  if (Array.isArray(value)) {
    // An empty result set is a valid observation; null items are not.
    return value.map((item, index) => compactJson(item, `${path}[${index}]`, gaps)).filter(item => item !== undefined);
  }
  if (typeof value === 'object') {
    const fields = Object.entries(value).flatMap(([key, item]) => {
      const compacted = compactJson(item, path ? `${path}.${key}` : key, gaps);
      return compacted === undefined ? [] : [[key, compacted]];
    });
    return fields.length ? Object.fromEntries(fields) : undefined;
  }
  return value;
}

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'object') return Object.values(value).some(hasValue);
  return true; // false and 0 are observations, too.
}

function fieldLabel(field: string): string {
  return field.replace(/^\s*[•-]\s*/, '').split(/[:(]/, 1)[0].trim().slice(0, 90);
}

/** Strip only explicit placeholders from locally formatted fields, not arbitrary source prose. */
export function compactEvidenceText(raw: string): { data: string; unavailable: string[] } {
  const unavailable: string[] = [];
  const trimmed = raw.trim();
  if (/^[{[]/.test(trimmed)) {
    try {
      const value = compactJson(JSON.parse(trimmed), '', unavailable);
      return { data: hasValue(value) ? JSON.stringify(value, null, 2) : '', unavailable: [...new Set(unavailable)] };
    } catch { /* The dashboard uses bracketed timeframe headings, too. */ }
  }

  const lines: string[] = [];
  let headings: string[] = [];
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    if (/^(?:===.+===$|\[[^\]]+\]:$|[^:|]+:$)/.test(text)) {
      if (/^===/.test(text)) headings = [];
      else if (/^\[/.test(text)) headings = headings.filter(heading => /^===/.test(heading));
      else headings = headings.filter(heading => /^===|^\[/.test(heading));
      headings.push(text);
      continue;
    }
    if (MISSING_LINE.test(text)) { unavailable.push(fieldLabel(text)); continue; }
    // Fields can share a line. Missing subfields in parentheses are removed
    // first, keeping the independently usable price/indicator beside them.
    const fields = line.split(/\s+\|\s+/).flatMap(field => {
      let clean = field.replace(/\([^()]*?(?:\bN\/A\b|\$?--|\bundefined\b|\bnull\b)[^()]*?\)/gi, (missing) => {
        const subfields = missing.slice(1, -1).split(/,\s*/);
        for (const part of subfields) {
          if (/(?:N\/A|\$?--|undefined|null)/i.test(part)) unavailable.push(part.includes(':') ? fieldLabel(part) : fieldLabel(field));
        }
        // Retain valid siblings such as Upper: 100 and Lower: 80 when only
        // the middle band is missing. Plain tool text need not keep parentheses.
        return subfields.filter((part: string) => !/(?:N\/A|\$?--|undefined|null)/i.test(part)).join(', ');
      });
      if (/(?:^|[:\s])(?:\$?--|N\/A|undefined|null)(?=$|[\s,%x)])/i.test(clean) && /:|\$/.test(clean)) {
        unavailable.push(fieldLabel(clean));
        return [];
      }
      clean = clean.trim();
      if (!clean || PLACEHOLDER.test(clean)) return [];
      return [clean];
    });
    if (fields.length) {
      lines.push(...headings, fields.join(' | '));
      headings = [];
    }
  }
  return { data: lines.join('\n'), unavailable: [...new Set(unavailable)] };
}

export function projectToolEvidence(call: EvidenceCall, raw: string): ToolEvidence {
  const clarification = /(?:Could not find ticker|Ticker .+ was not found|check if the ticker is valid|ask.*(?:verify|clarification|clarify))/i.test(raw);
  const failed = !raw.trim() || FAILED_OUTPUT.test(raw.trim());
  // News and search already cascade through their alternative providers.
  const recoveryAttempted = (call.name === 'fetch_news' && /^No news found/i.test(raw))
    || (call.name === 'web_search' && /returned no results across all search providers/i.test(raw));
  // External articles must retain their prose verbatim, including qualifiers.
  const projection = failed ? { data: '', unavailable: ['source data'] }
    : ['fetch_news', 'web_search', 'summon_agent'].includes(call.name)
      ? { data: raw, unavailable: [] }
      : compactEvidenceText(raw);
  if (!projection.data && !projection.unavailable.length) projection.unavailable.push('source data');
  return { call, raw, ...projection, clarification, recoveryAttempted, recoveryBlocked: /request tool budget reached/i.test(raw) };
}

/** Request-local cache and recovery allowance: repeated calls cannot reset it. */
export class ChatEvidence {
  private observations = new Map<string, ToolEvidence>();
  private recovery = new Set<string>();

  get(call: EvidenceCall): ToolEvidence | undefined { return this.observations.get(evidenceKey(call)); }

  record(observation: ToolEvidence): ToolEvidence {
    const key = evidenceKey(observation.call);
    const previous = this.observations.get(key);
    if (observation.recoveryAttempted) this.recovery.add(key);
    observation.recoveryAttempted ||= this.recovery.has(key);
    // A failed retry must not erase useful partial data from the first try.
    if (!observation.data && previous?.data) {
      observation.data = previous.data;
      observation.unavailable = previous.unavailable;
    }
    this.observations.set(key, observation);
    return observation;
  }

  claimRecovery(observation: ToolEvidence): boolean {
    const key = evidenceKey(observation.call);
    if (observation.clarification || !observation.unavailable.length || this.recovery.has(key)
      || !['fetch_price', 'fetch_ticker_dashboard', 'fetch_global_market_snapshot', 'fetch_sentiment', 'fetch_news', 'web_search'].includes(observation.call.name)) return false;
    this.recovery.add(key);
    observation.recoveryAttempted = true;
    return true;
  }

  data(): string {
    return [...this.observations.values()].filter(item => item.data)
      .map(item => `=== ${item.call.name} ${JSON.stringify(item.call.arguments)} ===\n${item.data}`).join('\n\n');
  }

  availability(): string {
    return [...this.observations.values()].filter(item => item.unavailable.length)
      .map(item => `${item.call.name} ${JSON.stringify(item.call.arguments)}: ${item.unavailable.slice(0, 4).join(', ')}${item.unavailable.length > 4 ? ', other optional fields' : ''}; ${item.clarification ? 'clarification required' : item.recoveryBlocked ? 'request budget reached' : item.recoveryAttempted ? 'recovery exhausted; do not repeat' : 'unavailable'}`).join('\n');
  }

  failureSummary(): string {
    const labels: Record<string, string> = { fetch_price: 'price data', fetch_ticker_dashboard: 'dashboard data', fetch_global_market_snapshot: 'global market data', fetch_sentiment: 'sentiment data', fetch_news: 'news', web_search: 'web research' };
    const unresolved = [...this.observations.values()].filter(item => item.unavailable.length && !item.clarification);
    if (!unresolved.length) return '';
    const descriptions = unresolved.map(item => {
      const target = safeInline(String(item.call.arguments.symbol ?? item.call.arguments.symbol_or_name ?? item.call.arguments.query ?? ''));
      const name = `${labels[item.call.name] ?? safeInline(item.call.name)}${target ? ` for ${target}` : ''}`;
      const cause = item.data ? `${item.unavailable.slice(0, 2).map(safeInline).join(', ')}${item.unavailable.length > 2 ? ' and other fields' : ''} were not supplied` : failureReason(item.raw);
      const attempt = item.recoveryBlocked ? 'the request budget prevented another attempt' : `${cause}${item.recoveryAttempted ? ' after a retry or alternative source' : ''}`;
      return `${name} ${item.data ? 'remains partial' : 'is unavailable'} (${attempt})`;
    });
    const hasData = [...this.observations.values()].some(item => item.data);
    return `Data availability: ${descriptions.join('; ')}. ${hasData ? 'The assessment uses the available evidence only.' : 'There is not enough verified data for a current trade setup.'}`;
  }
}

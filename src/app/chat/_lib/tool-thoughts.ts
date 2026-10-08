export interface ToolThoughtData {
  tool: string;
  args?: Record<string, unknown>;
  fact?: string;
}

function formatToolArguments(args?: Record<string, unknown>): string {
  const entries = Object.entries(args ?? {}).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? ` (${entries.map(([, value]) => String(value)).join(', ')})` : '';
}

export function toolThoughtMarker(tool: string, args?: Record<string, unknown>): string {
  return `tool used: ${tool}${formatToolArguments(args)}`;
}

export function toolStartThought(tool: string, args?: Record<string, unknown>): string {
  return toolThoughtMarker(tool, args);
}

export function updateToolResultThought(
  thoughts: string[],
  { tool, args, fact }: ToolThoughtData,
): string[] {
  const marker = toolThoughtMarker(tool, args);
  const resultText = fact ? ` — ${fact.substring(0, 140)}${fact.length > 140 ? '…' : ''}` : '';
  const next = [...thoughts];
  const thoughtIndex = next.findLastIndex(thought => thought === marker);

  if (thoughtIndex === -1) {
    next.push(`${marker}${resultText}`);
  } else {
    next[thoughtIndex] = `${marker}${resultText}`;
  }

  return next;
}

// ─── AI-see + track layer ────────────────────────────────────────────────────
// Research synthesis (Perplexity / ChatGPT / Copilot timeline pattern):
// a collapsed timeline entry should answer three things at a glance —
//   (1) what I checked (the `tool used:` marker above, kept as-is),
//   (2) the raw read (one short line of what the fact actually made the
//       model think — varied phrasing, grounded in the fact's own numbers
//       and words, never a canned template),
//   (3) where we are (a periodic `Track x/y` line so the user can follow
//       structure → participation → catalysts → scenario → validated plan
//       without re-reading every step).
// These helpers are deterministic (no extra LLM call): the read is derived
// from the tool name + its fact string, so it is cheap, testable, and can
// never invent a level — every number it echoes comes from the fact itself.

export const AI_SEE_PREFIX = 'I see:';
export const TRACK_PREFIX = 'Track';

export const SCENARIO_TRACK_STAGES = [
  'structure',
  'participation',
  'catalysts',
  'scenario',
  'validated plan',
] as const;

export type ScenarioTrackStage = (typeof SCENARIO_TRACK_STAGES)[number];

const NEXT_AFTER_TOOL: Record<string, ScenarioTrackStage> = {
  fetch_price: 'structure',
  fetch_ticker_dashboard: 'participation',
  fetch_sentiment: 'scenario',
  web_search: 'scenario',
  fetch_news: 'scenario',
  scan_indonesia_momentum: 'participation',
  fetch_global_market_snapshot: 'catalysts',
  risk_calc: 'validated plan',
  summon_agent: 'scenario',
  list_skills: 'structure',
  get_skill: 'structure',
};

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/** Deterministic pick: same fact → same phrasing, different facts → varied. */
function pickVariant(variants: string[], seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return variants[Math.abs(h) % variants.length];
}

/** Numbers already present in the fact — the only numbers a read may echo. */
function numbersIn(fact: string, max = 2): string[] {
  const hits = fact.match(/\$?[\d,]+\.\d+%?|\$[\d,]+|\b\d+\.\d+%?|\b\d+%/g) ?? [];
  return [...new Set(hits)].slice(0, Math.max(1, max));
}

/** Short grounded fragment of the fact (single line, word-truncated). */
function factSnippet(fact: string, max = 64): string {
  const oneLine = fact.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  const slice = oneLine.slice(0, Math.max(0, max - 1));
  const cut = slice.lastIndexOf(' ');
  return `${(cut > max * 0.5 ? slice.slice(0, cut) : slice).trimEnd()}…`;
}

/** Quoted query inside a fact (`Web search "q": …`), if any. */
function quotedQuery(fact: string): string {
  return fact.match(/"([^"]{2,60})"/)?.[1] ?? '';
}

/**
 * Reads are NOT fixed to short: a thin fact earns one quick line, a rich fact
 * earns the take plus a grounded second sentence (levels, sample, flag).
 * Cap is a backstop, not a target.
 */
function capRead(line: string, max = 420): string {
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

/** Labeled levels echoed straight from a dashboard fact — echo only, never computed. */
function dashboardLevels(fact: string, max = 4): string {
  const pairs: Array<[RegExp, string]> = [
    [/Price:\s*\$?([\d,.]+)/i, 'price'],
    [/SMA-?20(?::|\s+at)?\s*\$?([\d,.]+)/i, 'SMA-20'],
    [/SMA-?50(?::|\s+at)?\s*\$?([\d,.]+)/i, 'SMA-50'],
    [/RSI[^\d]{0,12}([\d.]+)/i, 'RSI'],
    [/Support:\s*\$?([\d,.]+)/i, 'support'],
    [/Resistance:\s*\$?([\d,.]+)/i, 'resistance'],
    [/ATR:\s*\$?([\d,.]+)/i, 'ATR'],
  ];
  const out: string[] = [];
  for (const [re, label] of pairs) {
    const m = fact.match(re);
    if (m) {
      const v = m[1].replace(/[,.\s]+$/g, '');
      out.push(label === 'RSI' ? `RSI ${v}` : `${label} $${v.replace(/^\$/, '')}`);
      if (out.length >= max) break;
    }
  }
  return out.join(' · ');
}

/**
 * One raw read of what the just-returned fact actually made the model think:
 * varied phrasing per fact, grounded in the fact's own numbers and words.
 * Short when the fact is thin, take-plus-specifics when it is rich.
 * No fixed prefix, no "Next:" trailer — progress lives in Track lines.
 * Every number echoed comes from the fact itself; nothing is computed.
 */
export function buildAiRead(tool: string, fact = ''): string {
  const seed = `${tool}::${fact}`;
  const nums = numbersIn(fact);
  const numBit = nums.length > 0 ? nums.join(' / ') : '';
  const rich = fact.length > 200;
  const snippet = factSnippet(fact, rich ? 110 : 64);
  const query = quotedQuery(fact);

  switch (tool) {
    case 'fetch_ticker_dashboard': {
      if (includesAny(fact, ['no price', 'empty', 'no data', 'not found'])) {
        return capRead(pickVariant([
          'dashboard came back empty — nothing to lean on, holding off until there is real structure',
          'no usable levels in this snapshot, honestly can\'t favor either side yet',
        ], seed));
      }
      // Rich snapshot: take plus the actual levels being watched.
      const levels = rich ? dashboardLevels(fact) : '';
      const watch = levels ? ` Keeping an eye on ${levels}.` : '';
      if (includesAny(fact, ['bearish', 'downtrend', 'sell', 'weak'])) {
        const at = numBit ? ` around ${nums[0]}` : '';
        return capRead(pickVariant([
          `heavy tape${at} — sellers in control, my head goes to lower before any bounce`,
          `not seeing strength here${at}, rather expect the pullback to extend than chase a bounce`,
          `soft snapshot${at} — base case forming as flush-first, bounce only if participation shows up`,
        ], seed) + watch);
      }
      if (includesAny(fact, ['bullish', 'uptrend', 'buy', 'strong'])) {
        const at = numBit ? ` at ${nums[0]}` : '';
        return capRead(pickVariant([
          `trend's up but${at} looks stretched — chasing feels wrong, want the dip to prove it first`,
          `bullish structure${at}, yet location is everything — need a hold, not extension`,
          `uptrend intact${at} — gut says pullback-first, continuation only on expanding volume`,
        ], seed) + watch);
      }
      return capRead(pickVariant([
        `mixed snapshot — ${snippet} pulling both ways, letting volume break the tie`,
        `this one argues with itself — no clean edge, waiting on participation`,
      ], seed) + watch);
    }
    case 'fetch_price': {
      if (includesAny(fact, ['no price', 'no data', 'not found'])) {
        return capRead('no clean quote — not anchoring anything on this');
      }
      return capRead(pickVariant([
        `got the quote — ${snippet}`,
        `${snippet} noted, that's the anchor — now does structure back any follow-through?`,
      ], seed));
    }
    case 'web_search':
    case 'fetch_news': {
      if (includesAny(fact, ['no relevant', 'no results', 'no news', 'empty', 'no data'])) {
        return capRead(pickVariant([
          query
            ? `dug through "${query}" — basically nothing decision-relevant, treating it as inconclusive`
            : 'headlines dry on this one — capping conviction instead of forcing a read',
          'news trawl came up thin — keeping this one on price action, not stories',
        ], seed));
      }
      const about = query ? `"${query}" — ` : '';
      return capRead(pickVariant([
        `${about}${snippet} — nudges my odds a touch, price still decides`,
        `some signal in the headlines (${snippet}) — folding it in, structure has final say`,
      ], seed));
    }
    case 'fetch_sentiment': {
      const bit = numBit ? ` (${numBit})` : '';
      // Sample size is the thought: a loud ratio on 8 messages means little.
      const labelled = fact.match(/(\d+)\s*labelled/i)?.[1] ?? '';
      const sample = labelled
        ? Number(labelled) < 20
          ? ` Only ${labelled} labelled though — thin sample, not overweighting it.`
          : ` Decent sample at ${labelled} labelled — giving it some weight.`
        : '';
      if (includesAny(fact, ['extreme', 'contrarian', 'euphoria', 'panic', '70%', 'over 70'])) {
        return capRead(pickVariant([
          `crowd running hot${bit} — classic contrarian setup, needs price + volume before I trust it`,
          `lopsided mood${bit} — fading the herd here unless the tape confirms`,
        ], seed) + sample);
      }
      return capRead(pickVariant([
        `mood roughly balanced${bit} — this gets decided by price and participation, not sentiment`,
        `nothing extreme in positioning${bit} — back to levels and volume`,
      ], seed) + sample);
    }
    case 'risk_calc': {
      const sd = fact.match(/stop_distance\s*([\d.,]+)/i)?.[1] ?? '';
      const rr = fact.match(/\[([^\]]+)\]/)?.[1] ?? '';
      const mathBit = sd && rr
        ? `${sd} risk for ${rr}`
        : rr || (numBit ? numBit : '');
      if (includesAny(fact, ['warnings', 'rr below', 'below 1.5', 'invalid', 'failed'])) {
        const flag = fact.match(/warnings?:\s*([^;.\n]{4,80})/i)?.[1]?.trim() ?? '';
        const noted = flag ? ` Flag on it: ${flag}.` : '';
        return capRead(pickVariant([
          mathBit
            ? `ran it: ${mathBit} — too thin at this spot, probably chops or pulls back first`
            : 'ran the numbers — doesn\'t pay for the risk, my head goes to waiting for a better trigger',
          mathBit
            ? `${mathBit} doesn't compensate — forcing this would be hope, not a setup`
            : 'math rejects this location — shelving it, watching for a cheaper trigger',
        ], seed) + noted);
      }
      return capRead(pickVariant([
        mathBit
          ? `math works: ${mathBit} — okay, that's genuinely tradable, anchoring the base path here`
          : 'numbers check out — this trigger can actually carry the plan',
        mathBit
          ? `${mathBit} — clean enough, keeping this as the live trigger`
          : 'passing math — keeping this trigger live',
      ], seed));
    }
    case 'scan_indonesia_momentum': {
      return capRead(pickVariant([
        numBit
          ? `breadth read (${numBit}) — tells me if this is broad drift or stock-specific`
          : 'breadth scanned — separating market drift from a real stock move',
        `scanner says ${snippet} — using it to weight the base vs the alt`,
      ], seed));
    }
    case 'fetch_global_market_snapshot': {
      return capRead(pickVariant([
        `macro backdrop: ${snippet} — checking if that helps or blocks the ticker`,
        `noted the regime — ${snippet}`,
      ], seed));
    }
    case 'summon_agent': {
      if (includesAny(fact, ['failed', 'no usable'])) {
        return capRead('specialist came back empty — sticking with what the tools actually confirmed');
      }
      return capRead(pickVariant([
        `second opinion in — ${snippet}`,
        `specialist view folded in, keeping only what the evidence backs: ${snippet}`,
      ], seed));
    }
    default: {
      return capRead(pickVariant([
        `logged — ${snippet}`,
        `noted (${snippet}) — folding it into the path`,
      ], seed));
    }
  }
}

/** Periodic progress header so the timeline stays in track without re-reading. */
export function buildTrackLine(doneTools: number, next: string = 'scenario'): string {
  const total = SCENARIO_TRACK_STAGES.length;
  const done = Math.max(0, Math.min(total, doneTools));
  return `${TRACK_PREFIX} ${done}/${total} · ${SCENARIO_TRACK_STAGES.slice(0, done).join(' ✓ ') || 'starting'} → next: ${next}`;
}

export function isToolThought(t: string): boolean {
  return t.startsWith('tool used: ') || t.startsWith('• tool_call: ') || t.startsWith('Searched: ');
}

export function isTrackThought(t: string): boolean {
  return t.startsWith(TRACK_PREFIX);
}

/** A raw AI read: anything that is neither a tool marker nor a track header. */
export function isAiReadThought(t: string): boolean {
  return !isToolThought(t) && !isTrackThought(t);
}

/** Pushes the AI read for one completed tool; every 3rd read also drops a track line. */
export function appendAiReadThought(
  thoughts: string[],
  { tool, fact }: { tool: string; fact?: string },
): string[] {
  const next = [...thoughts];
  const read = buildAiRead(tool, fact ?? '');
  if (next[next.length - 1] !== read) next.push(read);
  const aiReads = next.filter(isAiReadThought).length;
  if (aiReads % 3 === 0) {
    const stage = NEXT_AFTER_TOOL[tool] ?? 'scenario';
    next.push(buildTrackLine(Math.min(aiReads, SCENARIO_TRACK_STAGES.length), stage));
  }
  return next;
}
